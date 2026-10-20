import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, Platform } from "react-native";

import { ensureNotificationPermission } from "@/features/notifications/permissions";
import { signInAnonymously } from "@/lib/supabase";

import {
  ensureAlertChannels,
  fetchExpoPushToken,
  phonePushSupport,
  readEasProjectId,
  readPhonePermission,
} from "./expo-push";
import { removePhoneToken, sessionUserId } from "./phone-sync";
import { payloadKey, useAlertPreferencesPayload } from "./prefs-sync";
import { useAlertDeviceStore } from "./store";
import { SupabaseAlertsTransport, toAlertsError, type AlertsTransport } from "./transport";
import type { AlertsErrorCode } from "./types";
import type { DeviceStatus, WebPushDevice } from "./use-web-push-device";
import type { BrowserPermission } from "./web-push";

/** The alert controls' view of a device: a browser (web push) or this
 * phone (Expo push). `subscriptionId` marks the phone in the device list,
 * which has no endpoint for a phone. */
export interface PushDevice extends WebPushDevice {
  subscriptionId: string | null;
}

/** Test seams: the project id and the phone's native calls. */
export interface PhoneDeviceOptions {
  projectId?: string | null;
  fetchToken?: (projectId: string) => Promise<string>;
  readPermission?: () => Promise<BrowserPermission | null>;
  requestPermission?: () => Promise<"granted" | "denied" | "undetermined">;
}

/**
 * This phone's alert registration (iOS/Android; the web twin is
 * useWebPushDevice). "on" means the server has this phone's push token AND
 * notifications are allowed. Turning on asks for notification permission
 * first (the system question, only if it was never answered), then gets the
 * Expo push token and registers it with the app's language, then saves the
 * alert places. Without an EAS project id (a build made before the Expo
 * account exists) there is no token: `support` is "native" and the panel
 * keeps its "alerts come with the next version" words, never an error.
 *
 * Inert on the web. What drifts while the app is closed (token, language,
 * account, permission) is repaired at the root (phone-sync.ts).
 */
export function useExpoPushDevice(
  transport: AlertsTransport = SupabaseAlertsTransport,
  options: PhoneDeviceOptions = {},
): PushDevice {
  const queryClient = useQueryClient();
  const isWeb = Platform.OS === "web";
  const projectId = useMemo(
    () => (options.projectId === undefined ? readEasProjectId() : options.projectId),
    [options.projectId],
  );
  const support = phonePushSupport(Platform.OS, projectId);
  const fetchToken = options.fetchToken ?? fetchExpoPushToken;
  const readPermission = options.readPermission ?? readPhonePermission;
  const requestPermission = options.requestPermission ?? ensureNotificationPermission;

  const deviceOn = useAlertDeviceStore((s) => s.deviceOn);
  const expoToken = useAlertDeviceStore((s) => s.expoToken);
  const subscriptionId = useAlertDeviceStore((s) => s.subscriptionId);
  const payload = useAlertPreferencesPayload();
  const locale = payload.language;

  const [permission, setPermission] = useState<BrowserPermission | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AlertsErrorCode | null>(null);

  const refreshDevices = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["alerts", "devices"] });
  }, [queryClient]);

  // The permission, now and on every return to the app (from Settings).
  useEffect(() => {
    if (isWeb || support !== "supported") {
      return;
    }
    let cancelled = false;
    const read = () => {
      readPermission()
        .then((value) => {
          if (!cancelled) {
            setPermission(value);
            setChecked(true);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setChecked(true);
          }
        });
    };
    read();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        read();
      }
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [isWeb, support, readPermission]);

  const enable = useCallback(async () => {
    if (isWeb || support !== "supported" || !projectId) {
      return;
    }
    setError(null);
    // The system question comes first, straight from the tap; asked only
    // once (a "Don't Allow" can only be changed in Settings).
    const answer = await requestPermission();
    setPermission(answer === "granted" ? "granted" : answer === "denied" ? "denied" : "default");
    if (answer !== "granted") {
      setError(answer === "denied" ? "denied" : "dismissed");
      return;
    }
    setBusy(true);
    try {
      await signInAnonymously();
      await ensureAlertChannels().catch(() => undefined);
      const token = await fetchToken(projectId);
      const id = await transport.registerExpoPush(token, locale);
      const store = useAlertDeviceStore.getState();
      const previous = store.expoToken;
      store.setPhoneDevice({ token, subscriptionId: id, userId: await sessionUserId(), locale });
      if (store.pendingRemoval === token) {
        store.setPendingRemoval(null);
      }
      if (previous && previous !== token) {
        await removePhoneToken(transport, previous, "anyone");
      }
      try {
        await transport.savePreferences(payload);
        useAlertDeviceStore.getState().setSyncedKey(payloadKey(payload));
      } catch {
        // The phone is registered; the auto-sync saves the places later.
      }
    } catch (caught) {
      setError(toAlertsError(caught).code);
    } finally {
      setBusy(false);
      refreshDevices();
    }
  }, [isWeb, support, projectId, requestPermission, fetchToken, transport, locale, payload, refreshDevices]);

  const disable = useCallback(async () => {
    if (isWeb) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const token = useAlertDeviceStore.getState().expoToken;
      useAlertDeviceStore.getState().setPhoneDevice(null);
      if (token) {
        // Offline: kept as owed and removed on the next sync (an Expo token
        // keeps receiving until the server forgets it).
        await removePhoneToken(transport, token, "owner");
      }
    } finally {
      setBusy(false);
      refreshDevices();
    }
  }, [isWeb, transport, refreshDevices]);

  const status: DeviceStatus =
    support !== "supported"
      ? "off"
      : !checked
        ? "checking"
        : deviceOn && expoToken !== null && permission === "granted"
          ? "on"
          : "off";

  return {
    support,
    status,
    permission,
    endpoint: status === "on" ? expoToken : null,
    subscriptionId: status === "on" ? subscriptionId : null,
    busy,
    error,
    enable,
    disable,
  };
}
