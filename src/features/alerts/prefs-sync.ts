import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { usePrefsStore, type StoredPlace } from "@/features/onboarding";
import { isSupabaseConfigured } from "@/lib/supabase";

import { useAlertDeviceStore } from "./store";
import { SupabaseAlertsTransport, type AlertsTransport } from "./transport";
import type { AlertPreferencesPayload } from "./types";

/**
 * The server's copy of my alert settings (notification_subscriptions,
 * migration 0062): tiers, plus two points.
 *
 * - Near me = the reader's place from "My location": the nearest main town to
 *   the last fix, or a place they chose. Never a GPS fix.
 * - Another place = the place they chose for family elsewhere.
 *
 * Both are also snapped to a 0.05 degree grid (about 5 km) here, and again by
 * the database, so no finer point can be stored.
 */
const GRID = 20;

export function coarse(value: number): number {
  return Math.round(value * GRID) / GRID;
}

function point(place: StoredPlace | null): [number | null, number | null] {
  return place ? [coarse(place.lat), coarse(place.lon)] : [null, null];
}

const LANGUAGES = new Set(["ckb", "kmr", "ar", "en"]);

export function buildPreferencesPayload(
  prefs: {
    nearMeTier: string;
    referencePlace: StoredPlace | null;
    /** Auto place but the last fix was outside every town's range (abroad):
     * the remembered town is not "near me", so no near-me point. */
    referenceOutOfRange?: boolean;
    referenceSource?: "auto" | "manual";
    anotherPlace: StoredPlace | null;
    anotherPlaceTier: string;
  },
  locale: string,
): AlertPreferencesPayload {
  const abroad = prefs.referenceOutOfRange === true && prefs.referenceSource !== "manual";
  const [nearMeLat, nearMeLon] = point(abroad ? null : prefs.referencePlace);
  const [anotherLat, anotherLon] = point(prefs.anotherPlace);
  return {
    nearMeTier: prefs.nearMeTier,
    nearMeLat,
    nearMeLon,
    anotherTier: prefs.anotherPlace ? prefs.anotherPlaceTier : "off",
    anotherLat,
    anotherLon,
    language: LANGUAGES.has(locale) ? locale : "en",
  };
}

export function payloadKey(payload: AlertPreferencesPayload): string {
  return JSON.stringify(payload);
}

/** The payload for the current prefs and language (a hook, re-renders on change). */
export function useAlertPreferencesPayload(): AlertPreferencesPayload {
  const { i18n } = useTranslation();
  const nearMeTier = usePrefsStore((s) => s.nearMeTier);
  const referencePlace = usePrefsStore((s) => s.referencePlace);
  const referenceOutOfRange = usePrefsStore((s) => s.referenceOutOfRange);
  const referenceSource = usePrefsStore((s) => s.referenceSource);
  const anotherPlace = usePrefsStore((s) => s.anotherPlace);
  const anotherPlaceTier = usePrefsStore((s) => s.anotherPlaceTier);
  return buildPreferencesPayload(
    { nearMeTier, referencePlace, referenceOutOfRange, referenceSource, anotherPlace, anotherPlaceTier },
    i18n.language,
  );
}

/**
 * Keeps the server's copy current while alerts are on on THIS device: after a
 * tier or place change, and when the daily location check moves "My
 * location" to another town. Does nothing at all (no request) otherwise.
 * A failed save is simply retried on the next change or launch.
 */
export function useAlertPrefsAutoSync(transport: AlertsTransport = SupabaseAlertsTransport): void {
  const payload = useAlertPreferencesPayload();
  const key = payloadKey(payload);
  const deviceOn = useAlertDeviceStore((s) => s.deviceOn);
  const syncedKey = useAlertDeviceStore((s) => s.syncedKey);

  useEffect(() => {
    if (!deviceOn || key === syncedKey || !isSupabaseConfigured()) {
      return;
    }
    let cancelled = false;
    transport
      .savePreferences(JSON.parse(key) as AlertPreferencesPayload)
      .then(() => {
        if (!cancelled) {
          useAlertDeviceStore.getState().setSyncedKey(key);
        }
      })
      .catch(() => {
        // Offline or not a tester any more: tried again on the next change.
      });
    return () => {
      cancelled = true;
    };
  }, [deviceOn, key, syncedKey, transport]);
}
