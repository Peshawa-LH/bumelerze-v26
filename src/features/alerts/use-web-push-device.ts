import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import { useTranslation } from "react-i18next";

import { signInAnonymously } from "@/lib/supabase";

import { payloadKey, useAlertPreferencesPayload } from "./prefs-sync";
import { useAlertDeviceStore } from "./store";
import { SupabaseAlertsTransport, toAlertsError, type AlertsTransport } from "./transport";
import { AlertsError, type AlertsErrorCode } from "./types";
import {
  browserEnv,
  detectSupport,
  existingSubscription,
  readVapidPublicKey,
  subscribeBrowser,
  unsubscribeBrowser,
  webBase,
  type BrowserEnv,
  type WebPushSupport,
} from "./web-push";

export type DeviceStatus = "checking" | "on" | "off";

export interface WebPushDevice {
  support: WebPushSupport;
  status: DeviceStatus;
  busy: boolean;
  error: AlertsErrorCode | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

/**
 * This browser's alert subscription (web push, migration 0062). "on" means
 * the browser holds a subscription AND this app registered it. Turning on
 * asks for notification permission first thing in the tap (Safari allows the
 * prompt only inside the user's gesture), then subscribes, registers the
 * device and saves the alert places.
 */
export function useWebPushDevice(
  transport: AlertsTransport = SupabaseAlertsTransport,
  envOverride?: BrowserEnv | null,
): WebPushDevice {
  const { i18n } = useTranslation();
  const env = useMemo(
    () => (envOverride === undefined ? browserEnv() : envOverride),
    [envOverride],
  );
  const vapid = readVapidPublicKey();
  const support = detectSupport(Platform.OS, vapid, env);
  const deviceOn = useAlertDeviceStore((s) => s.deviceOn);
  const payload = useAlertPreferencesPayload();
  const [status, setStatus] = useState<DeviceStatus>(support === "supported" ? "checking" : "off");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AlertsErrorCode | null>(null);

  useEffect(() => {
    if (support !== "supported" || !env) {
      return;
    }
    let cancelled = false;
    existingSubscription(env, webBase())
      .then((subscription) => {
        if (!cancelled) {
          setStatus(subscription && deviceOn ? "on" : "off");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("off");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [support, env, deviceOn]);

  const enable = useCallback(async () => {
    if (support !== "supported" || !env || !vapid || !env.window.Notification) {
      return;
    }
    setError(null);
    // First, inside the tap: Safari refuses the prompt after an await.
    const permission = await env.window.Notification.requestPermission();
    if (permission !== "granted") {
      setError("denied");
      return;
    }
    setBusy(true);
    try {
      await signInAnonymously();
      const keys = await subscribeBrowser(env, webBase(), vapid);
      await transport.registerWebPush(keys, i18n.language);
      const store = useAlertDeviceStore.getState();
      store.setDevice(true, keys.endpoint);
      await transport.savePreferences(payload);
      store.setSyncedKey(payloadKey(payload));
      setStatus("on");
    } catch (caught) {
      setError(caught instanceof AlertsError ? caught.code : toAlertsError(caught).code);
    } finally {
      setBusy(false);
    }
  }, [support, env, vapid, transport, i18n.language, payload]);

  const disable = useCallback(async () => {
    if (!env) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const endpoint =
        (await unsubscribeBrowser(env, webBase())) ?? useAlertDeviceStore.getState().endpoint;
      useAlertDeviceStore.getState().setDevice(false, null);
      setStatus("off");
      if (endpoint) {
        // If this fails (offline) the server learns it on the next send:
        // the push service answers 410 and the device is switched off there.
        await transport.unregisterWebPush(endpoint).catch(() => undefined);
      }
    } catch (caught) {
      setError(toAlertsError(caught).code);
    } finally {
      setBusy(false);
    }
  }, [env, transport]);

  return { support, status, busy, error, enable, disable };
}
