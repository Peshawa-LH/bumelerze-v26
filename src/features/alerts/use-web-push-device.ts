import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

import { signInAnonymously } from "@/lib/supabase";

import { payloadKey, useAlertPreferencesPayload } from "./prefs-sync";
import { useAlertDeviceStore } from "./store";
import { SupabaseAlertsTransport, toAlertsError, type AlertsTransport } from "./transport";
import { AlertsError, type AlertsErrorCode, type WebPushKeys } from "./types";
import {
  browserEnv,
  browserPermission,
  detectSupport,
  existingSubscription,
  keysOf,
  readVapidPublicKey,
  subscribeBrowser,
  unsubscribeBrowser,
  webBase,
  type BrowserEnv,
  type BrowserPermission,
  type WebPushSupport,
} from "./web-push";

export type DeviceStatus = "checking" | "on" | "off";

export interface WebPushDevice {
  support: WebPushSupport;
  status: DeviceStatus;
  /** The browser's notification permission (null without the API). */
  permission: BrowserPermission | null;
  /** This browser's push endpoint while alerts are on here. */
  endpoint: string | null;
  busy: boolean;
  error: AlertsErrorCode | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

/** A failure inside the browser's own push code, as one of our codes. */
function browserFailure(error: unknown): AlertsError {
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : null;
  if (name === "NotAllowedError") {
    return new AlertsError("denied", String(error));
  }
  return new AlertsError("browser", String(error));
}

/**
 * Tells the server about this browser's subscription and forgets the old
 * one when the browser handed out a new endpoint (a re-subscribe: the push
 * service rotated it, or the server key changed). Registration is an upsert
 * on the endpoint, so repeating it is harmless.
 */
async function registerDevice(
  transport: AlertsTransport,
  keys: WebPushKeys,
  locale: string,
): Promise<void> {
  const previous = useAlertDeviceStore.getState().endpoint;
  await transport.registerWebPush(keys, locale);
  if (previous && previous !== keys.endpoint) {
    // Best effort: a stale endpoint left behind answers 410 on the next send
    // and the server switches it off there.
    await transport.unregisterWebPush(previous).catch(() => undefined);
  }
  useAlertDeviceStore.getState().setDevice(true, keys.endpoint, locale);
}

/**
 * This browser's alert subscription (web push, migration 0062). "on" means
 * the browser holds a subscription AND this app registered it. Turning on
 * asks for notification permission first thing in the tap (Safari allows the
 * prompt only inside the user's gesture), then registers the service worker
 * at the app's root scope, subscribes with the app's VAPID key, registers
 * the device with the app's language and saves the alert places.
 *
 * Each time the screen opens it also repairs what can drift while the app
 * is closed: a new endpoint from the browser, a change of app language, or
 * notifications blocked / the subscription dropped in the browser settings.
 */
export function useWebPushDevice(
  transport: AlertsTransport = SupabaseAlertsTransport,
  envOverride?: BrowserEnv | null,
): WebPushDevice {
  const queryClient = useQueryClient();
  const env = useMemo(
    () => (envOverride === undefined ? browserEnv() : envOverride),
    [envOverride],
  );
  const vapid = readVapidPublicKey();
  const support = detectSupport(Platform.OS, vapid, env);
  const deviceOn = useAlertDeviceStore((s) => s.deviceOn);
  const endpoint = useAlertDeviceStore((s) => s.endpoint);
  const payload = useAlertPreferencesPayload();
  const locale = payload.language;
  const [status, setStatus] = useState<DeviceStatus>(support === "supported" ? "checking" : "off");
  const [permission, setPermission] = useState<BrowserPermission | null>(() => browserPermission(env));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AlertsErrorCode | null>(null);

  const refreshDevices = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["alerts", "devices"] });
  }, [queryClient]);

  useEffect(() => {
    if (support !== "supported" || !env) {
      return;
    }
    let cancelled = false;
    const store = useAlertDeviceStore.getState();
    const current = browserPermission(env);
    (async () => {
      const subscription = await existingSubscription(env, webBase());
      if (cancelled) {
        return;
      }
      // Re-read on every visit: it may have changed in the browser settings.
      setPermission(current);
      if (!subscription || current === "denied") {
        if (store.deviceOn) {
          // Blocked or dropped in the browser settings since last time.
          const old = store.endpoint;
          store.setDevice(false, null);
          if (old) {
            await transport.unregisterWebPush(old).catch(() => undefined);
          }
          refreshDevices();
        }
        setStatus("off");
        return;
      }
      if (!store.deviceOn) {
        setStatus("off");
        return;
      }
      setStatus("on");
      const keys = keysOf(subscription);
      if (keys.endpoint !== store.endpoint || store.locale !== locale) {
        await registerDevice(transport, keys, locale);
        refreshDevices();
      }
    })().catch(() => {
      // Offline: keep what we know; this runs again next time.
      if (!cancelled) {
        setStatus(useAlertDeviceStore.getState().deviceOn ? "on" : "off");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [support, env, deviceOn, locale, transport, refreshDevices]);

  const enable = useCallback(async () => {
    if (support !== "supported" || !env || !vapid || !env.window.Notification) {
      return;
    }
    setError(null);
    // First, inside the tap: Safari refuses the prompt after an await.
    let answer: BrowserPermission;
    try {
      answer = await env.window.Notification.requestPermission();
    } catch {
      answer = browserPermission(env) ?? "default";
    }
    setPermission(answer);
    if (answer !== "granted") {
      setError(answer === "denied" ? "denied" : "dismissed");
      return;
    }
    setBusy(true);
    try {
      await signInAnonymously();
      let keys: WebPushKeys;
      try {
        keys = await subscribeBrowser(env, webBase(), vapid);
      } catch (caught) {
        throw caught instanceof AlertsError ? caught : browserFailure(caught);
      }
      await registerDevice(transport, keys, locale);
      setStatus("on");
      try {
        await transport.savePreferences(payload);
        useAlertDeviceStore.getState().setSyncedKey(payloadKey(payload));
      } catch {
        // The device is registered; the auto-sync saves the places later.
      }
    } catch (caught) {
      setError(toAlertsError(caught).code);
    } finally {
      setBusy(false);
      refreshDevices();
    }
  }, [support, env, vapid, transport, locale, payload, refreshDevices]);

  const disable = useCallback(async () => {
    if (!env) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      let old = useAlertDeviceStore.getState().endpoint;
      try {
        old = (await unsubscribeBrowser(env, webBase())) ?? old;
      } catch {
        // Nothing to unsubscribe in the browser: still forget it here.
      }
      useAlertDeviceStore.getState().setDevice(false, null);
      setStatus("off");
      if (old) {
        // If this fails (offline) the server learns it on the next send:
        // the push service answers 410 and the device is switched off there.
        await transport.unregisterWebPush(old).catch(() => undefined);
      }
    } catch (caught) {
      setError(toAlertsError(caught).code);
    } finally {
      setBusy(false);
      refreshDevices();
    }
  }, [env, transport, refreshDevices]);

  return {
    support,
    status,
    permission,
    endpoint: status === "on" ? endpoint : null,
    busy,
    error,
    enable,
    disable,
  };
}
