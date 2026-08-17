/**
 * On-map magnitude/date filters (update-plan-2026-08.md §4.4: "a slider to
 * filter magnitudes and dates and so on"). Pure client-side narrowing of an
 * ALREADY-FETCHED event array — no new fetch is ever issued for a filter
 * change, matching the wave brief and the region/world feeds' own polling
 * cadence (`queries.ts`).
 *
 * Bounds are computed from whatever event set is actually on screen (per
 * scope), not from fixed app-wide constants — the World scope's own natural
 * magnitude floor (`fetchUsgsWorldEvents` only ever returns the USGS
 * M4.5+/week summary feed) is a genuinely different distribution than
 * Kurdistan's region feed (`REGION_FEED_WINDOW_DAYS`, `HOME_FEED_MIN_MAGNITUDE`
 * floor of the Home feed does NOT apply here — the map shows the full
 * region pool). Deriving bounds from the data itself is what makes the
 * defaults "adapt sensibly per scope" without hand-tuning two separate
 * constant sets that would drift out of sync with the feeds' own floors.
 */
import type { Event } from "@/features/events";

export interface MagnitudeRange {
  min: number;
  max: number;
}

export interface DateRangeMs {
  startMs: number;
  endMs: number;
}

const MAGNITUDE_BOUND_STEP = 0.5;

/** Fallback span used only when the current scope has zero events (feed
 * still loading, or a genuinely quiet window) — a degenerate `[0,0]` range
 * would render an undraggable slider the instant real data arrives. */
const FALLBACK_MAGNITUDE_RANGE: MagnitudeRange = { min: 0, max: 7 };

/** Fallback date window (ends "now") for the same empty-scope case above. */
const FALLBACK_DATE_WINDOW_MS = 24 * 60 * 60 * 1000;

function floorToStep(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

function ceilToStep(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/**
 * The full magnitude span present in `events`, rounded OUTWARD to the
 * nearest half-magnitude step — so the slider's own endpoints read as tidy
 * numbers (M3.0, never M3.14) and never clip a real event sitting exactly on
 * a bound (rounding in, not out, would do exactly that).
 */
export function computeMagnitudeBounds(events: readonly Event[]): MagnitudeRange {
  if (events.length === 0) {
    return FALLBACK_MAGNITUDE_RANGE;
  }
  const values = events.map((event) => event.magnitude.value);
  const min = floorToStep(Math.min(...values), MAGNITUDE_BOUND_STEP);
  const max = ceilToStep(Math.max(...values), MAGNITUDE_BOUND_STEP);
  // A single-magnitude (or same-step) event set still needs a non-zero span
  // for the slider to be draggable at all.
  return max > min ? { min, max } : { min, max: min + MAGNITUDE_BOUND_STEP };
}

/**
 * The full date span present in `events` — `endMs` is always `nowMs` (never
 * the newest event's own origin time), so the slider's upper bound keeps
 * advancing with real time rather than freezing at whatever moment the
 * events happened to be fetched.
 */
export function computeDateBoundsMs(
  events: readonly Event[],
  nowMs: number,
): DateRangeMs {
  if (events.length === 0) {
    return { startMs: nowMs - FALLBACK_DATE_WINDOW_MS, endMs: nowMs };
  }
  const oldest = Math.min(...events.map((event) => event.originTime));
  return { startMs: Math.min(oldest, nowMs), endMs: nowMs };
}

/**
 * Narrows an already-fetched event array to the given magnitude/date
 * window. Both bounds are INCLUSIVE on both ends, so an event sitting
 * exactly on a slider endpoint is never silently dropped (a real risk here:
 * `computeMagnitudeBounds`/`computeDateBoundsMs` above derive their bounds
 * FROM the same event set, so the min/max events themselves must always
 * survive an unfiltered/full-range selection).
 */
export function filterEventsByMagnitudeAndDate(
  events: readonly Event[],
  magnitudeRange: MagnitudeRange,
  dateRange: DateRangeMs,
): Event[] {
  return events.filter(
    (event) =>
      event.magnitude.value >= magnitudeRange.min &&
      event.magnitude.value <= magnitudeRange.max &&
      event.originTime >= dateRange.startMs &&
      event.originTime <= dateRange.endMs,
  );
}

/** True when `range` is narrower than `bounds` on either end — the "is a
 * filter actually active" signal the collapsed compact summary
 * (`MapFilterPanel`) and the reset button's enabled state both key off. */
export function isMagnitudeRangeNarrowed(
  range: MagnitudeRange,
  bounds: MagnitudeRange,
): boolean {
  return range.min > bounds.min || range.max < bounds.max;
}

/** Same narrowing check for the date range — kept as a twin function rather
 * than a generic `<T>` helper since the two ranges have different field
 * names (`min`/`max` vs. `startMs`/`endMs`) and mixing them behind one
 * generic would obscure which fields are actually being compared. */
export function isDateRangeNarrowed(range: DateRangeMs, bounds: DateRangeMs): boolean {
  return range.startMs > bounds.startMs || range.endMs < bounds.endMs;
}
