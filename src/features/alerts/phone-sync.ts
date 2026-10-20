import { useEffect, useMemo, useRef } from "react";
import { AppState, Platform } from "react-native";

import { ensureAccountSync, useAccountStore } from "@/features/account/store";
import { loadNotifications } from "@/features/notifications/permissions";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

import {
  ensureAlertChannels,
  fetchExpoPushToken,
  readEasProjectId,
  readPhonePermission,
} from "./expo-push";
import { useAlertDeviceStore } from "./store";
import { SupabaseAlertsTransport, toAlertsError, type AlertsTransport } from "./transport";
import type { BrowserPermission } from "./web-push";

/**
 * iOS/Android: keeps the server's copy of this phone (push_subscriptions,
 * kind 'expo') in step with the phone, the way the web repairs its browser
 * subscription (use-web-push-device.ts). Runs only while alerts are on on
 * this phone, or while a removal is still owed; otherwise it makes no
 * request at all.
 *
 * What can change while the app is closed or in the background:
 * - notifications turned off in iOS Settings: the phone is removed from the
 *   server and alerts are off here (as on the web when a browser blocks them);
 * - a new push token (Apple or Google rotated it): the new one is
 *   registered, the old one removed;
 * - the app language: registered again, so alerts come in the new one;
 * - the account: after a sign-in as someone else, or a sign-out (the app
 *   then continues as a new anonymous user), the phone is registered for
 *   whoever is signed in now. If that account may not have alerts (while
 *   alerts are for testers only), the phone is released from the previous
 *   account and alerts turn off here, so nobody gets another person's
 *   alerts on a shared phone.
 */

export interface PhoneSyncDeps {
  transport: AlertsTransport;
  projectId: string | null;
  readPermission(): Promise<BrowserPermission | null>;
  fetchToken(projectId: string): Promise<string>;
  ensureChannels(): Promise<void>;
}

export interface PhoneSyncContext {
  /** The language alerts are worded in (the app's; prefs-sync.ts). */
  locale: string;
  /** Who is signed in now (anonymous users too); null while not known. */
  userId: string | null;
}

export function defaultPhoneSyncDeps(
  transport: AlertsTransport = SupabaseAlertsTransport,
): PhoneSyncDeps {
  return {
    transport,
    projectId: readEasProjectId(),
    readPermission: readPhonePermission,
    fetchToken: fetchExpoPushToken,
    ensureChannels: ensureAlertChannels,
  };
}

/** The user id of the session on this phone right now (read locally). */
export async function sessionUserId(): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }
  try {
    const { data } = await client.auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Removes a token from the server, best effort. `owner`: as the account
 * that registered it (alerts_unregister_push, migration 0062). `anyone`:
 * whoever is signed in now (alerts_release_expo_push, 0068; before 0068 is
 * live it falls back to the owner call). Offline, the token is kept as
 * `pendingRemoval` and tried again on the next sync.
 */
export async function removePhoneToken(
  transport: AlertsTransport,
  token: string,
  as: "owner" | "anyone",
): Promise<void> {
  const store = useAlertDeviceStore.getState();
  try {
    if (as === "owner") {
      await transport.unregisterExpoPush(token);
    } else {
      try {
        await transport.releaseExpoPush(token);
      } catch (error) {
        if (toAlertsError(error).code !== "unavailable") {
          throw error;
        }
        await transport.unregisterExpoPush(token);
      }
    }
    if (useAlertDeviceStore.getState().pendingRemoval === token) {
      store.setPendingRemoval(null);
    }
  } catch (error) {
    // Offline, or no session yet: try again later. Anything else: nothing
    // more this phone can do about it.
    const code = toAlertsError(error).code;
    store.setPendingRemoval(code === "network" || code === "not_signed_in" ? token : null);
  }
}

/** Errors that mean "this account may not have alerts", not "try again". */
function isRefusal(code: string): boolean {
  return code === "not_enabled" || code === "not_signed_in" || code === "not_allowed";
}

/**
 * One repair pass (see the module comment). Never throws: a failure leaves
 * everything as it was and the next pass (launch, return to the app, a new
 * token, a change of language or account) tries again.
 */
export async function syncPhoneAlerts(deps: PhoneSyncDeps, ctx: PhoneSyncContext): Promise<void> {
  const store = () => useAlertDeviceStore.getState();

  const owed = store().pendingRemoval;
  if (owed && ctx.userId && owed !== store().expoToken) {
    await removePhoneToken(deps.transport, owed, "anyone");
  }

  const current = store();
  if (!current.deviceOn || !current.expoToken || !deps.projectId) {
    return;
  }

  let permission: BrowserPermission | null;
  try {
    permission = await deps.readPermission();
  } catch {
    return;
  }
  if (permission === "denied") {
    // Turned off in the phone's Settings since: as the web does when a
    // browser blocks notifications, the phone leaves the server.
    const token = current.expoToken;
    store().setPhoneDevice(null);
    if (ctx.userId) {
      await removePhoneToken(deps.transport, token, current.userId === ctx.userId ? "owner" : "anyone");
    } else {
      store().setPendingRemoval(token);
    }
    return;
  }
  if (!ctx.userId) {
    // No session yet (still loading, or between a sign-out and the new
    // anonymous session): nothing can be registered.
    return;
  }

  let token = current.expoToken;
  try {
    token = await deps.fetchToken(deps.projectId);
  } catch {
    // Offline: keep the token we have.
  }

  const accountChanged = current.userId !== ctx.userId;
  const needed = token !== current.expoToken || current.locale !== ctx.locale || accountChanged;
  if (needed) {
    let subscriptionId: string | null;
    try {
      subscriptionId = await deps.transport.registerExpoPush(token, ctx.locale);
    } catch (error) {
      const code = toAlertsError(error).code;
      if (!isRefusal(code)) {
        return; // offline or a passing failure: next time
      }
      // The account signed in now may not have alerts. Release the phone
      // from the previous account and turn alerts off here.
      store().setPhoneDevice(null);
      await removePhoneToken(deps.transport, current.expoToken, accountChanged ? "anyone" : "owner");
      if (token !== current.expoToken) {
        await removePhoneToken(deps.transport, token, "anyone");
      }
      return;
    }
    store().setPhoneDevice({
      token,
      subscriptionId: subscriptionId ?? (accountChanged ? null : current.subscriptionId),
      userId: ctx.userId,
      locale: ctx.locale,
    });
    if (accountChanged) {
      // The alert places on the phone are saved again for this account.
      store().setSyncedKey(null);
    }
    if (token !== current.expoToken) {
      await removePhoneToken(deps.transport, current.expoToken, accountChanged ? "anyone" : "owner");
    }
  }

  // Android: channel names follow the app language.
  await deps.ensureChannels().catch(() => undefined);
}

let running: Promise<void> | null = null;
let again = false;
let latest: { getDeps: () => PhoneSyncDeps; getContext: () => PhoneSyncContext } | null = null;

/**
 * Runs `syncPhoneAlerts` now, or once more right after the pass already
 * running (with the newest caller's dependencies and context), so passes
 * never overlap.
 */
export function requestPhoneSync(
  getDeps: () => PhoneSyncDeps,
  getContext: () => PhoneSyncContext,
): Promise<void> {
  latest = { getDeps, getContext };
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      const next = latest;
      if (next) {
        await syncPhoneAlerts(next.getDeps(), next.getContext());
      }
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

/**
 * Mounted at the root through useAlertPrefsAutoSync (app/_layout.tsx): on
 * launch, on every return to the app, when the push token changes, and when
 * the language or the signed-in account changes. Nothing on the web, and
 * nothing at all while alerts are off on this phone and no removal is owed.
 */
export function usePhoneAlertSync(
  locale: string,
  transport: AlertsTransport = SupabaseAlertsTransport,
): void {
  const phoneOn = useAlertDeviceStore((s) => s.deviceOn && s.expoToken !== null);
  const pendingRemoval = useAlertDeviceStore((s) => s.pendingRemoval);
  const userId = useAccountStore((s) => s.userId);
  const active =
    Platform.OS !== "web" && (phoneOn || pendingRemoval !== null) && isSupabaseConfigured();

  const deps = useMemo(() => defaultPhoneSyncDeps(transport), [transport]);
  // The latest language and account, for passes started by a listener.
  const context = useRef<PhoneSyncContext>({ locale, userId });
  useEffect(() => {
    context.current = { locale, userId };
  }, [locale, userId]);

  useEffect(() => {
    if (active) {
      // The session listener fills useAccountStore (userId) on the phone.
      ensureAccountSync();
    }
  }, [active]);

  useEffect(() => {
    if (!active) {
      return;
    }
    void requestPhoneSync(
      () => deps,
      () => context.current,
    );
  }, [active, locale, userId, deps]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const run = () =>
      void requestPhoneSync(
        () => deps,
        () => context.current,
      );
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        run();
      }
    });
    let tokenListener: { remove?: () => void } | null = null;
    let cancelled = false;
    void loadNotifications()
      .then((Notifications) => {
        if (Notifications && !cancelled) {
          // Apple or Google handed out a new device token.
          tokenListener = Notifications.addPushTokenListener(run);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      appState.remove();
      tokenListener?.remove?.();
    };
  }, [active, deps]);
}
