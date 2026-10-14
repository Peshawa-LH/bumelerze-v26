/**
 * MapLibre's zoom buttons are 29 x 29 px by default — under the 44 pt touch
 * target every other control in the app keeps (review 2026-10-14, A-9/B-12).
 * Injected once, on the web only, by every embedded map that adds a
 * NavigationControl (event page SHAKEmap, handbook picker, building pin);
 * the Map tab scopes its own fuller stylesheet to its container.
 */
const STYLE_ID = "bml-map-zoom-touch-css";

export function ensureMapTouchControlStyle(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    ".maplibregl-ctrl-group button { width: 44px; height: 44px; }" +
    ".maplibregl-ctrl-group button + button { border-top-width: 1px; }";
  document.head.appendChild(style);
}
