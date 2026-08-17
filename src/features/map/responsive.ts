/**
 * Responsive rule for the map's floating controls (Problem 1: "controls
 * crowd the map at phone width"). A single breakpoint, not a hard phone/
 * desktop split — any window narrower than this collapses the filter/style
 * controls to compact icon buttons that open as popovers on tap; anything
 * wider keeps their current always-legible header bar, since there's
 * genuinely room for it. `map.web.tsx` owns the actual `window.innerWidth`
 * read (a DOM concern); this module only holds the pure threshold decision
 * so it's independently testable without a `window`/resize listener.
 */

/** Comfortably above typical phone portrait widths (~360-430px, including
 * the ~375px viewport this wave was diagnosed against) and below small-
 * tablet/landscape widths, so a tablet or a roomy desktop browser window
 * naturally gets the wider inline layout instead of being forced into
 * icon-only controls it doesn't need. */
export const MAP_CONTROLS_COMPACT_MAX_WIDTH_PX = 480;

/** True when `widthPx` is narrow enough that the map's filter/style
 * controls should render as compact icon buttons rather than their full
 * header bar. */
export function isCompactMapControlsWidth(widthPx: number): boolean {
  return widthPx < MAP_CONTROLS_COMPACT_MAX_WIDTH_PX;
}
