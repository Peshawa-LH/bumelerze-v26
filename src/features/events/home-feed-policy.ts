import {
  HOME_FEED_MAGNITUDE_FLOOR_STEPS,
  HOME_FEED_MAX_CARDS,
  HOME_FEED_MIN_CARDS,
  HOME_FEED_NOTABLE_TIERS,
  HOME_FEED_WINDOW_STEPS_DAYS,
} from "./config";
import type { Event } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface HomeFeedPolicyResult {
  /** Final Home list — the adaptive window/floor selection, UNION the
   * magnitude-tiered notable carve-out, deduplicated by id and sorted
   * newest-first (spec: "the feed still reads chronologically without a
   * confusing jumble"). */
  events: Event[];
  /** The lookback window (days) the sparse/dense steps settled on. Always
   * one of `HOME_FEED_WINDOW_STEPS_DAYS`. Exposed for tests and for any
   * future "showing events from the last N days" UI copy. */
  windowDays: number;
  /** The magnitude floor the dense-tighten step settled on. Always one of
   * `HOME_FEED_MAGNITUDE_FLOOR_STEPS`. */
  magnitudeFloor: number;
  /** ids of events present in `events` ONLY because of the notable-tier
   * carve-out (i.e. they fall outside `windowDays`/`magnitudeFloor` and
   * would otherwise be absent) — the caller uses this to render the
   * "notable/older event" visual cue so an old M5.5 doesn't read as fresh
   * or confusingly out of place next to yesterday's M3.2. */
  notableIds: ReadonlySet<string>;
}

function isWithinWindow(event: Event, now: number, windowDays: number): boolean {
  return now - event.originTime <= windowDays * DAY_MS;
}

function passesFloor(event: Event, magnitudeFloor: number): boolean {
  return event.magnitude.value >= magnitudeFloor;
}

/** True when `event` qualifies for ANY magnitude-tiered notable-retention
 * tier (`HOME_FEED_NOTABLE_TIERS`), regardless of the adaptive
 * window/floor the sparse/dense steps picked. */
function isNotable(event: Event, now: number): boolean {
  return HOME_FEED_NOTABLE_TIERS.some(
    (tier) =>
      event.magnitude.value >= tier.minMagnitude &&
      now - event.originTime <= tier.retentionDays * DAY_MS,
  );
}

/**
 * Adaptive Home-feed selection policy (update-plan-2026-08.md §1.1) — a
 * PURE function over an already-fetched pool of events, so it stays
 * trivially unit-testable with fixtures and keeps the Home screen itself
 * "dumb" (spec: "the policy logic in its own module ... so the screen
 * stays dumb"). No I/O, no React, no clock dependency beyond the `now`
 * parameter.
 *
 * Decision order (matches the owner's own framing, in order):
 * 1. SPARSE: starting from the baseline (first entry of
 *    `HOME_FEED_WINDOW_STEPS_DAYS`) at the baseline magnitude floor, widen
 *    the lookback window step by step until `HOME_FEED_MIN_CARDS` is met
 *    or the ladder is exhausted (never below the baseline, never above the
 *    180-day cap).
 * 2. DENSE: at the window resolved in step 1, raise the magnitude floor
 *    step by step until the count is at or under `HOME_FEED_MAX_CARDS`, or
 *    the ladder is exhausted — the window from step 1 is NEVER shortened
 *    to fix a dense feed, only the floor moves.
 * 3. NOTABLE CARVE-OUT: independent of 1-2, any event that clears a
 *    `HOME_FEED_NOTABLE_TIERS` magnitude/age tier is unioned into the
 *    result regardless of window/floor, so "high-magnitude events in
 *    Kurdistan stay longer" holds even when steps 1-2 would have excluded
 *    them.
 *
 * `pool` is expected to be the region feed, OPTIONALLY concatenated with
 * the notable-tail feed (`useNotableTailEvents`) — every event with
 * `isRegional: true` is considered (anything else is ignored defensively,
 * since Home is a region-first screen); duplicate ids across the two pools
 * (an event both feeds happen to carry) are deduplicated. Callers should
 * NOT pre-filter by date or magnitude before calling this.
 */
export function selectHomeFeedEvents(
  pool: readonly Event[],
  now: number = Date.now(),
): HomeFeedPolicyResult {
  const dedupedById = new Map<string, Event>();
  for (const event of pool) {
    if (event.isRegional) {
      dedupedById.set(event.id, event);
    }
  }
  const regionalPool = Array.from(dedupedById.values());

  const baselineFloor = HOME_FEED_MAGNITUDE_FLOOR_STEPS[0];

  // 1. Sparse-widen: find the smallest window (at the baseline floor) that
  // meets the minimum card count; falls through to the widest step if none
  // do.
  let windowDays: number = HOME_FEED_WINDOW_STEPS_DAYS[0];
  for (const step of HOME_FEED_WINDOW_STEPS_DAYS) {
    windowDays = step;
    const count = regionalPool.filter(
      (event) => isWithinWindow(event, now, step) && passesFloor(event, baselineFloor),
    ).length;
    if (count >= HOME_FEED_MIN_CARDS) {
      break;
    }
  }

  // 2. Dense-tighten: at the resolved window, find the smallest floor that
  // brings the count at/under the max; falls through to the strictest step
  // if none do (still the tightest the ladder allows).
  let magnitudeFloor: number = baselineFloor;
  for (const floor of HOME_FEED_MAGNITUDE_FLOOR_STEPS) {
    magnitudeFloor = floor;
    const count = regionalPool.filter(
      (event) => isWithinWindow(event, now, windowDays) && passesFloor(event, floor),
    ).length;
    if (count <= HOME_FEED_MAX_CARDS) {
      break;
    }
  }

  const selected = new Map<string, Event>();
  for (const event of regionalPool) {
    if (isWithinWindow(event, now, windowDays) && passesFloor(event, magnitudeFloor)) {
      selected.set(event.id, event);
    }
  }

  // 3. Notable carve-out — union in, tracking which ids needed it (i.e.
  // weren't already selected by steps 1-2) for the caller's visual cue.
  const notableIds = new Set<string>();
  for (const event of regionalPool) {
    if (!isNotable(event, now)) {
      continue;
    }
    if (!selected.has(event.id)) {
      notableIds.add(event.id);
    }
    selected.set(event.id, event);
  }

  const events = Array.from(selected.values()).sort((a, b) => b.originTime - a.originTime);

  return { events, windowDays, magnitudeFloor, notableIds };
}
