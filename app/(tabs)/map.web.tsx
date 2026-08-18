import "maplibre-gl/dist/maplibre-gl.css";

import { useFocusEffect } from "expo-router";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  Marker as MapLibreMarker,
  MapLayerMouseEvent,
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
  buildClusterCircleLayer,
  buildClusterCountLayer,
  buildClusterFeatureCollection,
  buildClusterSource,
  buildMergedOwnLabelFeatureCollection,
  buildOwnLabelsLayer,
  buildOwnLabelsSource,
  buildTerrainDemSource,
  buildTerrainHillshadeLayer,
  CLUSTER_CIRCLE_LAYER_ID,
  CLUSTER_LIST_MAX_SIZE,
  CLUSTER_MAX_ZOOM,
  CLUSTER_SOURCE_ID,
  clusterRegionMarkers,
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
  MAP_INITIAL_MIN_ZOOM_COMPACT,
  MAP_RTL_TEXT_PLUGIN_URL,
  MAP_WORKER_URL,
  MapFilterPanel,
  MARKER_HIT_PADDING_PX,
  MapStylePicker,
  MapTilerAttributionLogo,
  OWN_LABELS_DEFAULT_FONT,
  OWN_LABELS_SOURCE_ID,
  readClusterMetaFromProperties,
  regionBboxToLngLatBounds,
  resolveCatalogMapStyle,
  resolveClusterExpansionZoom,
  ScopeToggle,
  shouldLocalizeToArabicScript,
  shouldRequestRTLTextPlugin,
  sortClusterMembersForList,
  styleHasRasterDemSource,
  TERRAIN_DEM_SOURCE_ID,
  useEventSheetController,
  useMapPreferencesStore,
  useReducedMotionPreference,
  WORLD_VIEW_BBOX,
  type ClusterMarkerFeature,
  type DateRangeMs,
  type EventPreviewSheetHandle,
  type MagnitudeRange,
  type MapScope,
  type MapStyleCatalogId,
  type MapStyleProviderId,
  type PointMarkerFeature,
} from "@/features/map";
import { useTheme } from "@/theme";

/** Fixed, deliberately modest pixel nudge applied to the map's viewport
 * center when a marker is selected (`easeTo`'s `offset`, in the marker
 * click handler below) so the newly-opened preview sheet doesn't sit
 * directly on top of it — see that call site's own doc comment for why this
 * is a small fixed constant rather than something computed from the sheet's
 * exact peek height. */
const MAP_SHEET_SELECT_OFFSET_PX = 90;

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
 *
 * Returns the font stack it resolved for the own-labels layer (or `null`
 * if the style wasn't available at all) — `primeClusterLayer`'s count-label
 * symbol layer reuses this SAME resolved stack rather than re-deriving it,
 * one glyph-availability lookup per (re)prime, not two.
 */
function primeTerrainAndLabelCache(
  map: MapLibreMap,
  scheme: "light" | "dark",
  locale: string,
  originalTextFields: Map<string, unknown>,
  kurdishPlaces: readonly KurdishPlace[],
): readonly string[] | null {
  const style = map.getStyle();
  if (!style) {
    return null;
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
  return ownLabelsFont;
}

/**
 * Re-primes the cluster GeoJSON source + circle/count layers (Problem 2's
 * GL half — `cluster-layer.ts`) on a freshly-loaded map, same lifecycle as
 * `primeTerrainAndLabelCache` right above (called once from the initial
 * "load" handler, and again from `handleStyleChange`'s post-swap
 * `"style.load"` — a `setStyle` wipes both). Starts EMPTY
 * (`buildClusterSource()`'s own default) — the marker-build effect further
 * down pushes real cluster data through `GeoJSONSource.setData` the moment
 * `loadState` flips to `"ready"`, the same "prime empty, fill via setData"
 * split `own-labels.ts` already uses for its own source.
 *
 * `textFont` is the SAME font stack `resolveOwnLabelsFont` already resolved
 * for the own-labels layer (read once by the caller, threaded to both) —
 * one glyph-availability lookup per (re)prime, not two.
 */
function primeClusterLayer(
  map: MapLibreMap,
  fillColor: string,
  strokeColor: string,
  textColor: string,
  textFont: readonly string[],
): void {
  map.addSource(CLUSTER_SOURCE_ID, buildClusterSource());
  map.addLayer(buildClusterCircleLayer(fillColor, strokeColor));
  map.addLayer(buildClusterCountLayer(textColor, textFont));
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
 * event detail; dense clusters collapse into GL badges below a zoom
 * threshold (`clustering.ts`/`cluster-layer.ts`, Problem 2 of the map-UX-
 * polish wave). No ShakeMap overlay, felt cells, or fault lines yet
 * (follow-up waves).
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
  // object. `selectList` is read the same way, directly inside the
  // cluster-click handler registered once by the map-CREATION effect
  // (never in that effect's own dependency array, same precedent as
  // `prefersReducedMotion` a few lines below in that same handler) — safe
  // because `useEventSheetController`'s `useCallback`s never change
  // identity across the component's lifetime, so the closure never goes
  // stale.
  const selectEvent = eventSheet.select;
  const selectList = eventSheet.selectList;
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
  // The LAST cluster feature set the marker-build effect (below) computed —
  // replayed into a freshly re-primed cluster source right after a basemap
  // style swap (`handleStyleChange`), since `setStyle` wipes that source
  // but neither `filteredEvents` nor `zoom` change on a pure style pick, so
  // the marker-build effect itself wouldn't otherwise re-run to refill it.
  const lastClusterFeaturesRef = useRef<ClusterMarkerFeature[]>([]);
  // Cluster id -> its member `Event`s, resolved against `filteredEvents` —
  // rebuilt alongside `lastClusterFeaturesRef` every marker-build effect
  // run (below), and read by the cluster-click handler (registered once by
  // the map-creation effect) to hand LIST-mode content real event data
  // without threading whole `Event` objects through the GL layer's
  // GeoJSON properties (`cluster-layer.ts` keeps those flat/numeric).
  const clusterMembersRef = useRef<Map<string, Event[]>>(new Map());
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
  // The live map's current zoom — drives clustering (Problem 2:
  // `clusterRegionMarkers(filteredEvents, zoom)` in the marker-build effect
  // below). Seeded to an arbitrary placeholder; irrelevant before the map
  // is ready, since the "load" handler sets the REAL fitted zoom
  // synchronously in the same handler that flips `loadState` to `"ready"`
  // (same render, no stale-zoom flash) — see that handler below, and
  // `"zoomend"` keeps it current for every later zoom the user makes.
  const [zoom, setZoom] = useState(0);

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
        // Camera/interaction listeners — registered once per map INSTANCE
        // (not re-registered on a later `setStyle`, unlike the terrain/
        // own-labels/cluster SOURCES and LAYERS a style swap wipes): both
        // are properties of the Map object's own event system, not of the
        // style document, so they keep working across a basemap swap with
        // no re-priming needed.
        //
        // "zoomend" (not the continuous "zoom") keeps `zoom` state — and
        // therefore clustering — in sync with the user's final zoom level
        // without rebuilding every marker on every intermediate frame of a
        // pinch/scroll gesture (battery/perf-conscious, CLAUDE.md).
        map.on("zoomend", () => {
          setZoom(map.getZoom());
        });
        // Cluster-badge tap -> ALWAYS reveal something, never just move the
        // camera (the reported bug: a badge tap that only eased the
        // viewport was indistinguishable from a tap that did nothing at
        // all, since neither one visibly "showed the user an earthquake").
        // Two branches, split on member count against `CLUSTER_LIST_MAX_SIZE`
        // (clustering.ts's own doc comment justifies the threshold):
        //
        //  - Small enough to list usefully: open the SAME preview sheet a
        //    marker tap opens, in LIST content (`selectList`) — the member
        //    events themselves are the "something revealed", not a camera
        //    move. `clusterMembersRef` (populated by the marker-build
        //    effect below on every clustering pass) resolves the clicked
        //    badge's id back to real `Event`s; a still-subtle camera nudge
        //    (same fixed offset the marker-select handler uses) keeps the
        //    tapped badge's rough location visible above the sheet.
        //  - Too large to list (Problem 2 was ALSO "a single tap can't
        //    plausibly resolve 100+ events into markers"): keep the
        //    original zoom-to-bounds behavior, still with the
        //    always-clears-the-cutoff guarantee a previous wave added
        //    (`resolveClusterExpansionZoom`) — a plain `fitBounds` has no
        //    floor on the resulting zoom, only a `maxZoom` ceiling, so a
        //    cluster whose members are spread wide could fit-and-land at or
        //    below `CLUSTER_MAX_ZOOM` and immediately re-cluster into the
        //    exact same badge. `cameraForBounds` computes the natural fit
        //    CAMERA-ONLY (no movement) so `resolveClusterExpansionZoom` can
        //    force the zoom past the cutoff first, and `easeTo` is what
        //    actually moves the map, honoring `prefersReducedMotion` same
        //    as every other camera move on this screen.
        //
        // Layer-scoped `.on(event, layerId, handler)` only fires for
        // features actually hit on `CLUSTER_CIRCLE_LAYER_ID` — MapLibre's
        // own hit-testing, no manual geometry math needed here.
        map.on("click", CLUSTER_CIRCLE_LAYER_ID, (event: MapLayerMouseEvent) => {
          const meta = readClusterMetaFromProperties(event.features?.[0]?.properties);
          if (!meta) {
            return;
          }

          if (meta.count <= CLUSTER_LIST_MAX_SIZE) {
            const members = clusterMembersRef.current.get(meta.id);
            if (!members || members.length === 0) {
              return;
            }
            selectList(sortClusterMembersForList(members));
            // Bounds midpoint, not the exact (possibly off-screen-after-pad)
            // GeoJSON centroid — good enough for "keep the tapped badge's
            // rough area visible above the sheet," the same subtle-nudge
            // intent `MAP_SHEET_SELECT_OFFSET_PX` already serves for a
            // single marker's `easeTo` below.
            map.easeTo({
              center: [
                (meta.bounds.minLon + meta.bounds.maxLon) / 2,
                (meta.bounds.minLat + meta.bounds.maxLat) / 2,
              ],
              offset: [0, -MAP_SHEET_SELECT_OFFSET_PX],
              duration: prefersReducedMotion ? 0 : 300,
            });
            return;
          }

          const natural = map.cameraForBounds(regionBboxToLngLatBounds(meta.bounds), {
            padding: MAP_FIT_BOUNDS_PADDING_PX,
          });
          if (!natural || natural.center === undefined || natural.zoom === undefined) {
            return;
          }
          map.easeTo({
            center: natural.center,
            zoom: resolveClusterExpansionZoom(natural.zoom, CLUSTER_MAX_ZOOM),
            duration: prefersReducedMotion ? 0 : 300,
          });
        });
        // "clicking the map background should dismiss it" (event-preview
        // sheet wave) — a map-WIDE (not layer-scoped) "click" listener, so
        // it only ever fires for a click that actually hit the WebGL canvas
        // itself. A marker tap never reaches here at all: maplibre-gl's DOM
        // `Marker` elements are separate overlay nodes stacked on top of the
        // canvas, so clicking one is a plain DOM event on that element, not
        // a canvas hit MapLibre would report through this handler — so this
        // never fights with (or immediately undoes) a marker selecting a
        // NEW event. A cluster-badge click, above, ALSO reaches here (the
        // two listener kinds both fire for the same click) — dismissing
        // whatever sheet was open at the same time a cluster zoom happens is
        // the right call too: a cluster isn't the sheet's own selected
        // marker. `sheetRef.current` is only non-null while the sheet is
        // actually mounted (open), so this is a safe no-op the rest of the
        // time — see `EventPreviewSheetHandle`'s doc comment for why this
        // goes through the animated `requestClose()` path rather than
        // clearing the selection directly.
        map.on("click", () => {
          sheetRef.current?.requestClose();
        });
        map.on("load", () => {
          if (cancelled) {
            return;
          }
          hasLoaded = true;

          // Phone-width "wall of badges" fix — see
          // `MAP_INITIAL_MIN_ZOOM_COMPACT`'s own doc comment (config.ts) for
          // the full diagnosis. Runs before every other "load" setup below
          // (which doesn't depend on zoom) so the marker-build effect's
          // FIRST clustering pass already sees the corrected zoom — no
          // flash of the over-clustered default before this corrects it.
          if (
            isCompactMapControlsWidth(window.innerWidth) &&
            map.getZoom() < MAP_INITIAL_MIN_ZOOM_COMPACT
          ) {
            map.jumpTo({ zoom: MAP_INITIAL_MIN_ZOOM_COMPACT });
          }

          const ownLabelsFont = primeTerrainAndLabelCache(
            map,
            scheme,
            i18n.language,
            originalTextFieldsRef.current,
            kurdishPlacesRef.current,
          );
          primeClusterLayer(
            map,
            colors.text.primary,
            colors.surface.raised,
            colors.text.inverse,
            ownLabelsFont ?? OWN_LABELS_DEFAULT_FONT,
          );
          applyLocaleLabels(map, i18n.language, originalTextFieldsRef.current);
          setZoom(map.getZoom());
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
        const ownLabelsFont = primeTerrainAndLabelCache(
          map,
          scheme,
          i18n.language,
          originalTextFieldsRef.current,
          kurdishPlacesRef.current,
        );
        // A style swap wipes the cluster source/layers too (same `setStyle`
        // reset `primeTerrainAndLabelCache`'s own doc comment describes) —
        // re-prime them here so cluster badges don't silently vanish after
        // picking a different basemap. The marker-build effect below
        // refills this fresh source with real data on its next run (its own
        // deps include `loadState`, which this style swap doesn't change —
        // it re-runs because `clusterRegionMarkers`'s LAST computed data
        // still lives in `lastClusterFeaturesRef`, replayed below).
        primeClusterLayer(
          map,
          colors.text.primary,
          colors.surface.raised,
          colors.text.inverse,
          ownLabelsFont ?? OWN_LABELS_DEFAULT_FONT,
        );
        const clusterSource = map.getSource(CLUSTER_SOURCE_ID) as GeoJSONSource | undefined;
        clusterSource?.setData(
          buildClusterFeatureCollection(lastClusterFeaturesRef.current, i18n.language),
        );
        applyLocaleLabels(map, i18n.language, originalTextFieldsRef.current);
      });
      map.setStyle(resolved.url);
    },
    [scheme, i18n.language, setStyleId, colors],
  );

  // Rebuilds the marker layer (Problem 2: clustering) whenever the map
  // becomes ready, the active scope/filters change, the underlying feed
  // refetches (every 60s while foregrounded, queries.ts), or the map's own
  // zoom settles (`"zoomend"` above) — cheap at this event volume (region/
  // world pools are low hundreds at most, `clustering.ts`'s own doc
  // comment). Unaffected by a basemap style swap (`handleStyleChange`
  // above): DOM markers are independent overlays untouched by `setStyle`,
  // and the cluster GL source is re-primed/refilled directly in that
  // handler (from `lastClusterFeaturesRef`) rather than by this effect
  // re-running, since none of THIS effect's own deps change on a pure
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

    const clusteredMarkers = clusterRegionMarkers(filteredEvents, zoom);
    const clusterFeatures = clusteredMarkers.filter(
      (feature): feature is ClusterMarkerFeature => feature.kind === "cluster",
    );
    const pointFeatures = clusteredMarkers.filter(
      (feature): feature is PointMarkerFeature => feature.kind === "point",
    );

    // Clustered groups render via the GL circle/count layers primed by
    // `primeClusterLayer` — far cheaper than DOM markers at real overlap
    // density, and remembered in `lastClusterFeaturesRef` so a later
    // basemap style swap (`handleStyleChange`) can replay this exact data
    // into its freshly re-primed source without waiting for this effect to
    // re-run (nothing it depends on changes on a pure style pick).
    lastClusterFeaturesRef.current = clusterFeatures;
    const clusterSource = map.getSource(CLUSTER_SOURCE_ID) as GeoJSONSource | undefined;
    clusterSource?.setData(buildClusterFeatureCollection(clusterFeatures, i18n.language));

    // Cluster id -> member `Event`s (`clusterMembersRef`'s own doc comment)
    // — rebuilt every pass alongside the GL data above, so the cluster-click
    // handler (registered once, `clusterMembersRef.current` read live) always
    // resolves a tapped badge's members against whatever THIS render's
    // `filteredEvents` actually were, not a stale snapshot from an earlier
    // poll/filter state.
    const membersById = new Map<string, Event[]>();
    for (const feature of clusterFeatures) {
      membersById.set(
        feature.id,
        feature.memberIds
          .map((memberId) => eventById.get(memberId))
          .filter((memberEvent): memberEvent is Event => memberEvent !== undefined),
      );
    }
    clusterMembersRef.current = membersById;

    // Standalone (unclustered) events keep real DOM `maplibregl.Marker`s —
    // the accessibility this whole split exists to preserve (role=button,
    // keyboard activation, an aria-label built from magnitude + place,
    // exactly as before this wave; `map-web-interaction.test.tsx` still
    // covers this unchanged).
    for (const marker of pointFeatures) {
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

      // Tapping a marker now RAISES THE PREVIEW SHEET (map-UX wave: "the map
      // doesn't close fully, but a slider type thing opens") instead of
      // navigating straight to `/event/[id]` — reaching the full event is
      // now the SHEET's own job (its "open full event" action / dragging
      // past its largest detent), not the marker's. `sourceEvent` is always
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
      hitEl.addEventListener("click", activate);
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
    zoom,
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

        {/* Draggable event-preview sheet (map-UX wave, extended by the
         * cluster-tap-reveals-events fix to a second LIST content kind) —
         * rendered LAST so it stacks above every other overlay in this
         * file's established "later JSX = on top" paint-order convention
         * (see `controlsBackdrop`'s own doc comment). Mounted ONLY while
         * something is selected: `EventPreviewSheet` itself owns its whole
         * open/close animation lifecycle, so mounting = "start the entrance
         * animation" and unmounting = "the close animation already
         * finished" (its `onDismiss` prop, wired to `eventSheet.dismiss`,
         * is what clears the selection and lets this conditional actually
         * unmount it) — never torn down/recreated for any OTHER reason (a
         * filter change, a style swap, a data refetch), so the map
         * underneath keeps rendering completely undisturbed the whole time
         * the sheet is open. `onSelectEvent={selectEvent}` is how tapping a
         * row inside an open cluster LIST swaps the sheet over to that
         * single event's normal preview. */}
        {loadState === "ready" && eventSheet.content ? (
          <EventPreviewSheet
            ref={sheetRef}
            content={eventSheet.content}
            detent={eventSheet.detent}
            onDetentChange={eventSheet.setDetent}
            onSelectEvent={selectEvent}
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
