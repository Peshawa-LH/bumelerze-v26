import * as Location from "expo-location";
import { Platform } from "react-native";

import { encodeGeohash } from "@/lib/felt-aggregation";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Anonymous app-launch telemetry ping (spec-v1.md §5.5, D11/D13; migration
 * `0005_notifications_and_telemetry.sql`'s `telemetry_pings` table). Fires
 * at most once per app process — this is a best-effort background signal
 * with no UI surface, disclosed in Settings (`settings.telemetrySectionTitle`
 * / `telemetrySectionDescription`, ×4 locales) per the trust principle, not
 * a durable queued action like a felt report: a failed or skipped ping is
 * simply gone, never retried, and never shown to the user.
 */

/** Matches `telemetry_pings.platform`'s CHECK constraint exactly. */
export type TelemetryPlatform = "ios" | "android" | "web";

/** Privacy floor, not a display precision (migration comment: "coarse:
 * precision 4 max") — city/region scale, matching the `char_length(geohash)
 * between 1 and 4` column constraint. */
const TELEMETRY_GEOHASH_PRECISION = 4;

function resolvePlatform(): TelemetryPlatform | null {
  if (Platform.OS === "ios" || Platform.OS === "android" || Platform.OS === "web") {
    return Platform.OS;
  }
  // Dev-only targets (e.g. macos/windows via react-native-macos/windows)
  // aren't in the CHECK constraint's allowed set — there's no honest value
  // to send instead, so the ping is simply skipped for them (see
  // `sendColdStartTelemetryPing` below).
  return null;
}

export interface TelemetryPingInsert {
  geohash: string;
  platform: TelemetryPlatform;
}

/**
 * Maps a coarse lat/lon + resolved platform to a `telemetry_pings` insert
 * row. Column mapping (migration 0005):
 *  - `geohash`  <- `encodeGeohash(lat, lon, 4)` (p4 privacy floor)
 *  - `platform` <- the resolved OS string
 * Deliberately NOT sent: `ping_id` (server default), `created_at` (server
 * default `now()` — more truthful than a client clock guess, same reasoning
 * as `felt_reports.submitted_at` in `features/felt/supabase-transport.ts`).
 * No `device_id` column exists on this table at all (by design — "anonymous
 * means anonymous", migration comment), so none is sent or has anywhere to
 * go.
 */
export function buildTelemetryPingInsert(
  lat: number,
  lon: number,
  platform: TelemetryPlatform,
): TelemetryPingInsert {
  return {
    geohash: encodeGeohash(lat, lon, TELEMETRY_GEOHASH_PRECISION),
    platform,
  };
}

let hasFiredThisSession = false;

/**
 * Sends the cold-start ping, if all of the following hold — every check is
 * a silent skip, never a user-visible error or a permission prompt:
 *  - Supabase is configured (`isSupabaseConfigured()`) — no project yet
 *    means literally nowhere to send it, matching the felt-queue's own
 *    "no backend yet" stance.
 *  - The platform is one of the three the CHECK constraint accepts.
 *  - Foreground location permission is ALREADY granted — this function
 *    never requests it (mirrors `useUserDistanceAnchor`'s "never surprise
 *    the user with a permission prompt outside onboarding" rule); no
 *    permission means no ping, not a forced prompt.
 *  - A cached last-known position exists — `getLastKnownPositionAsync`
 *    only, deliberately never `getCurrentPositionAsync` (PROJECT.md
 *    "battery-conscious... no wake-lock abuse": a cold-start ping must
 *    never itself trigger a fresh GPS fix).
 *
 * Call once from the root layout's cold-start effect
 * (`app/_layout.tsx`); safe to call more than once (e.g. Fast Refresh) —
 * only the first call per process actually does anything.
 */
export async function sendColdStartTelemetryPing(): Promise<void> {
  if (hasFiredThisSession || !isSupabaseConfigured()) {
    return;
  }
  // Set before the async work below, not after: this is an at-most-once-
  // per-session best-effort signal, not a retryable queue item — a failed
  // attempt must not turn into a retry-storm on every subsequent call.
  hasFiredThisSession = true;

  const platform = resolvePlatform();
  if (!platform) {
    return;
  }

  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== Location.PermissionStatus.GRANTED) {
      return;
    }

    const position = await Location.getLastKnownPositionAsync();
    if (!position) {
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      return;
    }

    const payload = buildTelemetryPingInsert(
      position.coords.latitude,
      position.coords.longitude,
      platform,
    );
    await client.from("telemetry_pings").insert(payload);
  } catch {
    // No UI surface exists for this ping at all (unlike felt reports, whose
    // "no silent catches" requirement is about USER-facing errors) — a
    // failed background nicety is correctly invisible, not a bug to
    // surface. See the file doc comment.
  }
}

/** Test-only escape hatch — never called from app code. */
export function __resetTelemetrySessionForTests(): void {
  hasFiredThisSession = false;
}
