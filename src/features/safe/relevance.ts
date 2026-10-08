import { haversineDistanceKm, type Event } from "@/features/events";

import {
  BANNER_WINDOW_MS,
  EXPECTED_INTENSITY_V_TABLE,
  FELT_PRIMARY_MIN_LEVEL,
  FELT_QUIET_MIN_LEVEL,
  MANUAL_MIN_MAGNITUDE,
  MANUAL_WINDOW_MS,
  QUIET_PERIOD_MS,
  STRONGER_BY_MAGNITUDE,
} from "./constants";

/**
 * When to ask "Are you safe?" Pure functions, no network, no storage: the
 * phone's position goes in as an argument and never leaves this module.
 */

/** True when the table says the shaking at this distance was probably felt at
 * EMS-98 V or more. */
export function expectedAtLeastV(magnitude: number, distanceKm: number): boolean {
  if (!Number.isFinite(magnitude) || !Number.isFinite(distanceKm) || distanceKm < 0) {
    return false;
  }
  return EXPECTED_INTENSITY_V_TABLE.some(
    (row) => magnitude >= row.minMagnitude && distanceKm <= row.withinKm,
  );
}

export type FeltPromptKind = "primary" | "quiet" | "none";

/** Which check-in invitation the felt-report done screen shows for a level. */
export function feltPromptKind(level: number | null | undefined): FeltPromptKind {
  if (typeof level !== "number") {
    return "none";
  }
  if (level >= FELT_PRIMARY_MIN_LEVEL) {
    return "primary";
  }
  if (level >= FELT_QUIET_MIN_LEVEL) {
    return "quiet";
  }
  return "none";
}

/** The provider key the local store remembers an event by. */
export function eventKey(event: Pick<Event, "provenance">): string {
  return `${event.provenance.provider}:${event.provenance.providerId}`;
}

/** What the phone remembers about earlier prompts (see `store.ts`). */
export interface PromptMemory {
  /** Event keys already answered (checked in or "Not now"). */
  handled: Readonly<Record<string, number>>;
  /** The last answer, for the 3-hour quiet period. */
  lastAction: { at: number; magnitude: number } | null;
}

export interface Fix {
  lat: number;
  lon: number;
}

/**
 * The event the Home banner should ask about, or null. An event of the last
 * 6 hours that probably shook the phone's position at V or more, not yet
 * answered, and outside the quiet period (unless clearly stronger). The
 * strongest candidate wins; the newest breaks a tie.
 */
export function pickBannerEvent(
  events: readonly Event[],
  fix: Fix | null,
  memory: PromptMemory,
  now: number = Date.now(),
): Event | null {
  if (!fix) {
    return null;
  }
  let best: Event | null = null;
  for (const event of events) {
    const age = now - event.originTime;
    if (age < 0 || age > BANNER_WINDOW_MS) continue;
    if (memory.handled[eventKey(event)] !== undefined) continue;
    const distance = haversineDistanceKm(fix.lat, fix.lon, event.lat, event.lon);
    if (!expectedAtLeastV(event.magnitude.value, distance)) continue;
    if (
      memory.lastAction &&
      now - memory.lastAction.at < QUIET_PERIOD_MS &&
      event.magnitude.value < memory.lastAction.magnitude + STRONGER_BY_MAGNITUDE
    ) {
      continue;
    }
    if (
      !best ||
      event.magnitude.value > best.magnitude.value ||
      (event.magnitude.value === best.magnitude.value &&
        event.originTime > best.originTime)
    ) {
      best = event;
    }
  }
  return best;
}

/** The event a manual check-in attaches to: the newest regional earthquake of
 * at least M4.0 from the last 72 hours, else null ("Practice"). */
export function pickManualEvent(
  events: readonly Event[],
  now: number = Date.now(),
): Event | null {
  let newest: Event | null = null;
  for (const event of events) {
    const age = now - event.originTime;
    if (!event.isRegional || age < 0 || age > MANUAL_WINDOW_MS) continue;
    if (event.magnitude.value < MANUAL_MIN_MAGNITUDE) continue;
    if (!newest || event.originTime > newest.originTime) {
      newest = event;
    }
  }
  return newest;
}
