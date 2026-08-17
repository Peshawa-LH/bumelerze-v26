/**
 * MapLibre's RTL text-shaping plugin gate (owner feedback, 2026-08-17: "in
 * Kurdish the names are not correctly rendered"). Without this plugin,
 * MapLibre renders Arabic-script text (Sorani `ckb`, Arabic `ar` — both
 * `name:ar`/`name:ckb` label values AND `own-labels.ts`'s gazetteer labels)
 * as a row of disconnected, unjoined letter forms — Arabic script is
 * cursive and *shapes* differ by position-in-word (isolated/initial/medial/
 * final); only the plugin's ICU-derived shaping engine produces the
 * correctly joined glyphs MapLibre's text layout then also reorders
 * visually right-to-left. This is a real, separate rendering stage from
 * `labels.ts`'s `text-field` swap (which only decides WHICH string gets
 * displayed) — both are required together for Kurdish labels to read
 * correctly.
 *
 * `maplibre-gl`'s `setRTLTextPlugin(url, lazy)` is a page-wide singleton
 * (module-scope state inside the `maplibre-gl` package itself, not
 * per-`Map`-instance) that THROWS if called a second time — see the
 * installed package's own source (`RTLMainThreadPlugin.setRTLTextPlugin`):
 * `if (this.url) throw new Error("setRTLTextPlugin cannot be called
 * multiple times.")`. Because `map.web.tsx`'s map-creation effect can
 * legitimately re-run more than once per page load — a screen
 * remount/refocus, or the MapTiler→OpenFreeMap runtime fallback recreating
 * the map instance (`style-provider.ts`'s `decideMapErrorAction`) — calling
 * it unconditionally on every map creation would throw (as an unhandled
 * promise rejection, since the call site never awaits it) on the second
 * and every later attempt.
 *
 * The guard: `getRTLTextPluginStatus()` starts at `"unavailable"` and is
 * moved away from that by the FIRST successful `setRTLTextPlugin` call
 * (`"deferred"` for the lazy path this app uses) and never returns to
 * `"unavailable"` afterward (barring an explicit `clearRTLTextPlugin()`
 * this app never calls) — so "only request the plugin while status is
 * still `unavailable`" is both necessary and sufficient for
 * call-it-at-most-once-per-page-load idempotency, independent of how many
 * times the surrounding React effect re-runs.
 */
export function shouldRequestRTLTextPlugin(status: string): boolean {
  return status === "unavailable";
}
