import { useCallback, useState } from "react";

import type { Event } from "@/features/events";

/**
 * Draggable event-preview sheet (map-UX wave: "tap a marker, a sheet rises
 * over the map instead of navigating straight to the full event"). This
 * module owns every DECISION the sheet makes — which detent a drag lands on,
 * how tall each detent is, the state machine driving open/detent/dismiss —
 * as plain, framework-free functions/hooks, independently testable without
 * mounting the Reanimated/Gesture-Handler-driven `EventPreviewSheet`
 * component itself (same split this feature already uses everywhere else:
 * `clustering.ts`/`cluster-layer.ts`, `filters.ts`, `style-provider.ts`).
 * `EventPreviewSheet.tsx` is the thin glue that reads these values and wires
 * them to actual gestures/animations — deliberately NOT calling any of
 * these functions from inside a Gesture-Handler worklet callback itself
 * (cross-module plain functions aren't automatically worklet-ized); the
 * component only ever reads/writes Reanimated shared values on the UI
 * thread and hands raw numbers to these functions via `runOnJS` on the JS
 * thread instead.
 */

/** Two detents the sheet itself can rest at — "dismissed" is represented by
 * `event === null` at the call site (there is no content to detent once the
 * sheet has nothing to show), not a third value here. A THIRD, larger detent
 * ("full") is deliberately NOT a resting state of this component at all:
 * reaching it means "leave the sheet and open the real `/event/[id]` route"
 * (`SheetSnapOutcome`'s own doc comment) — the wave brief's explicit
 * instruction not to fork a second implementation of the event-detail
 * screen inside the sheet. */
export type SheetDetent = "peek" | "expanded";

/** What a released drag (or a button tap) resolves to. `"dismiss"` and
 * `"openFull"` are both exits from the sheet's own detent state machine —
 * the CALLER (`EventPreviewSheet`/the Map screen) decides what that means
 * (clear the selection; push the full event route), this module only ever
 * decides WHICH of the four outcomes a given drag lands on. */
export type SheetSnapOutcome = "dismiss" | SheetDetent | "openFull";

/** Fraction of the map area's height each detent shows. Peek: enough for
 * magnitude/place/time/actions at a glance without hiding most of the map.
 * Expanded: room for the fuller preview (provenance, distance, absolute
 * time) while still leaving the top of the map visible above it. */
export const SHEET_PEEK_HEIGHT_FRACTION = 0.32;
export const SHEET_EXPANDED_HEIGHT_FRACTION = 0.62;
/** The sheet's own physical rendered height budget, AND the visible-height
 * point a drag has to cross to hand off to full-event navigation
 * (`resolveSheetSnapOutcome`'s `"openFull"` branch) — one number serves both
 * roles on purpose: the sheet never needs to visually render taller than the
 * point at which it stops being itself and becomes a navigation instead. */
export const SHEET_OPEN_FULL_HEIGHT_FRACTION = 0.9;

/** A release faster than this (px/s, either direction) is treated as a
 * flick — it moves exactly one step from the CURRENT nearest detent in the
 * flicked direction, regardless of exactly where the drag stopped, matching
 * how every familiar maps-app sheet (Google/Apple Maps) behaves on a fast
 * swipe. Below this speed, `resolveSheetSnapOutcome` uses nearest-midpoint
 * by position alone. Not derived from a device measurement — a deliberately
 * generous, "clearly intentional swipe" threshold. */
export const SHEET_FLICK_VELOCITY_PX_PER_SEC = 800;

/** Detent ordering, dismiss..openFull — `resolveSheetSnapOutcome`'s flick
 * branch steps exactly one position along this list. */
const SNAP_OUTCOME_ORDER: readonly SheetSnapOutcome[] = [
  "dismiss",
  "peek",
  "expanded",
  "openFull",
];

/** The sheet's visible height, in px, for a given detent and container
 * (map-area) height. */
export function sheetVisibleHeightPx(detent: SheetDetent, containerHeightPx: number): number {
  const fraction =
    detent === "expanded" ? SHEET_EXPANDED_HEIGHT_FRACTION : SHEET_PEEK_HEIGHT_FRACTION;
  return containerHeightPx * fraction;
}

/** The sheet's own total rendered height, in px — see
 * `SHEET_OPEN_FULL_HEIGHT_FRACTION`'s doc comment. */
export function sheetTotalHeightPx(containerHeightPx: number): number {
  return containerHeightPx * SHEET_OPEN_FULL_HEIGHT_FRACTION;
}

/** The `translateY` (px, downward-positive, matching RNGH/Reanimated's own
 * convention) that shows exactly `sheetVisibleHeightPx(detent, ...)` of the
 * sheet above the container's bottom edge — `0` would show the sheet's
 * FULL rendered height (the "openFull" boundary), increasingly positive
 * values push more of it below the visible area. */
export function sheetTranslateYForDetent(
  detent: SheetDetent,
  containerHeightPx: number,
): number {
  return sheetTotalHeightPx(containerHeightPx) - sheetVisibleHeightPx(detent, containerHeightPx);
}

export interface ResolveSheetSnapInput {
  /** The sheet's current visible height in px at release (however it got
   * there — a drag, or a caller checking "what would the nearest detent be
   * for this height"), NOT the height at gesture-start. Deliberately the
   * only positional input this function needs: the slow-release branch only
   * ever cares where the drag ENDED, and the fast-release branch derives
   * "one step from here" from that same position (see the flick doc
   * comment above) rather than tracking a separate gesture-start detent. */
  currentHeightPx: number;
  /** Net vertical velocity in px/s at release, RNGH's own `velocityY`
   * convention: POSITIVE = moving DOWN (toward dismissing), NEGATIVE = UP
   * (toward expanding/opening). */
  velocityY: number;
  /** The map area's current height in px (the sheet's sizing reference —
   * `sheetVisibleHeightPx`'s own `containerHeightPx`). */
  containerHeightPx: number;
}

/**
 * Pure decision function: given the sheet's height and velocity at release,
 * which of the four `SheetSnapOutcome`s should it land on? Two regimes:
 *
 * 1. Slow release: nearest detent by position, using the MIDPOINT between
 *    each pair of adjacent heights as the decision boundary (past halfway
 *    toward the next detent snaps forward, short of halfway snaps back) —
 *    the same rubber-band-free snapping every native sheet implementation
 *    uses.
 * 2. Fast release (`|velocityY| >= SHEET_FLICK_VELOCITY_PX_PER_SEC`): moves
 *    exactly one step, in the flicked direction, from that same
 *    nearest-by-position detent — a quick upward flick started near "peek"
 *    reaches "expanded" even if the finger only travelled a little.
 */
export function resolveSheetSnapOutcome({
  currentHeightPx,
  velocityY,
  containerHeightPx,
}: ResolveSheetSnapInput): SheetSnapOutcome {
  const peekPx = containerHeightPx * SHEET_PEEK_HEIGHT_FRACTION;
  const expandedPx = containerHeightPx * SHEET_EXPANDED_HEIGHT_FRACTION;
  const openFullPx = containerHeightPx * SHEET_OPEN_FULL_HEIGHT_FRACTION;

  const dismissBoundaryPx = peekPx / 2;
  const peekExpandedMidpointPx = (peekPx + expandedPx) / 2;
  const expandedOpenFullMidpointPx = (expandedPx + openFullPx) / 2;

  let nearest: SheetSnapOutcome;
  if (currentHeightPx < dismissBoundaryPx) {
    nearest = "dismiss";
  } else if (currentHeightPx < peekExpandedMidpointPx) {
    nearest = "peek";
  } else if (currentHeightPx < expandedOpenFullMidpointPx) {
    nearest = "expanded";
  } else {
    nearest = "openFull";
  }

  if (Math.abs(velocityY) < SHEET_FLICK_VELOCITY_PX_PER_SEC) {
    return nearest;
  }

  const index = SNAP_OUTCOME_ORDER.indexOf(nearest);
  const step = velocityY > 0 ? -1 : 1;
  const nextIndex = Math.min(
    SNAP_OUTCOME_ORDER.length - 1,
    Math.max(0, index + step),
  );
  return SNAP_OUTCOME_ORDER[nextIndex] as SheetSnapOutcome;
}

export interface EventSheetController {
  /** The event currently shown by the sheet, or `null` when it's dismissed
   * — the single source of truth for "is the sheet open" (no separate
   * boolean to drift out of sync with it). */
  event: Event | null;
  detent: SheetDetent;
  /** Opens the sheet for `nextEvent` at the "peek" detent — also the
   * correct call for re-tapping a DIFFERENT marker while the sheet is
   * already open (expanded or not): a newly selected event always starts
   * from the smaller preview, never inherits the previous event's detent. */
  select: (nextEvent: Event) => void;
  setDetent: (detent: SheetDetent) => void;
  /** Clears the selection (`event` back to `null`) AND resets `detent` back
   * to "peek" — so the NEXT `select()` (a different marker, or the same one
   * tapped again later) always starts clean, regardless of how the
   * previous sheet session ended. */
  dismiss: () => void;
}

/**
 * The sheet's state machine, factored out of `map.web.tsx` as a plain hook
 * so it's independently testable via `renderHook` — no map, no DOM, no
 * Reanimated/Gesture-Handler involved (wave brief: "Sheet state machine...
 * opens on marker select, moves between detents, dismisses").
 */
export function useEventSheetController(): EventSheetController {
  const [event, setEvent] = useState<Event | null>(null);
  const [detent, setDetentState] = useState<SheetDetent>("peek");

  const select = useCallback((nextEvent: Event) => {
    setEvent(nextEvent);
    setDetentState("peek");
  }, []);

  const setDetent = useCallback((nextDetent: SheetDetent) => {
    setDetentState(nextDetent);
  }, []);

  const dismiss = useCallback(() => {
    setEvent(null);
    setDetentState("peek");
  }, []);

  return { event, detent, select, setDetent, dismiss };
}
