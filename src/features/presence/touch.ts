import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";

import i18n, { SUPPORTED_LOCALES } from "@/i18n";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

/**
 * "Last seen" for the admin People directory (migration 0055, `app_presence`).
 * Once a day at most, the app tells the server the time, the platform, the app
 * version and the language, against the identity it already has (account or
 * anonymous). Disclosed in Settings (`settings.footerPresence`).
 *
 * Rules:
 *  - at most one call per 24 hours (a stamp in AsyncStorage) and one per app
 *    process; the server also ignores a second call within 20 hours
 *  - it NEVER creates an identity: with no session yet there is nothing to
 *    record, and signing in just to be counted would add anonymous users
 *  - best effort and silent: a failure is not retried until the next day's
 *    first open, and never shown
 */
export const PRESENCE_STORAGE_KEY = "bumelerze.presence.last-touch";
export const PRESENCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

let firedThisSession = false;

function platformOf(): "ios" | "android" | "web" | null {
  return Platform.OS === "ios" || Platform.OS === "android" || Platform.OS === "web"
    ? Platform.OS
    : null;
}

/** True when more than a day has passed since the last successful call. */
export function isTouchDue(lastTouchMs: number | null, nowMs: number): boolean {
  return (
    lastTouchMs === null ||
    !Number.isFinite(lastTouchMs) ||
    lastTouchMs > nowMs ||
    nowMs - lastTouchMs >= PRESENCE_INTERVAL_MS
  );
}

export async function touchPresenceOnce(now: () => number = Date.now): Promise<void> {
  if (firedThisSession || !isSupabaseConfigured()) {
    return;
  }
  firedThisSession = true;
  try {
    const stored = await AsyncStorage.getItem(PRESENCE_STORAGE_KEY);
    const last = stored === null ? null : Number(stored);
    if (!isTouchDue(last, now())) {
      return;
    }
    const client = getSupabaseClient();
    if (!client) {
      return;
    }
    const { data } = await client.auth.getSession();
    if (!data.session) {
      return;
    }
    const language = i18n.language;
    const { error } = await client.rpc("touch_presence", {
      p_platform: platformOf(),
      p_app_version: Constants.expoConfig?.version ?? null,
      p_locale: (SUPPORTED_LOCALES as readonly string[]).includes(language) ? language : null,
    });
    if (!error) {
      await AsyncStorage.setItem(PRESENCE_STORAGE_KEY, String(now()));
    }
  } catch {
    // Best effort: a missed day is not worth a message.
  }
}

/** Test-only escape hatch. */
export function __resetPresenceForTests(): void {
  firedThisSession = false;
}
