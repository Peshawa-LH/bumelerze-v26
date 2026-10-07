/**
 * The app tour's stops, in the order they are shown (owner request,
 * 2026-10-08: a short guided tour of the app after onboarding). Keys only:
 * every stop's copy lives in `tour.stops.<id>.title|body` in the four locale
 * catalogs, and its picture is a live preview component looked up by id in
 * `components/previews`. One list, so the screen, the progress dots and the
 * tests can never disagree about count or order.
 */
export const TOUR_STOP_IDS = [
  "home",
  "felt",
  "hub",
  "map",
  "sensor",
  "safety",
  "account",
  "share",
] as const;

export type TourStopId = (typeof TOUR_STOP_IDS)[number];

export function tourStopTitleKey(id: TourStopId): string {
  return `tour.stops.${id}.title`;
}

export function tourStopBodyKey(id: TourStopId): string {
  return `tour.stops.${id}.body`;
}
