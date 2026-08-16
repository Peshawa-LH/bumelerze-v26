/**
 * Tunable constants for the web map (Map tab, web-first wave). Web only —
 * see `app/(tabs)/map.web.tsx`'s doc comment for why the interactive map is
 * gated to the web platform this wave.
 */

/**
 * OpenFreeMap (https://openfreemap.org) style URLs — free, no API key, no
 * signup, per PROJECT.md's "boring, well-documented" preference and the
 * wave brief's explicit basemap choice. Verified live (2026-08-16: both
 * URLs return `200 application/json` style documents) rather than assumed
 * from docs. Picked by the app's active color scheme (`useTheme().scheme`),
 * matching the app's own dark-is-primary convention (design-language.md
 * §4) instead of always shipping one style.
 */
export const MAP_STYLE_URLS = {
  light: "https://tiles.openfreemap.org/styles/liberty",
  dark: "https://tiles.openfreemap.org/styles/dark",
} as const;

/**
 * The style *documents* above carry no `attribution` string on their
 * `sources` block (verified live), but the vector `openmaptiles` source
 * they reference points at a separate TileJSON endpoint
 * (https://tiles.openfreemap.org/planet) which DOES carry a correct,
 * live-verified `attribution` string — MapLibre fetches that TileJSON
 * itself and feeds it into `AttributionControl` automatically. We used to
 * also pass a hand-typed `customAttribution` copy of that same credit line;
 * MapLibre concatenates `customAttribution` with every source's real
 * attribution rather than de-duping near-identical-but-not-byte-identical
 * HTML strings, which is exactly what made the credit line render twice on
 * screen. Fix: don't hand-maintain a duplicate copy — the source already
 * supplies the correct text, so `AttributionControl` is constructed below
 * with `compact: false` only (always expanded, never hidden behind a
 * toggle — wave brief: "REQUIRED: visible attribution... do not hide it")
 * and no `customAttribution`.
 */

/**
 * maplibre-gl 6.x has no bundler-friendly "workerClass"/CSP-worker option
 * (removed from the package; verified against the installed version's own
 * source) — it always instantiates a real `new Worker(workerUrl, { type:
 * "module" })`, and by default derives that URL relative to its own chunk's
 * URL (`import.meta.url`). Metro's web bundler never emits a matching
 * sibling file next to that chunk (it only bundles modules reached through
 * static/dynamic `import`, never a runtime string handed to the real
 * `Worker` constructor), so the default URL always 404s — masked as an SPA
 * fallback HTML page in the deployed export, hanging the map forever.
 *
 * Fix: `scripts/sync-maplibre-worker.js` copies the worker bundle (and the
 * shared chunk it imports) from `node_modules/maplibre-gl/dist` into
 * `public/` on every `npm install` — Expo's web dev server serves `public/`
 * verbatim at the origin root, and the production export copies it into
 * the export output root — so this path resolves to a real, always-served
 * file in both environments. `process.env.EXPO_BASE_URL` is the same
 * build-time-inlined constant Expo Router itself uses for subpath hosting
 * (empty locally, "/app" in the Netlify export per `app.config.ts`'s
 * `experiments.baseUrl` / `BUMELERZE_WEB_BASE_URL`), so this always matches
 * wherever the app itself is actually served from.
 */
export const MAP_WORKER_URL = `${process.env.EXPO_BASE_URL ?? ""}/maplibre-gl-worker.mjs`;

/** Marker visual size range, magnitude-scaled (marker-helpers.ts). Kept
 * modest — a full-screen map showing dozens of the 30-day region window's
 * events must stay legible, not turn into a field of giant circles. */
export const MARKER_MIN_DIAMETER_PX = 14;
export const MARKER_MAX_DIAMETER_PX = 34;

/** Magnitude clamp bounds feeding the linear diameter interpolation —
 * events below `MARKER_MAGNITUDE_FLOOR` all render at the minimum size,
 * events at/above `MARKER_MAGNITUDE_CEILING` all render at the maximum
 * (event-pipeline-design.md territory doesn't fix a display ceiling, so
 * this is an engineering default, D14). */
export const MARKER_MAGNITUDE_FLOOR = 0;
export const MARKER_MAGNITUDE_CEILING = 7;

/** Extra invisible padding around each marker's visible dot, widening the
 * clickable/tappable area beyond what the small dot itself would give —
 * "big touch targets on markers (extra hit radius)" (wave brief,
 * panic-time UX). Applied symmetrically, so the hit target is always
 * `diameter + 2 * MARKER_HIT_PADDING_PX` on each side. */
export const MARKER_HIT_PADDING_PX = 10;

/** Padding (px) around the fitted region bbox so edge markers aren't
 * clipped by the viewport/screen edge on initial load. */
export const MAP_FIT_BOUNDS_PADDING_PX = 32;
