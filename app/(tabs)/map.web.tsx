import "maplibre-gl/dist/maplibre-gl.css";

import { useFocusEffect, useRouter } from "expo-router";
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
  filterEventsByMagnitudeAndDate,
  findHillshadeBeforeLayerId,
  findNameLabelLayerIds,
  getConfiguredMapTilerKey,
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
  useMapPreferencesStore,
  WORLD_VIEW_BBOX,
  type DateRangeMs,
  type MagnitudeRange,
  type MapScope,
  type MapStyleCatalogId,
  type MapStyleProviderId,
} from "@/features/map";
import { useTheme } from "@/theme";

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
 * Content this wave: circle-ish markers for the already-loaded region feed
 * (`useRegionEvents` — no new fetching), sized/colored by magnitude, tap →
 * event detail. No ShakeMap overlay, felt cells, or fault lines yet
 * (follow-up waves).
 */
export default function MapScreenWeb() {
  const { t, i18n } = useTranslation();
  const { colors, scheme, spacing, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { events: regionEvents, dataUpdatedAt: regionDataUpdatedAt } = useRegionEvents();
  const { events: worldEvents, dataUpdatedAt: worldDataUpdatedAt } = useWorldEvents();

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
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [styleExpanded, setStyleExpanded] = useState(false);

  const handleScopeChange = useCallback((nextScope: MapScope) => {
    setScope(nextScope);
    setMagnitudeRange(null);
    setDateRange(null);
  }, []);

  const handleResetFilters = useCallback(() => {
    setMagnitudeRange(null);
    setDateRange(null);
  }, []);

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

  // Kept as a ref (synced via effect, never written during render — the
  // React Compiler's react-hooks/refs rule forbids ref writes in render) so
  // each marker's click handler, created once when the marker is built,
  // always calls through to the LATEST router even though the closure
  // itself is never recreated on a router identity change.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `scheme`, `i18n.language`, and `styleId` are only read once at creation/hydration time here (the dedicated locale-reactive effect below handles later locale changes; `handleStyleChange` handles later user style picks by live-swapping the existing map, not by recreating it); `retryTick` is the deliberate re-run trigger for handleRetry/the fallback path
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
  // (`handleStyleChange` above): markers are independent DOM overlays, and
  // neither `loadState` nor `filteredEvents` changes when only the style
  // does, so this effect correctly does NOT re-run on a style pick.
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

    for (const marker of buildRegionMarkers(filteredEvents)) {
      const sourceEvent = eventById.get(marker.id);
      const magnitudeLabel = t("events.magnitudeA11yLabel", {
        value: formatMagnitudeValue(marker.magnitudeValue, i18n.language),
      });
      const placeText = sourceEvent ? placeLine(sourceEvent, i18n.language, t) : "";
      const label = [magnitudeLabel, placeText].filter(Boolean).join(". ");

      // Two nested elements: the outer one is the tappable hit area (dot
      // diameter + padding on every side, "big touch targets... extra hit
      // radius" per the wave brief), the inner one is the visible dot —
      // keeps the enlarged hit area invisible rather than a giant colored
      // circle.
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

      const dotEl = document.createElement("div");
      dotEl.style.width = `${marker.diameterPx}px`;
      dotEl.style.height = `${marker.diameterPx}px`;
      dotEl.style.borderRadius = "50%";
      dotEl.style.backgroundColor = colors.status[marker.tone];
      dotEl.style.border = `2px solid ${colors.surface.raised}`;
      dotEl.style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.35)";
      hitEl.appendChild(dotEl);

      const activate = () => routerRef.current.push(`/event/${marker.id}`);
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
  }, [loadState, filteredEvents, colors, t, i18n.language]);

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

        {loadState === "ready" ? (
          <View
            style={[styles.controlsRow, { padding: spacing[3] }]}
            pointerEvents="box-none"
          >
            <ScopeToggle value={scope} onChange={handleScopeChange} />
            <View style={[styles.controlsColumn, { gap: spacing[2] }]}>
              <MapFilterPanel
                magnitudeBounds={magnitudeBounds}
                magnitudeRange={effectiveMagnitudeRange}
                onMagnitudeRangeChange={setMagnitudeRange}
                dateBounds={dateBounds}
                dateRange={effectiveDateRange}
                onDateRangeChange={setDateRange}
                onReset={handleResetFilters}
                expanded={filtersExpanded}
                onToggleExpanded={() => setFiltersExpanded((current) => !current)}
              />
              <MapStylePicker
                value={styleId}
                onChange={handleStyleChange}
                expanded={styleExpanded}
                onToggleExpanded={() => setStyleExpanded((current) => !current)}
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
  attributionLogo: {
    position: "absolute",
    bottom: 0,
    end: 0,
  },
});
