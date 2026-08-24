import "maplibre-gl/dist/maplibre-gl.css";

import { useFocusEffect } from "expo-router";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  Marker as MapLibreMarker,
} from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import {
  formatMagnitudeValue,
  REGION_BBOX,
  useRegionEvents,
  useWorldEvents,
  type Event,
} from "@/features/events";
import { parseKurdishPlaces, placeLine, type KurdishPlace } from "@/features/geo";
import {
  buildArabicNameTextField,
  buildMergedOwnLabelFeatureCollection,
  buildOwnLabelsLayer,
  buildOwnLabelsSource,
  buildRegionMarkers,
  buildTerrainDemSource,
  buildTerrainHillshadeLayer,
  computeDateBoundsMs,
  computeMagnitudeBounds,
  decideMapErrorAction,
  DEFAULT_MAP_SCOPE,
  EventPreviewSheet,
  filterEventsByMagnitudeAndDate,
  findHillshadeBeforeLayerId,
  findNameLabelLayerIds,
  getConfiguredMapTilerKey,
  hexToRgba,
  isCompactMapControlsWidth,
  KURDISH_PLACES_CORE,
  MAP_FIT_BOUNDS_PADDING_PX,
  MAP_RTL_TEXT_PLUGIN_URL,
  MAP_WORKER_URL,
  MapFilterPanel,
  MARKER_HIT_PADDING_PX,
  MapStylePicker,
  MapTilerAttributionLogo,
  OWN_LABELS_DEFAULT_FONT,
  OWN_LABELS_SOURCE_ID,
  regionBboxToLngLatBounds,
  resolveCatalogMapStyle,
  ScopeToggle,
  shouldLocalizeToArabicScript,
  shouldRequestRTLTextPlugin,
  styleHasRasterDemSource,
  TERRAIN_DEM_SOURCE_ID,
  useEventSheetController,
  useMapPreferencesStore,
  useReducedMotionPreference,
  WORLD_VIEW_BBOX,
  type DateRangeMs,
  type EventPreviewSheetHandle,
  type MagnitudeRange,
  type MapScope,
  type MapStyleCatalogId,
  type MapStyleProviderId,
} from "@/features/map";
import { useTheme } from "@/theme";

/** Fixed, deliberately modest pixel nudge applied to the map's viewport
 * center when a marker is selected (`easeTo`'s `offset`, in the marker
 * activation handler below) so the newly-opened preview sheet doesn't sit
 * directly on top of it — see that call site's own doc comment for why this
 * is a small fixed constant rather than something computed from the sheet's
 * exact peek height. */
const MAP_SHEET_SELECT_OFFSET_PX = 90;

/** Max on-screen movement (px) between `pointerdown` and `pointerup` on a
 * marker's hit element that still counts as a TAP rather than the start of
 * a map pan/drag gesture that happened to begin on top of a marker —
 * mirrors MapLibre's own default camera `clickTolerance` (3px, its
 * `Map` constructor option) with a little more give for touch, since a
 * finger's contact point drifts more between down and up than a mouse
 * cursor does even during a stationary tap. See the marker-activation
 * block below (marker-build effect) for why this is the primary tap
 * detection at all, instead of the browser's native `click` event. */
const MARKER_TAP_TOLERANCE_PX = 8;

/**
 * Lazily loads the tier-3 (village/hamlet) Kurdish-places dataset — by far
 * the largest slice of `@/features/geo/data/kurdish-places-villages.json`
 * (own-labels.ts's module doc comment) — via a dynamic `import()`, the same
 * "not paid for until the Map tab is actually opened" pattern this file
 * already uses for `maplibre-gl` itself just below. A module-scope
 * singleton promise: the underlying `import()` only ever runs once per app
 * session (subsequent calls, e.g. a later locale/style switch, resolve
 * from the already-settled promise instantly) — Metro's own module cache
 * would make a second `import()` of the same specifier resolve instantly
 * anyway, but caching the promise itself also avoids a second
 * `parseKurdishPlaces` zod pass over ~5,600 records for no reason.
 *
 * Handles both possible resolved-module shapes defensively: Jest (via
 * `babel-plugin-dynamic-import-node`, see babel.config.js) resolves a
 * dynamic `import()` of a `.json` file to the bare parsed array (CJS
 * `require` semantics), while Metro's real ESM-interop dynamic import
 * resolves to a module namespace object whose `.default` is that same
 * array — `Array.isArray` distinguishes the two without needing separate
 * test-only vs. production code paths.
 */
let kurdishVillagesPromise: Promise<KurdishPlace[]> | null = null;
function loadKurdishVillagePlaces(): Promise<KurdishPlace[]> {
  kurdishVillagesPromise ??=
    import("@/features/geo/data/kurdish-places-villages.json").then((mod: unknown) => {
      const raw = Array.isArray(mod) ? mod : (mod as { default?: unknown }).default;
      return parseKurdishPlaces(raw);
    });
  return kurdishVillagesPromise;
}

/**
 * Requests MapLibre's RTL text-shaping plugin — MUST run before `new
 * maplibre.Map(...)` (same ordering requirement as `setWorkerUrl` just
 * above it; the map/its workers read plugin state at construction/tile-parse
 * time). Guarded by `shouldRequestRTLTextPlugin` so re-running the creation
 * effect (screen remount, or the MapTiler→OpenFreeMap runtime fallback
 * recreating the map instance) never calls `setRTLTextPlugin` a second
 * time — see `rtl-plugin.ts`'s doc comment for why that would otherwise
 * throw. `lazy: true`: the plugin script itself (`MAP_RTL_TEXT_PLUGIN_URL`)
 * is only fetched once the map actually encounters RTL text, so a session
 * that never switches to `ckb`/`ar` never pays that download
 * (panic-time/low-bandwidth priority). Fire-and-forget with a swallowed
 * `.catch` — a failed plugin fetch (offline, blocked request) should degrade
 * to unshaped Arabic-script labels, not crash the map.
 */
function ensureRTLTextPluginLoaded(maplibre: typeof import("maplibre-gl")): void {
  if (shouldRequestRTLTextPlugin(maplibre.getRTLTextPluginStatus())) {
    maplibre.setRTLTextPlugin(MAP_RTL_TEXT_PLUGIN_URL, true).catch(() => {
      // Swallowed: see doc comment above. `getRTLTextPluginStatus()` moves
      // to `"error"` on its own, nothing here needs to react further.
    });
  }
}

/** Reads the FIRST cached name-label layer's `text-font` off the live map
 * (falls back to `OWN_LABELS_DEFAULT_FONT` if the style had no name-label
 * layer at all) — see `own-labels.ts`'s `buildOwnLabelsLayer` doc comment
 * for why our own labels borrow the ACTIVE style's own font stack rather
 * than a hardcoded one (glyph-availability correctness across providers). */
function resolveOwnLabelsFont(
  map: MapLibreMap,
  nameLabelLayerIds: readonly string[],
): readonly string[] {
  const [firstLayerId] = nameLabelLayerIds;
  if (!firstLayerId) {
    return OWN_LABELS_DEFAULT_FONT;
  }
  const font = map.getLayoutProperty(firstLayerId, "text-font");
  return Array.isArray(font) ? (font as string[]) : OWN_LABELS_DEFAULT_FONT;
}

/**
 * Populates `hillshade`/label localization/own-labels for a freshly-loaded
 * map — called once from the `"load"` handler below.
 *
 * Terrain: skipped when the active style already ships its own
 * `raster-dem` source (MapTiler's outdoor styles do —
 * `styleHasRasterDemSource`'s doc comment).
 *
 * Basemap label localization: caches each name-labeling symbol layer's
 * ORIGINAL `text-field` into `originalTextFields` (keyed by layer id) so
 * `applyLocaleLabels` below can restore it exactly when the active locale
 * later switches back to a non-Arabic-script one, rather than trying to
 * reconstruct it.
 *
 * Own Kurdistan-city labels (`own-labels.ts`): added as a GeoJSON source +
 * symbol layer, appended LAST (no `beforeId`) so the layer sits above every
 * basemap layer — see `own-labels.ts`'s module doc comment for why that
 * ordering is what suppresses the basemap's own duplicate labels for the
 * same cities, via MapLibre's cross-layer collision index, with no basemap
 * style edits needed. Built with `locale` already applied (not the
 * default), so there's no flash of the wrong language before the
 * locale-reactive effect further down would otherwise correct it.
 *
 * Plain module-scope wiring (not a hook) — every actual decision it makes
 * (which layer to insert before, whether a DEM source already exists, which
 * layers are name labels, which cities/labels to draw) is delegated to the
 * pure, independently-tested helpers from `@/features/map`; this function
 * is just the MapLibre-API glue, exercised by the `map-web-*.test.tsx`
 * integration tests via the mocked `maplibre-gl` module (same split as the
 * marker-building loop further down this file).
 */
function primeTerrainAndLabelCache(
  map: MapLibreMap,
  scheme: "light" | "dark",
  locale: string,
  originalTextFields: Map<string, unknown>,
  kurdishPlaces: readonly KurdishPlace[],
): void {
  const style = map.getStyle();
  if (!style) {
    return;
  }

  if (!styleHasRasterDemSource(style.sources)) {
    map.addSource(TERRAIN_DEM_SOURCE_ID, buildTerrainDemSource());
    const beforeId = findHillshadeBeforeLayerId(style.layers ?? []);
    map.addLayer(buildTerrainHillshadeLayer(scheme), beforeId);
  }

  originalTextFields.clear();
  const nameLabelLayerIds = findNameLabelLayerIds(style.layers ?? []);
  for (const layerId of nameLabelLayerIds) {
    originalTextFields.set(layerId, map.getLayoutProperty(layerId, "text-field"));
  }

  const ownLabelsFont = resolveOwnLabelsFont(map, nameLabelLayerIds);
  map.addSource(
    OWN_LABELS_SOURCE_ID,
    buildOwnLabelsSource(
      buildMergedOwnLabelFeatureCollection(locale, REGION_BBOX, undefined, kurdishPlaces),
    ),
  );
  map.addLayer(buildOwnLabelsLayer(scheme, ownLabelsFont));
}

/**
 * `Map.setLayoutProperty`'s TS overload constrains `"text-field"`'s value to
 * MapLibre's own `DataDrivenPropertyValueSpecification<Formatted>` type; the
 * values handled here are always either a hand-built expression
 * (`buildArabicNameTextField()`) or a style's own pre-existing text-field
 * expression read back via `getLayoutProperty` moments earlier — both are
 * valid MapLibre expression JSON at runtime, just not something TS can prove
 * from an `unknown`-typed cache value without an explicit assertion. One
 * narrow, documented cast here beats sprinkling `as` at every call site.
 */
function setTextField(map: MapLibreMap, layerId: string, value: unknown): void {
  (map.setLayoutProperty as (id: string, name: "text-field", value: unknown) => void)(
    layerId,
    "text-field",
    value,
  );
}

/** Applies (or reverts) Arabic-script place names on every cached
 * name-labeling layer for the given locale — the single place both the
 * initial load and later locale switches funnel through, so the two never
 * drift out of sync. */
function applyLocaleLabels(
  map: MapLibreMap,
  locale: string,
  originalTextFields: Map<string, unknown>,
): void {
  const useArabicNames = shouldLocalizeToArabicScript(locale);
  originalTextFields.forEach((originalTextField, layerId) => {
    setTextField(
      map,
      layerId,
      useArabicNames ? buildArabicNameTextField() : originalTextField,
    );
  });
}

/** Rebuilds the own-labels source's GeoJSON data from whatever's currently
 * in `kurdishPlacesRef` (core-only, or core+villages once the lazy load
 * has resolved) for `locale`, and pushes it into the live map via
 * `GeoJSONSource.setData` — the single place both the villages-resolved
 * callback and the locale-switch effect below push a refresh through, so
 * the two can never build the merged collection differently. No-ops
 * quietly if `map` is `null` or the source isn't there yet (map torn
 * down/not yet loaded) rather than throwing from an async callback. */
function refreshOwnLabelsSource(
  map: MapLibreMap | null,
  locale: string,
  kurdishPlaces: readonly KurdishPlace[],
): void {
  const ownLabelsSource = map?.getSource(OWN_LABELS_SOURCE_ID) as
    GeoJSONSource | undefined;
  ownLabelsSource?.setData(
    buildMergedOwnLabelFeatureCollection(locale, REGION_BBOX, undefined, kurdishPlaces),
  );
}

/**
 * Tracks whether the map's floating filter/style controls should render
 * compact (Problem 1) — a plain `window.innerWidth` + `resize`-listener
 * hook rather than React Native's own `useWindowDimensions`: this whole
 * file is already web-only (Metro never bundles it for native, per this
 * file's own top-of-file doc comment), so reading `window` directly here
 * costs nothing platform-wise and keeps the test-facing surface a plain DOM
 * global a `jsdom` test can set/dispatch against directly, with no extra
 * RN-Web dimensions-event mock to maintain. The actual threshold decision
 * (`isCompactMapControlsWidth`) is the pure, independently-tested half —
 * see `responsive.ts`.
 */
function useIsCompactMapControls(): boolean {
  const [isCompact, setIsCompact] = useState(() =>
    isCompactMapControlsWidth(window.innerWidth),
  );
  useEffect(() => {
    function handleResize(): void {
      setIsCompact(isCompactMapControlsWidth(window.innerWidth));
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  return isCompact;
}

/**
 * Web Map tab — the real interactive map (wave brief: "web-first... the
 * deployed web build (now at bumelerze.com/app) is the primary live
 * channel; the native MapLibre module waits for the dev-build workflow").
 *
 * Metro-only file: this `.web.tsx` platform-extension sibling of `map.tsx`
 * is the *only* module in the app that imports `maplibre-gl` — Metro's
 * platform resolver never even considers this file (or anything it
 * imports) when bundling for iOS/Android, so the dependency and its CSS
 * never reach a native bundle by construction, not just by a runtime
 * `Platform.OS` check. `maplibre-gl` itself is still loaded lazily via a
 * dynamic `import()` below (not a static top-of-file import) so its ~large
 * JS chunk only downloads once this tab is actually focused
 * (panic-time/low-bandwidth: never paid for by someone who never opens the
 * Map tab).
 *
 * Content: halo+core markers for the already-loaded region feed
 * (`useRegionEvents` — no new fetching), sized/colored by magnitude, tap →
 * a preview sheet over the map. Every event in the filtered set renders as
 * its own marker at every zoom — overlap at low zoom is an accepted trade
 * (clustering was tried and removed: two rounds of tap-through bugs traced
 * to it, and the owner's explicit call afterward was that a badge that
 * hides which events it stands for isn't worth the tidiness). No shakemap
 * overlay, felt cells, or fault lines yet (follow-up waves).
 */
export default function MapScreenWeb() {
  const { t, i18n } = useTranslation();
  const { colors, scheme, spacing, typography } = useTheme();
  const insets = useSafeAreaInsets();

  const { events: regionEvents, dataUpdatedAt: regionDataUpdatedAt } = useRegionEvents();
  const { events: worldEvents, dataUpdatedAt: worldDataUpdatedAt } = useWorldEvents();

  // Event-preview sheet (map-UX wave: "the map doesn't close fully, but a
  // slider type thing opens") — `eventSheet` is the sheet's own state
  // machine (`event-sheet.ts`, independently tested), `sheetRef` is how the
  // MAP's own "click the background to dismiss" handler (registered once,
  // inside the map-creation effect below, which never re-runs on a
  // selection change) reaches the sheet's ANIMATED close path — see that
  // handler's own doc comment.
  const eventSheet = useEventSheetController();
  // Destructured out for the marker-build effect's own dependency array
  // below — `eventSheet` itself is a fresh object every render (its own
  // doc comment explains why: `content`/`detent` need to be read live), but
  // `select` is individually stable (`useEventSheetController`'s own
  // `useCallback`), so depending on THIS instead of `eventSheet.select`
  // lets `react-hooks/exhaustive-deps` see that stability directly, rather
  // than defeating the effect's whole "only rebuild markers when the data
  // actually changes" purpose by depending on the ever-changing whole
  // object.
  const selectEvent = eventSheet.select;
  const sheetRef = useRef<EventPreviewSheetHandle>(null);
  const prefersReducedMotion = useReducedMotionPreference();

  // Persisted basemap style pick (update-plan-2026-08.md §4.3/Part 3:
  // "Persist his choice locally so it survives reloads") — selectors, not
  // the whole store, matching this app's established zustand-consumption
  // convention (`usePrefsStore` call sites elsewhere).
  const styleId = useMapPreferencesStore((state) => state.styleId);
  const setStyleId = useMapPreferencesStore((state) => state.setStyleId);
  const hasStyleHydrated = useMapPreferencesStore((state) => state.hasHydrated);

  // Kurdistan/World scope (§4.1) — Kurdistan default (region-first
  // principle, D11/D26). Switching scope also resets any active
  // magnitude/date filter selection back to "full range" (below) so a
  // filter narrowed against one scope's data never silently misapplies to
  // the other scope's very different natural distribution (World is
  // M4.5+/7 days; Kurdistan is the full region pool).
  const [scope, setScope] = useState<MapScope>(DEFAULT_MAP_SCOPE);
  const scopedEvents = scope === "world" ? worldEvents : regionEvents;
  // React Query's own fetch-success timestamp for whichever feed is active
  // — used below as the date filter's "now" edge INSTEAD OF a plain
  // `Date.now()` read (see `dateBounds`'s comment for why that would be a
  // real bug here, not just a style nit).
  const scopedDataUpdatedAt =
    scope === "world" ? worldDataUpdatedAt : regionDataUpdatedAt;

  // Magnitude/date filters (§4.4) — `null` means "no custom selection yet,
  // use the scope's current full bounds" (computed below), so the filter
  // never hides anything until the user actually drags a handle.
  const [magnitudeRange, setMagnitudeRange] = useState<MagnitudeRange | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeMs | null>(null);

  // Which of the filter/style floating controls is currently open — a
  // single piece of state (not two independent booleans) is what makes
  // "one open at a time" true by construction: opening one can only ever
  // mean setting this to that control's id, which necessarily stops being
  // the OTHER control's id (Problem 1: "tapping ... another control closes
  // the open one"). `isCompactControls` (below) decides whether each
  // control RENDERS this state as a floating popover-from-icon or today's
  // always-expanded inline bar; the exclusivity itself applies at every
  // width, not just the compact one.
  type MapControlId = "filters" | "style";
  const [openControl, setOpenControl] = useState<MapControlId | null>(null);
  const closeOpenControl = useCallback(() => setOpenControl(null), []);
  const toggleControl = useCallback((id: MapControlId) => {
    setOpenControl((current) => (current === id ? null : id));
  }, []);
  const isCompactControls = useIsCompactMapControls();

  const handleScopeChange = useCallback((nextScope: MapScope) => {
    setScope(nextScope);
    setMagnitudeRange(null);
    setDateRange(null);
  }, []);

  const handleResetFilters = useCallback(() => {
    setMagnitudeRange(null);
    setDateRange(null);
  }, []);

  // Keyboard dismissal: Escape closes whichever control popover is open —
  // the backdrop below covers pointer/touch "tap elsewhere"; this covers
  // keyboard users who never touch the map surface at all.
  useEffect(() => {
    if (!openControl) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpenControl(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openControl]);

  // Recomputed whenever the scoped event pool changes (a new 60s poll, or a
  // scope switch) — deliberately NOT frozen at scope-switch time, so the
  // date bound's "now" edge and the magnitude bound both keep tracking
  // fresh data for an untouched (`null`) selection. An explicit user
  // selection (non-null) is unaffected by this recompute; only
  // `handleScopeChange`/`handleResetFilters` above clear it.
  const magnitudeBounds = useMemo(
    () => computeMagnitudeBounds(scopedEvents),
    [scopedEvents],
  );
  // "Now" for the date filter's upper bound — deliberately `scopedDataUpdatedAt`
  // (React Query's own last-successful-fetch timestamp for the active feed),
  // NOT a plain `Date.now()` read in the render body. Unlike
  // `EventListScreen.tsx`'s own `now` (fine there — it only feeds JSX text
  // directly), this value feeds `dateBounds`'s `useMemo` dependency array
  // below, which itself feeds `filteredEvents` and the marker-rebuild
  // effect: a render-time value that differs on literally every render
  // (even ones caused by something unrelated, like toggling the style
  // panel) would defeat that memoization entirely and rebuild every marker
  // on every unrelated re-render — confirmed the hard way while building
  // this (`map-web-filters.test.tsx`'s early failures traced to exactly
  // this). `dataUpdatedAt` only actually changes when the feed genuinely
  // refetches (each ~60s poll, or a scope switch reading the other feed's
  // value), which is also the semantically correct "now" for a
  // just-fetched dataset — and it's a plain number already sitting in
  // React Query's state, not an impure call at all.
  const dateBounds = useMemo(
    () => computeDateBoundsMs(scopedEvents, scopedDataUpdatedAt),
    [scopedEvents, scopedDataUpdatedAt],
  );
  const effectiveMagnitudeRange = magnitudeRange ?? magnitudeBounds;
  const effectiveDateRange = dateRange ?? dateBounds;

  const filteredEvents = useMemo(
    () =>
      filterEventsByMagnitudeAndDate(
        scopedEvents,
        effectiveMagnitudeRange,
        effectiveDateRange,
      ),
    [scopedEvents, effectiveMagnitudeRange, effectiveDateRange],
  );

  // Same "closure captured a value at effect-setup time, but needs the
  // LATEST one when an async callback actually resolves" concern as
  // `routerRef` above — `loadKurdishVillagePlaces()`'s `.then` (the "load"
  // handler below) fires whenever the network resolves, which may be well
  // after a locale switch, so it reads `i18nRef.current.language` rather
  // than closing over `i18n.language` from when the map was created.
  const i18nRef = useRef(i18n);
  useEffect(() => {
    i18nRef.current = i18n;
  }, [i18n]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreModuleRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markersRef = useRef<MapLibreMarker[]>([]);
  // Re-entrancy gate for the creation effect below — deliberately a ref,
  // not state: the effect itself calls `setLoadState("loading")`, and if
  // `loadState` were also in that effect's dependency array, that very
  // state update would immediately re-run (and tear down/cancel) the same
  // effect before its async `import()` ever resolved. `retryTick` is what
  // legitimately reruns it (`handleRetry` clears this flag first).
  const creationStartedRef = useRef(false);
  // Which provider the map instance CURRENTLY being built is using —
  // written every time the creation effect resolves a style, read by the
  // "error" handler below to decide whether this is a MapTiler failure
  // worth falling back from, or an OpenFreeMap failure that's just the
  // genuine offline/error state (`decideMapErrorAction`).
  const activeProviderRef = useRef<MapStyleProviderId>("openfreemap");
  // Render-visible twin of `activeProviderRef` — the ref is what closures
  // (the "error" handler, `decideMapErrorAction`) read synchronously;
  // this state is what JSX reads to decide whether the MapTiler
  // attribution logo (Part 4) should show. Always written alongside the
  // ref, never instead of it.
  const [activeProvider, setActiveProvider] = useState<MapStyleProviderId>("openfreemap");
  // One-shot MapTiler→OpenFreeMap runtime fallback latch (style-provider.ts
  // doc comment: "never loops"). Reset on a user-initiated retry
  // (`handleRetry`) so a manual retry gets a fresh shot at MapTiler rather
  // than being stuck on the fallback forever after one bad network blip.
  const fallbackAttemptedRef = useRef(false);
  // Layer id → ORIGINAL `text-field` expression, cached once per map
  // instance right after "load" (`primeTerrainAndLabelCache`) so later
  // locale switches (`applyLocaleLabels`) can restore the non-Arabic-script
  // default exactly instead of reconstructing it.
  const originalTextFieldsRef = useRef<Map<string, unknown>>(new Map());
  // Kurdish-places dataset currently available to the own-labels layer —
  // starts at `KURDISH_PLACES_CORE` (small, always bundled, tier 1-2 only)
  // and grows to include the lazily-`import()`ed tier-3 village dataset
  // once `loadKurdishVillagePlaces` resolves (the "load" handler below).
  // Read by every own-labels (re)build (initial load, locale switch, style
  // swap) so villages show up in whichever of those happens to run first
  // AFTER the lazy load resolves, without a separate dedicated effect.
  const kurdishPlacesRef = useRef<readonly KurdishPlace[]>(KURDISH_PLACES_CORE);

  const [isFocused, setIsFocused] = useState(false);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [retryTick, setRetryTick] = useState(0);

  // "Map loads lazily when the tab is focused" (wave brief) — the mount
  // effect below only starts loading `maplibre-gl` once this becomes true.
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  // Creates the map exactly once, the first time the tab is focused (and
  // once the persisted style preference has hydrated — see
  // `useMapPreferencesStore`'s doc comment: without this gate, a returning
  // user with a non-default style saved would briefly build the map with
  // the `outdoor` default before their real pick loads). Not re-run on
  // scheme change — the style URL is only read at creation time this wave
  // (flipping OS theme mid-session won't hot-swap the basemap; a small,
  // deliberate scope cut, not a bug). Later user-driven style PICKS (the
  // `MapStylePicker` control) go through `handleStyleChange` below, which
  // live-swaps the existing map instance's style rather than recreating it.
  useEffect(() => {
    if (!isFocused || !hasStyleHydrated || creationStartedRef.current) {
      return;
    }
    if (!containerRef.current) {
      return;
    }

    creationStartedRef.current = true;
    let cancelled = false;
    // Whether THIS map instance ever reached "load" — a plain local (not a
    // ref/state) since both handlers below close over it directly; feeds
    // `decideMapErrorAction`'s `hasReachedReady`.
    let hasLoaded = false;
    setLoadState("loading");

    // A prior instance's runtime fallback (see the "error" handler below)
    // forces OpenFreeMap for every subsequent (re)creation until
    // `handleRetry` resets the latch — `resolveCatalogMapStyle` is handed
    // the MapTiler key explicitly (unlike the old single-family
    // `resolveMapStyle`, since this catalog-aware resolver has no built-in
    // env read of its own — see `style-catalog.ts`).
    const { provider, url: styleUrl } = resolveCatalogMapStyle(
      styleId,
      scheme,
      getConfiguredMapTilerKey(),
      fallbackAttemptedRef.current ? "openfreemap" : undefined,
    );
    activeProviderRef.current = provider;
    setActiveProvider(provider);

    import("maplibre-gl")
      .then((module) => {
        if (cancelled || !containerRef.current) {
          return;
        }
        const maplibre = module;
        maplibreModuleRef.current = maplibre;

        // Must run before `new maplibre.Map(...)` below — the map reads
        // the worker URL once, at construction, when it spins up its
        // worker pool. See MAP_WORKER_URL's doc comment (config.ts) for
        // why this is required at all (maplibre-gl 6.x + Metro's web
        // bundler).
        maplibre.setWorkerUrl(MAP_WORKER_URL);
        // Also before map construction — see `ensureRTLTextPluginLoaded`'s
        // doc comment.
        ensureRTLTextPluginLoaded(maplibre);

        const map = new maplibre.Map({
          container: containerRef.current,
          style: styleUrl,
          bounds: regionBboxToLngLatBounds(REGION_BBOX),
          fitBoundsOptions: { padding: MAP_FIT_BOUNDS_PADDING_PX },
          attributionControl: false,
        });
        // Assigned before `.on(...)` registration below (not after) so
        // `mapRef.current` is already populated for any handler that fires
        // synchronously — a real MapLibre map never fires "load"
        // synchronously, but nothing should depend on that.
        mapRef.current = map;
        // No `customAttribution` — every active source's own attribution
        // (the vector source's TileJSON credit line, and now the terrain
        // DEM source's `TERRAIN_ATTRIBUTION`) is collected by MapLibre
        // automatically; adding a hand-typed copy on top duplicated it on
        // screen (config.ts's doc comment above `MAP_WORKER_URL` has the
        // full story). `compact: false` keeps it always expanded rather
        // than hidden behind a toggle.
        map.addControl(new maplibre.AttributionControl({ compact: false }));
        // "clicking the map background should dismiss it" (event-preview
        // sheet wave) — a map-WIDE "click" listener, registered once per map
        // INSTANCE (not re-registered on a later `setStyle`, unlike the
        // terrain/own-labels SOURCES and LAYERS a style swap wipes: this is
        // a property of the Map object's own event system, not of the style
        // document, so it keeps working across a basemap swap with no
        // re-priming needed).
        //
        // Real mechanism, confirmed by reading the installed maplibre-gl
        // source directly (not assumed): maplibre-gl appends every DOM
        // `Marker` element INSIDE `map.getCanvasContainer()` — the SAME
        // element its own `MapEventHandler` listens on for the native
        // browser "click" event that THIS handler is built from
        // (`MapEventHandler.click` does no target filtering at all: any
        // click that bubbles up through the container becomes a map "click"
        // event, marker or not). Left alone, a marker's own click would
        // bubble straight into this exact handler in the same synchronous
        // dispatch and immediately re-close the sheet it just opened,
        // whenever the sheet was already mounted (e.g. tapping a second
        // marker while one is showing) — the marker-build effect's own
        // activation handler below deliberately calls
        // `event.stopPropagation()` so a marker tap never reaches here at
        // all, which is what actually keeps the two from fighting, not
        // marker elements being on some separate, un-bubbled event path (an
        // earlier, incorrect assumption in this file). `sheetRef.current`
        // is only non-null while the sheet is actually mounted (open), so
        // this is a safe no-op the rest of the time — see
        // `EventPreviewSheetHandle`'s doc comment for why this goes through
        // the animated `requestClose()` path rather than clearing the
        // selection directly.
        map.on("click", () => {
          sheetRef.current?.requestClose();
        });
        map.on("load", () => {
          if (cancelled) {
            return;
          }
          hasLoaded = true;

          primeTerrainAndLabelCache(
            map,
            scheme,
            i18n.language,
            originalTextFieldsRef.current,
            kurdishPlacesRef.current,
          );
          applyLocaleLabels(map, i18n.language, originalTextFieldsRef.current);
          setLoadState("ready");

          // Kick off the lazy tier-3 (village) load now that the map has
          // something to show already (`KURDISH_PLACES_CORE`, primed just
          // above) — once it resolves, merge it in and refresh the
          // already-live source via `setData` rather than waiting for a
          // locale/style change to pick it up.
          loadKurdishVillagePlaces()
            .then((villages) => {
              if (cancelled) {
                return;
              }
              kurdishPlacesRef.current = [...KURDISH_PLACES_CORE, ...villages];
              refreshOwnLabelsSource(
                mapRef.current,
                i18nRef.current.language,
                kurdishPlacesRef.current,
              );
            })
            .catch(() => {
              // Villages are a progressive enhancement over the always-
              // present core dataset — a failed/offline lazy load leaves
              // the map exactly as usable as before this wave, never an
              // error state of its own.
            });
        });
        // Style/tile load failures (offline, DNS down, etc.) surface here —
        // "if tiles fail/offline show the standard offline state pattern"
        // (wave brief) — UNLESS this is a MapTiler style that failed before
        // ever loading, in which case we get one automatic, silent retry on
        // OpenFreeMap instead (`decideMapErrorAction`) so the map never
        // just goes blank over a bad/quota'd key.
        map.on("error", () => {
          if (cancelled) {
            return;
          }
          const action = decideMapErrorAction({
            provider: activeProviderRef.current,
            hasReachedReady: hasLoaded,
            alreadyFellBack: fallbackAttemptedRef.current,
          });
          if (action === "fallback-to-openfreemap") {
            fallbackAttemptedRef.current = true;
            // Same teardown as `handleRetry`/unmount below (inlined, not
            // shared, matching this file's existing belt-and-braces
            // duplication rather than introducing a new shared helper with
            // its own dependency-array bookkeeping).
            markersRef.current.forEach((marker) => marker.remove());
            markersRef.current = [];
            mapRef.current?.remove();
            mapRef.current = null;
            creationStartedRef.current = false;
            setRetryTick((tick) => tick + 1);
            return;
          }
          setLoadState("error");
        });
      })
      .catch(() => {
        if (!cancelled) {
          setLoadState("error");
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `scheme`, `i18n.language`, `styleId`, and `colors` are only read once at creation/hydration time here (the dedicated locale-reactive effect below handles later locale changes; `handleStyleChange` handles later user style picks by live-swapping the existing map, not by recreating it, and re-reads `colors` fresh itself); `retryTick` is the deliberate re-run trigger for handleRetry/the fallback path
  }, [isFocused, hasStyleHydrated, retryTick]);

  // Re-applies label localization whenever the active locale changes, using
  // the ORIGINAL text-field cache `primeTerrainAndLabelCache` populated at
  // load time — the one place a locale switch (ckb/ar ⇄ kmr/en) actually
  // takes effect on an already-showing map, mirroring how a style-provider
  // change would be handled (re-set the affected layout property) rather
  // than reloading the whole style. Also refreshes the own-labels source's
  // GeoJSON data via `refreshOwnLabelsSource` (`GeoJSONSource.setData`, NOT
  // `setLayoutProperty` — our layer's `text-field` is the static
  // `["get","label"]` expression; what changes per locale is each
  // feature's `label` PROPERTY VALUE) so gazetteer AND Kurdish-places
  // labels switch language too, not just the basemap's own name fields —
  // `kurdishPlacesRef.current` carries whichever of core-only/core+villages
  // is currently loaded, same as every other own-labels rebuild.
  useEffect(() => {
    const map = mapRef.current;
    if (loadState !== "ready" || !map) {
      return;
    }
    applyLocaleLabels(map, i18n.language, originalTextFieldsRef.current);
    refreshOwnLabelsSource(map, i18n.language, kurdishPlacesRef.current);
  }, [loadState, i18n.language]);

  // Tears down a broken map instance on unmount too — belt-and-braces
  // alongside the per-effect `cancelled` flag above.
  useEffect(() => {
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  const handleRetry = useCallback(() => {
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    mapRef.current?.remove();
    mapRef.current = null;
    maplibreModuleRef.current = null;
    creationStartedRef.current = false;
    // A user-initiated retry gets a fresh shot at MapTiler (if configured)
    // rather than staying pinned to whatever the automatic runtime fallback
    // last landed on — unlike THAT one-shot latch (a single map instance's
    // silent, automatic recovery), a manual retry is an explicit new
    // attempt and a bad key/quota blip may well have cleared by now.
    fallbackAttemptedRef.current = false;
    setLoadState("idle");
    setRetryTick((tick) => tick + 1);
  }, []);

  // Re-fits the viewport whenever the SCOPE actually changes (Kurdistan ⇄
  // World, §4.1) — guarded by `previousScopeRef` so this never re-fits on
  // every render, only on a genuine scope switch; the map's own initial
  // `bounds` constructor option already frames Kurdistan on first load, so
  // the very first "ready" transition (scope still at its initial value)
  // correctly does nothing here.
  const previousScopeRef = useRef<MapScope>(scope);
  useEffect(() => {
    const map = mapRef.current;
    if (loadState !== "ready" || !map || previousScopeRef.current === scope) {
      return;
    }
    previousScopeRef.current = scope;
    const bounds =
      scope === "world"
        ? regionBboxToLngLatBounds(WORLD_VIEW_BBOX)
        : regionBboxToLngLatBounds(REGION_BBOX);
    map.fitBounds(bounds, { padding: MAP_FIT_BOUNDS_PADDING_PX });
  }, [scope, loadState]);

  // Live basemap style swap (§4.3/Part 3) — `map.setStyle` on the EXISTING
  // map instance (never recreates it, unlike the initial-load path above),
  // so the current viewport/zoom/markers are untouched. `setStyle` DOES
  // wipe every source/layer WE added (terrain hillshade, own-labels,
  // locale-relabeled basemap layers) — MapLibre fires `"style.load"` once
  // the new style finishes loading, and `primeTerrainAndLabelCache`/
  // `applyLocaleLabels` re-run against it there, the exact same functions
  // (and exact same idempotent "inspect the ACTIVE style, decide what it
  // needs" logic) the initial `"load"` handler above already uses — no
  // separate re-application code path to keep in sync. Markers are
  // deliberately NOT rebuilt here: maplibre-gl `Marker` instances are DOM
  // overlays independent of the style/source system `setStyle` replaces
  // (verified against the installed maplibre-gl 6.x's own behavior), so
  // they simply keep rendering on top of the new tiles with zero extra
  // code — confirmed by this file's own style-swap tests
  // (`map-web-style-picker.test.tsx`).
  const handleStyleChange = useCallback(
    (nextStyleId: MapStyleCatalogId) => {
      setStyleId(nextStyleId);
      const map = mapRef.current;
      if (!map) {
        return;
      }
      const resolved = resolveCatalogMapStyle(
        nextStyleId,
        scheme,
        getConfiguredMapTilerKey(),
      );
      activeProviderRef.current = resolved.provider;
      setActiveProvider(resolved.provider);
      // A fresh, explicit user pick deserves a fresh shot at MapTiler (same
      // reasoning as `handleRetry`) rather than staying pinned to an
      // earlier session's automatic fallback.
      fallbackAttemptedRef.current = false;
      map.once("style.load", () => {
        primeTerrainAndLabelCache(
          map,
          scheme,
          i18n.language,
          originalTextFieldsRef.current,
          kurdishPlacesRef.current,
        );
        applyLocaleLabels(map, i18n.language, originalTextFieldsRef.current);
      });
      map.setStyle(resolved.url);
    },
    [scheme, i18n.language, setStyleId],
  );

  // Rebuilds the marker layer whenever the map becomes ready, the active
  // scope/filters change, or the underlying feed refetches (every 60s while
  // foregrounded, queries.ts) — cheap at this event volume (region/world
  // pools are low hundreds at most). Unaffected by a basemap style swap
  // (`handleStyleChange` above): DOM markers are independent overlays
  // untouched by `setStyle`, so none of THIS effect's own deps change on a
  // pure
  // style pick.
  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreModuleRef.current;
    if (loadState !== "ready" || !map || !maplibre) {
      return;
    }

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    const eventById = new Map<string, Event>(
      filteredEvents.map((event) => [event.id, event]),
    );

    // Every event in the filtered set is its own tappable DOM
    // `maplibregl.Marker` — clustering was removed (the owner's explicit
    // call: overlap at low zoom is an accepted trade, not a problem to
    // solve with grouping). Real DOM elements, not a GL layer, is what
    // preserves accessibility (role=button, keyboard activation, an
    // aria-label built from magnitude + place — `map-web-interaction.test.tsx`
    // covers this).
    const markers = buildRegionMarkers(filteredEvents);
    for (const marker of markers) {
      const sourceEvent = eventById.get(marker.id);
      const magnitudeLabel = t("events.magnitudeA11yLabel", {
        value: formatMagnitudeValue(marker.magnitudeValue, i18n.language),
      });
      const placeText = sourceEvent ? placeLine(sourceEvent, i18n.language, t) : "";
      const label = [magnitudeLabel, placeText].filter(Boolean).join(". ");

      // Outer element: the tappable hit area (dot diameter + padding on
      // every side, "big touch targets... extra hit radius" per the wave
      // brief) — unchanged shape/attributes from before this wave, so
      // every existing accessibility assertion against it still holds.
      const hitEl = document.createElement("div");
      hitEl.style.width = `${marker.diameterPx + MARKER_HIT_PADDING_PX * 2}px`;
      hitEl.style.height = `${marker.diameterPx + MARKER_HIT_PADDING_PX * 2}px`;
      hitEl.style.display = "flex";
      hitEl.style.alignItems = "center";
      hitEl.style.justifyContent = "center";
      hitEl.style.cursor = "pointer";
      hitEl.setAttribute("role", "button");
      hitEl.setAttribute("aria-label", label);
      hitEl.tabIndex = 0;

      // Visual quality pass (owner: "make it more stylish") — a
      // translucent-fill HALO at the full magnitude-scaled diameter, sized/
      // colored exactly as before, plus an opaque CORE at its center. When
      // several markers overlap, the halos blend softly instead of
      // stacking into a solid blob, while each core stays a crisp, fully-
      // opaque dot — still colored purely by `colors.status[tone]`
      // (`magnitudeTone`, never the EMS intensity ramp — design-language.md
      // §3.2). The single most-recent event in the current set gets a
      // distinct outline in `colors.action.felt` (this app's existing
      // "urgent" accent, already reserved for the felt-report CTA/true
      // danger states — reused here, not a new color) plus a soft matching
      // glow, so "what just happened" reads at a glance.
      const toneColor = colors.status[marker.tone];
      const haloEl = document.createElement("div");
      haloEl.style.width = `${marker.diameterPx}px`;
      haloEl.style.height = `${marker.diameterPx}px`;
      haloEl.style.borderRadius = "50%";
      haloEl.style.display = "flex";
      haloEl.style.alignItems = "center";
      haloEl.style.justifyContent = "center";
      haloEl.style.backgroundColor = hexToRgba(toneColor, 0.32);
      haloEl.style.border = marker.isMostRecent
        ? `2.5px solid ${colors.action.felt}`
        : `1.5px solid ${colors.surface.raised}`;
      haloEl.style.boxShadow = marker.isMostRecent
        ? `0 0 0 4px ${hexToRgba(colors.action.felt, 0.22)}`
        : "0 1px 3px rgba(0, 0, 0, 0.35)";

      const coreDiameterPx = Math.max(6, Math.round(marker.diameterPx * 0.55));
      const coreEl = document.createElement("div");
      coreEl.style.width = `${coreDiameterPx}px`;
      coreEl.style.height = `${coreDiameterPx}px`;
      coreEl.style.borderRadius = "50%";
      coreEl.style.backgroundColor = toneColor;
      haloEl.appendChild(coreEl);
      hitEl.appendChild(haloEl);

      // Tapping a marker RAISES THE PREVIEW SHEET (map-UX wave: "the map
      // doesn't close fully, but a slider type thing opens") instead of
      // navigating straight to `/event/[id]` — reaching the full event is
      // the SHEET's own job (its "open full event" action / dragging past
      // its largest detent), not the marker's. `sourceEvent` is always
      // resolved above from this same render pass's `eventById` map, so
      // there's nothing left to push a route for here.
      const activate = () => {
        if (!sourceEvent) {
          return;
        }
        selectEvent(sourceEvent);
        // Subtle recenter (wave brief: "consider whether to nudge the map's
        // centre so the selected marker is not hidden behind the sheet; if
        // you do, keep it subtle") — an `offset` shifts where the given
        // `center` ends up ON SCREEN rather than moving the actual map
        // center coordinate further than necessary; a small, fixed pixel
        // nudge (not computed from the sheet's exact peek height) is
        // deliberately modest, not a full re-frame of the viewport.
        map.easeTo({
          center: [marker.lon, marker.lat],
          offset: [0, -MAP_SHEET_SELECT_OFFSET_PX],
          duration: prefersReducedMotion ? 0 : 300,
        });
      };

      // Selection is driven from POINTER events (`pointerdown`/`pointerup`),
      // NOT the browser's native `click` — the actual, source-verified
      // mechanism behind repeated "tap does nothing" reports on real
      // phones: maplibre-gl appends every DOM `Marker` element INSIDE
      // `map.getCanvasContainer()`, the very element its own single-finger
      // pan handler (`TouchPanHandler.touchmove`, read directly out of the
      // installed maplibre-gl 6.4.0 source) listens on for `touchmove` —
      // that handler calls `e.preventDefault()` on the FIRST `touchmove` of
      // any active touch sequence, with no minimum-distance gate before
      // doing so. Canceling a `touchmove` mid-sequence is standard browser
      // behavior that suppresses every synthesized mouse-compatibility
      // event for the rest of that same touch, including the `click` a
      // marker's own listener used to depend on — and a real finger
      // practically always produces at least one `touchmove` between
      // `touchstart`/`touchend` (sub-pixel jitter is enough), so a genuine
      // phone tap on a marker reliably never reached a `click` listener at
      // all, even though a JS-dispatched synthetic pointerdown/pointerup/
      // click sequence (which never enters MapLibre's touch pipeline) did —
      // exactly the gap between "works when I fire it from devtools" and
      // "does nothing on my phone" the bug reports described.
      // `pointerdown`/`pointerup` are raw-input events, independent of that
      // touch-to-mouse compatibility pipeline, so they're immune to it.
      //
      // A small movement tolerance (`MARKER_TAP_TOLERANCE_PX`) still tells
      // a genuine tap apart from the start of a map-pan gesture that
      // happened to begin on top of a marker. `stopPropagation()` on the
      // matched `pointerup` (and on any residual native `click` — see
      // below) keeps this from ALSO being seen by the map's own
      // container-level "click" listener (the map-creation effect above):
      // `MapEventHandler.click` does no target filtering at all, so an
      // un-stopped click bubbling up from a marker would immediately
      // re-close the sheet it just opened whenever the sheet was already
      // mounted — e.g. tapping a second marker while one is showing.
      let pointerDownAt: { x: number; y: number } | null = null;
      hitEl.addEventListener("pointerdown", (domEvent) => {
        pointerDownAt = { x: domEvent.clientX, y: domEvent.clientY };
      });
      hitEl.addEventListener("pointerup", (domEvent) => {
        const start = pointerDownAt;
        pointerDownAt = null;
        if (!start) {
          return;
        }
        const dx = domEvent.clientX - start.x;
        const dy = domEvent.clientY - start.y;
        if (Math.sqrt(dx * dx + dy * dy) > MARKER_TAP_TOLERANCE_PX) {
          return;
        }
        domEvent.stopPropagation();
        activate();
      });
      // A residual native "click" can still follow `pointerup` on
      // non-touch (mouse) input, or a touch tap that happened to produce
      // zero `touchmove` events — `activate()` already ran from the
      // matched `pointerup` above; this listener exists ONLY to stop that
      // click from bubbling into the map's background-dismiss listener,
      // never to select again.
      hitEl.addEventListener("click", (domEvent) => {
        domEvent.stopPropagation();
      });
      hitEl.addEventListener("keydown", (domEvent) => {
        if (domEvent.key === "Enter" || domEvent.key === " ") {
          domEvent.preventDefault();
          activate();
        }
      });

      const markerInstance = new maplibre.Marker({ element: hitEl })
        .setLngLat([marker.lon, marker.lat])
        .addTo(map);
      markersRef.current.push(markerInstance);
    }
  }, [
    loadState,
    filteredEvents,
    colors,
    t,
    i18n.language,
    selectEvent,
    prefersReducedMotion,
  ]);

  const showOverlayLoading = loadState === "idle" || loadState === "loading";

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface.base,
          paddingTop: insets.top,
        },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[
          styles.title,
          {
            color: colors.text.primary,
            fontSize: typography.h2.fontSize,
            lineHeight: typography.h2.lineHeight,
            fontWeight: typography.h2.fontWeight,
            paddingHorizontal: spacing[4],
            paddingBottom: spacing[2],
          },
        ]}
      >
        {t("map.title")}
      </Text>

      <View style={styles.mapArea}>
        {/* Web-only file (Metro platform resolution keeps this out of native
            bundles entirely) — MapLibre needs a real DOM node to attach its
            canvas to, so this is a plain DOM element rather than an RN View. */}
        <div ref={containerRef} style={mapContainerStyle} />

        {loadState === "ready" && openControl ? (
          // "tapping elsewhere ... closes the open one" — a full-mapArea,
          // invisible dismiss layer. Rendered BEFORE `controlsRow` below (so
          // it stacks under it: the still-visible icon buttons stay
          // clickable on top) and gated on `openControl` so it's only ever
          // present while a popover is actually open — keyboard users get
          // the same dismissal via the Escape-key effect above, so this
          // layer is hidden from the accessibility tree entirely rather
          // than becoming an unlabeled full-screen "button".
          <Pressable
            testID="map-controls-backdrop"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.controlsBackdrop}
            onPress={closeOpenControl}
          />
        ) : null}

        {loadState === "ready" ? (
          <View
            style={[styles.controlsRow, { padding: spacing[3] }]}
            pointerEvents="box-none"
          >
            <ScopeToggle value={scope} onChange={handleScopeChange} />
            <View
              style={[
                styles.controlsColumn,
                { gap: spacing[2] },
                isCompactControls && styles.controlsColumnCompact,
              ]}
            >
              <MapFilterPanel
                magnitudeBounds={magnitudeBounds}
                magnitudeRange={effectiveMagnitudeRange}
                onMagnitudeRangeChange={setMagnitudeRange}
                dateBounds={dateBounds}
                dateRange={effectiveDateRange}
                onDateRangeChange={setDateRange}
                onReset={handleResetFilters}
                expanded={openControl === "filters"}
                onToggleExpanded={() => toggleControl("filters")}
                compact={isCompactControls}
              />
              <MapStylePicker
                value={styleId}
                onChange={handleStyleChange}
                expanded={openControl === "style"}
                onToggleExpanded={() => toggleControl("style")}
                compact={isCompactControls}
              />
            </View>
          </View>
        ) : null}

        {loadState === "ready" && activeProvider === "maptiler" ? (
          <View style={styles.attributionLogo} pointerEvents="box-none">
            <MapTilerAttributionLogo />
          </View>
        ) : null}

        {loadState === "error" ? (
          <View
            style={[
              styles.overlay,
              styles.centered,
              { backgroundColor: colors.surface.base, padding: spacing[6] },
            ]}
          >
            <View
              style={[
                styles.offlineBox,
                {
                  backgroundColor: colors.surface.sunken,
                  borderColor: colors.border.default,
                  padding: spacing[4],
                  gap: spacing[2],
                },
              ]}
            >
              <View style={[styles.offlineRow, { gap: spacing[2] }]}>
                <Ionicons
                  name="cloud-offline-outline"
                  size={16}
                  color={colors.text.secondary}
                />
                <Text
                  style={{
                    color: colors.text.primary,
                    fontSize: typography.bodyDefault.fontSize,
                    lineHeight: typography.bodyDefault.lineHeight,
                    fontWeight: "600",
                  }}
                >
                  {t("map.offlineTitle")}
                </Text>
              </View>
              <Text
                style={{
                  color: colors.text.secondary,
                  fontSize: typography.bodyMeta.fontSize,
                  lineHeight: typography.bodyMeta.lineHeight,
                }}
              >
                {t("map.offlineDescription")}
              </Text>
              <Pressable accessibilityRole="button" onPress={handleRetry} hitSlop={12}>
                <Text
                  style={{
                    color: colors.text.link,
                    fontSize: typography.bodyMeta.fontSize,
                    fontWeight: "600",
                  }}
                >
                  {t("map.retry")}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {showOverlayLoading ? (
          <View
            style={[
              styles.overlay,
              styles.centered,
              { backgroundColor: colors.surface.base },
            ]}
            pointerEvents="none"
          >
            <ActivityIndicator color={colors.brand.primary} />
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.bodyMeta.fontSize,
                lineHeight: typography.bodyMeta.lineHeight,
                marginTop: spacing[2],
              }}
            >
              {t("map.loading")}
            </Text>
          </View>
        ) : null}

        {/* Draggable event-preview sheet (map-UX wave) — rendered LAST so it
         * stacks above every other overlay in this file's established
         * "later JSX = on top" paint-order convention (see
         * `controlsBackdrop`'s own doc comment). Mounted ONLY while an event
         * is selected: `EventPreviewSheet` itself owns its whole open/close
         * animation lifecycle, so mounting = "start the entrance animation"
         * and unmounting = "the close animation already finished" (its
         * `onDismiss` prop, wired to `eventSheet.dismiss`, is what clears
         * the selection and lets this conditional actually unmount it) —
         * never torn down/recreated for any OTHER reason (a filter change,
         * a style swap, a data refetch), so the map underneath keeps
         * rendering completely undisturbed the whole time the sheet is
         * open. */}
        {loadState === "ready" && eventSheet.content ? (
          <EventPreviewSheet
            ref={sheetRef}
            content={eventSheet.content}
            detent={eventSheet.detent}
            onDetentChange={eventSheet.setDetent}
            onDismiss={eventSheet.dismiss}
          />
        ) : null}
      </View>
    </View>
  );
}

// A plain object (not `StyleSheet.create`, which react-native-web can't
// resolve for a raw DOM element) — the map container needs to fill its
// parent for MapLibre's canvas to size correctly.
const mapContainerStyle: Record<string, string> = {
  width: "100%",
  height: "100%",
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  title: {
    // No explicit textAlign — the default already follows the active
    // writing direction (RTL locales right-align without forcing a
    // physical side, per typescript-react-native.md's logical-properties
    // rule).
  },
  mapArea: {
    flex: 1,
    position: "relative",
  },
  overlay: {
    position: "absolute",
    top: 0,
    start: 0,
    end: 0,
    bottom: 0,
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
  },
  offlineBox: {
    borderWidth: 1,
    borderRadius: 12,
    maxWidth: 320,
  },
  offlineRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  controlsRow: {
    position: "absolute",
    top: 0,
    start: 0,
    end: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  controlsColumn: {
    alignItems: "flex-end",
  },
  // Compact width (`isCompactControls`): the filter/style controls collapse
  // to a pair of small icon buttons — laying them out in a ROW (instead of
  // the wide layout's stacked column of full-width bars) reads as a single
  // compact toolbar and keeps the whole controls row shorter, leaving more
  // of the map visible. Popovers opened from either icon are absolutely
  // positioned (`MapFilterPanel`/`MapStylePicker`'s own `popover` style),
  // so they float free of this row's flex layout regardless of direction.
  controlsColumnCompact: {
    flexDirection: "row",
    alignItems: "center",
  },
  attributionLogo: {
    position: "absolute",
    bottom: 0,
    end: 0,
  },
  controlsBackdrop: {
    position: "absolute",
    top: 0,
    start: 0,
    end: 0,
    bottom: 0,
    // No explicit `zIndex` — this file otherwise never uses one, relying on
    // plain JSX/DOM paint order for absolutely-positioned siblings (later =
    // on top). Rendered BEFORE `controlsRow` below, so the still-visible
    // icon buttons naturally paint above this dismiss layer without needing
    // to coordinate a numeric stacking value against it.
  },
});
