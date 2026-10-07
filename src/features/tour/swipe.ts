/** Horizontal travel (px) that counts as a deliberate swipe. */
export const SWIPE_MIN_DISTANCE = 48;
/** A quick flick (px/ms) counts with less travel. */
export const SWIPE_MIN_VELOCITY = 0.5;
const SWIPE_FLICK_MIN_DISTANCE = 20;

/**
 * Which way a finished horizontal drag steps the tour: +1 next, -1 back,
 * 0 nothing. Reading order decides: in a left-to-right language dragging the
 * card toward the left edge goes forward, in Sorani and Arabic toward the
 * right edge does (the card leaves toward the start of the line, as a page
 * turn does).
 */
export function swipeStep(dx: number, vx: number, rtl: boolean): -1 | 0 | 1 {
  const far = Math.abs(dx) >= SWIPE_MIN_DISTANCE;
  const flick =
    Math.abs(vx) >= SWIPE_MIN_VELOCITY && Math.abs(dx) >= SWIPE_FLICK_MIN_DISTANCE;
  if (!far && !flick) {
    return 0;
  }
  const towardLeft = dx < 0;
  const forward = rtl ? !towardLeft : towardLeft;
  return forward ? 1 : -1;
}
