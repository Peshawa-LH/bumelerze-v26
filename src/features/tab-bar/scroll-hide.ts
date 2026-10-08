/**
 * The decision behind "hide the tab bar when scrolling down, show it when
 * scrolling up" (a pure function, so it is unit-tested without a screen).
 *
 * The bar is laid out in the page, not floated over it: hiding it hands the
 * strip it occupied to the content. That is a layout change, so the rules
 * below are built so that the change itself can never trigger the opposite
 * decision (no flicker at the end of a page):
 *   - near the top and near the end of the page the bar is always shown;
 *   - hiding needs more room below than the strip being handed over;
 *   - a page that barely scrolls never hides it.
 */

/** Height of the strip the bar occupies (without the bottom safe-area inset).
 * Re-exported by the tab layout; must match `TAB_BAR_CONTENT_HEIGHT`. */
export const BAR_STRIP = 58;

/** Within this many px of the top the bar is always shown. */
export const TOP_ZONE = 24;
/** Scrolling down this far in one direction (px) hides the bar... */
export const HIDE_AFTER = 28;
/** ...and scrolling up this far shows it again. */
export const SHOW_AFTER = 16;
/** Never hide before the page has scrolled this far from the top. */
export const HIDE_MIN_OFFSET = 80;
/** Within this many px of the end the bar is always shown. */
export const END_ZONE = BAR_STRIP + 16;
/** Hiding needs this many px left below the viewport: the end zone plus the
 * strip handed to the content (the viewport grows by `BAR_STRIP` on hide) plus
 * a margin, so the new viewport is still outside the end zone. */
export const HIDE_MAX_DISTANCE_TO_END = END_ZONE + BAR_STRIP + 24;
/** A page with less than this much scrollable distance never hides the bar. */
export const MIN_SCROLLABLE = 200;

export interface ScrollSample {
  /** Vertical scroll offset, px. */
  offset: number;
  /** Visible height of the scroll view, px. */
  viewportHeight: number;
  /** Height of all the content, px. */
  contentHeight: number;
}

export interface ScrollHideState {
  /** Offset of the previous sample, or null before the first one. */
  lastOffset: number | null;
  /** Signed distance scrolled since the direction last changed. */
  travel: number;
}

export const INITIAL_SCROLL_HIDE_STATE: ScrollHideState = {
  lastOffset: null,
  travel: 0,
};

/**
 * Next state and whether the bar should be hidden, given the current
 * visibility and a scroll sample.
 */
export function nextScrollHide(
  hidden: boolean,
  state: ScrollHideState,
  sample: ScrollSample,
): { state: ScrollHideState; hidden: boolean } {
  const offset = Math.max(0, sample.offset);
  const delta = state.lastOffset === null ? 0 : offset - state.lastOffset;
  // A change of direction starts counting again from zero.
  const travel =
    Math.sign(delta) === Math.sign(state.travel) ? state.travel + delta : delta;
  const nextState: ScrollHideState = { lastOffset: offset, travel };

  const distanceToEnd = sample.contentHeight - (offset + sample.viewportHeight);
  const scrollable = sample.contentHeight - sample.viewportHeight;

  // Short page, top of the page, end of the page (incl. overscroll): shown.
  if (scrollable < MIN_SCROLLABLE || offset <= TOP_ZONE || distanceToEnd <= END_ZONE) {
    return { state: nextState, hidden: false };
  }
  if (!hidden && travel >= HIDE_AFTER && offset >= HIDE_MIN_OFFSET) {
    if (distanceToEnd > HIDE_MAX_DISTANCE_TO_END) {
      return { state: nextState, hidden: true };
    }
  }
  if (hidden && travel <= -SHOW_AFTER) {
    return { state: nextState, hidden: false };
  }
  return { state: nextState, hidden };
}
