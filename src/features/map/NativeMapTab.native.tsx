import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeSyntheticEvent,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyStateScreen } from "@/components/EmptyStateScreen";
import { APP_ORIGIN } from "@/config/urls";
import {
  formatMagnitudeValue,
  REGION_BBOX,
  useRegionEvents,
  useWorldEvents,
  type Event,
} from "@/features/events";
import { parseKurdishPlaces, placeLine, type KurdishPlace } from "@/features/geo";
import { useUserDistanceAnchor } from "@/features/location/use-user-distance-anchor";
// Deep imports only: the `@/features/map` index also exports the web's
// maplibre-gl loader, which must never reach the native bundle.
import {
  EventPreviewSheet,
  type EventPreviewSheetHandle,
} from "@/features/map/components/EventPreviewSheet";
import { MapOverlayInfoCard } from "@/features/map/components/MapOverlayInfoCard";
import { MapOverlayLegend } from "@/features/map/components/MapOverlayLegend";
import { MapStylePicker } from "@/features/map/components/MapStylePicker";
import { NativeMapCredits } from "@/features/map/components/NativeMapCredits";
import { NativeMapFilterPanel } from "@/features/map/components/NativeMapFilterPanel";
import { ScopeToggle } from "@/features/map/components/ScopeToggle";
import { MAP_FIT_BOUNDS_PADDING_PX } from "@/features/map/config";
import { useEventSheetController } from "@/features/map/event-sheet";
import {
  computeDateBoundsMs,
  computeMagnitudeBounds,
  filterEventsByMagnitudeAndDate,
  type DateRangeMs,
  type MagnitudeRange,
} from "@/features/map/filters";
import { homeBboxAround } from "@/features/map/home-view";
import {
  activeOverlayIds,
  AFEAD_HIT_LAYER_ID,
  AFEAD_SOURCE_ID,
  FAULTS_HIT_LAYER_ID,
  FAULTS_SOURCE_ID,
  HISTORICAL_LAYER_ID,
  HISTORICAL_SOURCE_ID,
  type MapLayerId,
} from "@/features/map/layer-registry";
import { buildRegionMarkers, type RegionBbox } from "@/features/map/marker-helpers";
import { loadNativeMapLibre, type MapLibreModule } from "@/features/map/native-maplibre";
import {
  buildEventMarkerFeatureCollection,
  buildEventMarkerLayers,
  buildNativeOverlays,
  EVENT_MARKER_HITBOX_HALF_PT,
  EVENT_MARKERS_SOURCE_ID,
  NATIVE_OVERLAY_ANCHOR_IDS,
  pickPressedEventId,
  toNativeLayerProps,
  toNativeOwnLabels,
  type NativeLayerProps,
  type NativeSourceProps,
} from "@/features/map/native-layers";
import { describeOverlayFeature, type OverlayInfo } from "@/features/map/overlay-info";
import {
  buildMergedOwnLabelFeatureCollection,
  buildOwnLabelsLayer,
  KURDISH_PLACES_CORE,
  OWN_LABELS_SOURCE_ID,
} from "@/features/map/own-labels";
import { useMapPreferencesStore } from "@/features/map/preferences-store";
import { useReducedMotionPreference } from "@/features/map/reduced-motion";
import { isCompactMapControlsWidth } from "@/features/map/responsive";
import { DEFAULT_MAP_SCOPE, WORLD_VIEW_BBOX, type MapScope } from "@/features/map/scope";
import type { MapStyleCatalogId } from "@/features/map/style-catalog";
import { useNativeBasemap } from "@/features/map/use-native-basemap";
import { useTheme, READING_START } from "@/theme";

/**
 * Native (iOS/Android) Map tab on MapLibre Native, built to match the web's
 * `app/(tabs)/(map)/map.web.tsx` (maplibre-gl) feature for feature:
 *
 * - the same basemap and style choice (`useNativeBasemap`: MapTiler, the
 *   one-time OpenFreeMap fall-back, the offline state with Retry);
 * - Home/World scope, magnitude and date filters, the style and Layers
 *   picker, the legend and the tapped-feature card;
 * - every event as a dot sized and coloured by magnitude, in ONE GeoJSON
 *   source drawn by circle layers (`native-layers.ts`), tap → the same
 *   preview sheet → the event page with "Back to map";
 * - the context overlays, the own Kurdish place labels and the hillshade.
 *
 * Expo Go and any build without MapLibre's native code keep the translated
 * "needs a full app installation" state.
 *
 * A `.native.tsx` file on purpose: Expo Router bundles every route file on
 * every platform, so the route `app/(tabs)/(map)/map.tsx` only renders this
 * component and the web resolves the empty `NativeMapTab.tsx` instead; none
 * of this code reaches the web bundle. The package itself is loaded only by
 * `native-maplibre.native.ts`.
 */

type MapRef = import("@maplibre/maplibre-react-native").MapRef;
type CameraRef = import("@maplibre/maplibre-react-native").CameraRef;
type PressEvent = import("@maplibre/maplibre-react-native").PressEvent;
type PressEventWithFeatures =
  import("@maplibre/maplibre-react-native").PressEventWithFeatures;

/** How far above the centre a selected event settles, so the preview
 * sheet does not cover it (the web's `MAP_SHEET_SELECT_OFFSET_PX`). */
const SHEET_SELECT_OFFSET_PT = 90;

const FIT_PADDING = {
  top: MAP_FIT_BOUNDS_PADDING_PX,
  right: MAP_FIT_BOUNDS_PADDING_PX,
  bottom: MAP_FIT_BOUNDS_PADDING_PX,
  left: MAP_FIT_BOUNDS_PADDING_PX,
};

function toCameraBounds(bbox: RegionBbox): [number, number, number, number] {
  return [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat];
}

/** The web map's first view: the region bounds with the usual padding. */
const INITIAL_VIEW = { bounds: toCameraBounds(REGION_BBOX), padding: FIT_PADDING };

/** Which tap layer a press on an overlay source stands for
 * (`describeOverlayFeature` reads by layer id, as on the web). */
const OVERLAY_TAP_LAYER_BY_SOURCE: Record<string, string> = {
  [HISTORICAL_SOURCE_ID]: HISTORICAL_LAYER_ID,
  [AFEAD_SOURCE_ID]: AFEAD_HIT_LAYER_ID,
  [FAULTS_SOURCE_ID]: FAULTS_HIT_LAYER_ID,
};

/** `NativeLayerProps` is the style-spec JSON `<Layer>` takes; its own
 * prop type is a union TypeScript cannot match a plain object against. */
function asLayerProps(
  layer: NativeLayerProps,
): import("@maplibre/maplibre-react-native").LayerProps {
  return layer as unknown as import("@maplibre/maplibre-react-native").LayerProps;
}

const EVENT_HITBOX = {
  top: EVENT_MARKER_HITBOX_HALF_PT,
  right: EVENT_MARKER_HITBOX_HALF_PT,
  bottom: EVENT_MARKER_HITBOX_HALF_PT,
  left: EVENT_MARKER_HITBOX_HALF_PT,
};

/**
 * The tier-3 (village) Kurdish places, loaded once when the map first
 * shows, as on the web (`map.web.tsx`'s `loadKurdishVillagePlaces`).
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

export function NativeMapTab() {
  const { t } = useTranslation();
  const mapLibre = useMemo(() => loadNativeMapLibre(), []);
  if (!mapLibre) {
    return (
      <EmptyStateScreen
        title={t("map.title")}
        description={t("map.nativeUnavailableDescription")}
      />
    );
  }
  return <NativeMapScreen mapLibre={mapLibre} />;
}

type MapControlId = "filters" | "style";

function NativeMapScreen({ mapLibre }: { mapLibre: MapLibreModule }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { colors, scheme, spacing, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const isCompactControls = isCompactMapControlsWidth(windowWidth);
  const prefersReducedMotion = useReducedMotionPreference();

  const { events: regionEvents, dataUpdatedAt: regionDataUpdatedAt } = useRegionEvents();
  const { events: worldEvents, dataUpdatedAt: worldDataUpdatedAt } = useWorldEvents();

  const eventSheet = useEventSheetController();
  const selectEvent = eventSheet.select;
  const sheetRef = useRef<EventPreviewSheetHandle>(null);

  const styleId = useMapPreferencesStore((state) => state.styleId);
  const setStyleId = useMapPreferencesStore((state) => state.setStyleId);
  const overlays = useMapPreferencesStore((state) => state.overlays);
  const setOverlay = useMapPreferencesStore((state) => state.setOverlay);
  const hasStyleHydrated = useMapPreferencesStore((state) => state.hasHydrated);

  // "Map loads lazily when the tab is focused", as on the web: nothing
  // (style download, MapLibre view) starts before the first visit, and the
  // map then stays alive like the web's single map instance.
  const [hasFocused, setHasFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setHasFocused(true);
    }, []),
  );

  const basemap = useNativeBasemap({
    styleId,
    scheme,
    locale,
    terrain: true,
    anchorLayerIds: NATIVE_OVERLAY_ANCHOR_IDS,
    enabled: hasFocused && hasStyleHydrated,
  });

  const [scope, setScope] = useState<MapScope>(DEFAULT_MAP_SCOPE);
  const [magnitudeRange, setMagnitudeRange] = useState<MagnitudeRange | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeMs | null>(null);
  const [openControl, setOpenControl] = useState<MapControlId | null>(null);
  const [overlayInfo, setOverlayInfo] = useState<OverlayInfo | null>(null);
  const closeOpenControl = useCallback(() => setOpenControl(null), []);
  const toggleControl = useCallback((id: MapControlId) => {
    setOpenControl((current) => (current === id ? null : id));
  }, []);

  const handleScopeChange = useCallback((nextScope: MapScope) => {
    setScope(nextScope);
    setMagnitudeRange(null);
    setDateRange(null);
  }, []);
  const handleResetFilters = useCallback(() => {
    setMagnitudeRange(null);
    setDateRange(null);
  }, []);

  const scopedEvents = scope === "world" ? worldEvents : regionEvents;
  const scopedDataUpdatedAt =
    scope === "world" ? worldDataUpdatedAt : regionDataUpdatedAt;
  const magnitudeBounds = useMemo(
    () => computeMagnitudeBounds(scopedEvents),
    [scopedEvents],
  );
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
  const eventById = useMemo(
    () => new Map<string, Event>(filteredEvents.map((event) => [event.id, event])),
    [filteredEvents],
  );
  const markerData = useMemo(
    () => buildEventMarkerFeatureCollection(buildRegionMarkers(filteredEvents)),
    [filteredEvents],
  );
  const markerLayers = useMemo(
    () =>
      buildEventMarkerLayers({
        magnitudeBand: colors.magnitudeBand,
        felt: colors.action.felt,
        ring: colors.surface.raised,
      }),
    [colors],
  );

  // Own Kurdish place labels: core places now, villages once loaded.
  const [kurdishPlaces, setKurdishPlaces] =
    useState<readonly KurdishPlace[]>(KURDISH_PLACES_CORE);
  const isReady = basemap.phase === "ready";
  useEffect(() => {
    if (!isReady) return;
    let cancelled = false;
    loadKurdishVillagePlaces()
      .then((villages) => {
        if (!cancelled) setKurdishPlaces([...KURDISH_PLACES_CORE, ...villages]);
      })
      .catch(() => {
        // Villages are an enhancement over the always-present core set.
      });
    return () => {
      cancelled = true;
    };
  }, [isReady]);
  const ownLabelsData = useMemo(
    () =>
      toNativeOwnLabels(
        buildMergedOwnLabelFeatureCollection(
          locale,
          REGION_BBOX,
          undefined,
          kurdishPlaces,
        ),
      ),
    [locale, kurdishPlaces],
  );
  const ownLabelsLayer = useMemo(
    () => toNativeLayerProps(buildOwnLabelsLayer(scheme, basemap.ownLabelsFont)),
    [scheme, basemap.ownLabelsFont],
  );

  const nativeOverlays = useMemo(
    () => buildNativeOverlays(overlays, scheme, { origin: APP_ORIGIN }),
    [overlays, scheme],
  );

  // "Home": the reader's own area when a fix is already known, else the
  // region (the anchor never prompts for permission).
  const { hasFix: hasUserFix, lat: userLat, lon: userLon } = useUserDistanceAnchor();
  const homeBounds = useMemo(
    () =>
      hasUserFix && userLat !== null && userLon !== null
        ? toCameraBounds(homeBboxAround(userLat, userLon))
        : toCameraBounds(REGION_BBOX),
    [hasUserFix, userLat, userLon],
  );

  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);

  // Re-frames on a scope switch, and once when the map first shows with a
  // location fix or a fix arrives later (the web's scope/home effect; the
  // web's map is created after the fix in most sessions, the native map
  // opens on the region and moves there).
  const previousScopeRef = useRef<MapScope>(scope);
  const framedHomeRef = useRef<readonly number[] | null>(null);
  useEffect(() => {
    if (!isReady) return;
    const scopeChanged = previousScopeRef.current !== scope;
    previousScopeRef.current = scope;
    const homeMoved =
      scope === "kurdistan" && hasUserFix && framedHomeRef.current !== homeBounds;
    if (!scopeChanged && !homeMoved) return;
    if (scope === "kurdistan") framedHomeRef.current = homeBounds;
    const bounds = scope === "world" ? toCameraBounds(WORLD_VIEW_BBOX) : homeBounds;
    cameraRef.current?.fitBounds(bounds, {
      padding: FIT_PADDING,
      duration: prefersReducedMotion ? 0 : 600,
    });
  }, [scope, isReady, homeBounds, hasUserFix, prefersReducedMotion]);

  /** Settles the selected event above the centre (the web's `easeTo` with
   * an offset): the new centre is the point 90 pt below the event. */
  const centreAboveSheet = useCallback(
    async (event: Event) => {
      const map = mapRef.current;
      const camera = cameraRef.current;
      if (!map || !camera) return;
      try {
        const [x, y] = await map.project([event.lon, event.lat]);
        const center = await map.unproject([x, y + SHEET_SELECT_OFFSET_PT]);
        camera.easeTo({ center, duration: prefersReducedMotion ? 0 : 300 });
      } catch {
        // The map went away mid-tap; nothing to move.
      }
    },
    [prefersReducedMotion],
  );

  const handleEventPress = useCallback(
    (pressEvent: NativeSyntheticEvent<PressEventWithFeatures>) => {
      pressEvent.stopPropagation();
      const { features, lngLat } = pressEvent.nativeEvent;
      const id = pickPressedEventId(features, lngLat);
      const event = id ? eventById.get(id) : undefined;
      if (!event) return;
      setOpenControl(null);
      setOverlayInfo(null);
      selectEvent(event);
      AccessibilityInfo.announceForAccessibility(
        [
          t("events.magnitudeA11yLabel", {
            value: formatMagnitudeValue(event.magnitude.value, locale),
          }),
          placeLine(event, locale, t),
        ]
          .filter(Boolean)
          .join(". "),
      );
      void centreAboveSheet(event);
    },
    [eventById, selectEvent, t, locale, centreAboveSheet],
  );

  const handleOverlayPress = useCallback(
    (sourceId: string, pressEvent: NativeSyntheticEvent<PressEventWithFeatures>) => {
      pressEvent.stopPropagation();
      sheetRef.current?.requestClose();
      setOpenControl(null);
      const layerId = OVERLAY_TAP_LAYER_BY_SOURCE[sourceId];
      const first = pressEvent.nativeEvent.features[0];
      setOverlayInfo(
        layerId && first
          ? describeOverlayFeature(
              layerId,
              first.properties as Record<string, unknown> | null,
            )
          : null,
      );
    },
    [],
  );

  // A tap anywhere else closes the sheet and the card (the web's map-wide
  // "click" listener).
  const handleMapPress = useCallback((_event: NativeSyntheticEvent<PressEvent>) => {
    sheetRef.current?.requestClose();
    setOverlayInfo(null);
    setOpenControl(null);
  }, []);

  const handleStyleChange = useCallback(
    (nextStyleId: MapStyleCatalogId) => setStyleId(nextStyleId),
    [setStyleId],
  );
  const handleToggleOverlay = useCallback(
    (id: MapLayerId, on: boolean) => {
      setOverlay(id, on);
      if (!on) setOverlayInfo(null);
    },
    [setOverlay],
  );

  const handleShowCredits = useCallback(() => {
    mapRef.current?.showAttribution().catch(() => {
      // Only fails when the native map is gone; the next tap tries again.
    });
  }, []);

  const { Map: MapView, Camera, GeoJSONSource, ImageSource, Layer } = mapLibre;

  const renderLayers = (layers: readonly NativeLayerProps[]) =>
    layers.map((layer) => <Layer key={layer.id} {...asLayerProps(layer)} />);

  const renderOverlaySource = (source: NativeSourceProps, layers: NativeLayerProps[]) => {
    if (source.kind === "image") {
      return (
        <ImageSource
          key={source.id}
          id={source.id}
          url={source.url}
          coordinates={source.coordinates}
        >
          {renderLayers(layers)}
        </ImageSource>
      );
    }
    if (source.kind !== "geojson") return null;
    const tappable = OVERLAY_TAP_LAYER_BY_SOURCE[source.id] !== undefined;
    return (
      <GeoJSONSource
        key={source.id}
        id={source.id}
        data={source.data as string}
        {...(tappable
          ? {
              onPress: (event: NativeSyntheticEvent<PressEventWithFeatures>) =>
                handleOverlayPress(source.id, event),
            }
          : {})}
      >
        {renderLayers(layers)}
      </GeoJSONSource>
    );
  };

  const showMap = basemap.mapStyle !== null && basemap.phase !== "error";
  const showLoading = basemap.phase === "resolving" || basemap.phase === "loading";

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.surface.base, paddingTop: insets.top },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: typography.h2.fontSize,
          lineHeight: typography.h2.lineHeight,
          fontWeight: typography.h2.fontWeight,
          fontFamily: typography.h2.fontFamily,
          ...READING_START,
          paddingHorizontal: spacing[4],
          paddingBottom: spacing[2],
        }}
      >
        {t("map.title")}
      </Text>

      <View style={styles.mapArea}>
        {showMap ? (
          <MapView
            key={basemap.mapKey}
            ref={mapRef}
            testID="native-map"
            style={styles.map}
            mapStyle={basemap.mapStyle as string}
            logo={false}
            attribution={false}
            compass={false}
            onPress={handleMapPress}
            onDidFinishLoadingMap={basemap.onDidFinishLoadingMap}
            onDidFailLoadingMap={basemap.onDidFailLoadingMap}
          >
            <Camera ref={cameraRef} initialViewState={INITIAL_VIEW} />
            {nativeOverlays.map((overlay) =>
              renderOverlaySource(overlay.source, overlay.layers),
            )}
            <GeoJSONSource id={OWN_LABELS_SOURCE_ID} data={ownLabelsData}>
              {renderLayers([ownLabelsLayer])}
            </GeoJSONSource>
            <GeoJSONSource
              id={EVENT_MARKERS_SOURCE_ID}
              data={markerData}
              hitbox={EVENT_HITBOX}
              onPress={handleEventPress}
            >
              {renderLayers(markerLayers)}
            </GeoJSONSource>
          </MapView>
        ) : null}

        {isReady && openControl ? (
          <Pressable
            testID="map-controls-backdrop"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.overlay}
            onPress={closeOpenControl}
          />
        ) : null}

        {isReady ? (
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
              <NativeMapFilterPanel
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
              <View style={isCompactControls ? styles.popoverAnchor : undefined}>
                <MapStylePicker
                  value={styleId}
                  onChange={handleStyleChange}
                  expanded={openControl === "style"}
                  onToggleExpanded={() => toggleControl("style")}
                  compact={isCompactControls}
                  overlays={overlays}
                  onToggleOverlay={handleToggleOverlay}
                />
              </View>
            </View>
          </View>
        ) : null}

        {isReady ? (
          <NativeMapCredits
            provider={basemap.provider}
            onShowCredits={handleShowCredits}
          />
        ) : null}

        {isReady && !openControl && overlayInfo ? (
          <MapOverlayInfoCard info={overlayInfo} onClose={() => setOverlayInfo(null)} />
        ) : null}
        {isReady && !openControl && !overlayInfo ? (
          // Lifted clear of the 44 pt credits button at the reading start.
          <View style={styles.legendFrame} pointerEvents="box-none">
            <MapOverlayLegend
              active={activeOverlayIds(overlays)}
              compact={isCompactControls}
            />
          </View>
        ) : null}

        {basemap.phase === "error" ? (
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
                    fontFamily: typography.bodyDefault.fontFamily,
                    ...READING_START,
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
                  fontFamily: typography.bodyMeta.fontFamily,
                  ...READING_START,
                }}
              >
                {t("map.offlineDescription")}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={basemap.retry}
                style={styles.retry}
              >
                <Text
                  style={{
                    color: colors.text.link,
                    fontSize: typography.bodyMeta.fontSize,
                    fontFamily: typography.bodyMeta.fontFamily,
                    ...READING_START,
                    fontWeight: "600",
                  }}
                >
                  {t("map.retry")}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {showLoading ? (
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
                fontFamily: typography.bodyMeta.fontFamily,
                ...READING_START,
                marginTop: spacing[2],
              }}
            >
              {t("map.loading")}
            </Text>
          </View>
        ) : null}

        {isReady && eventSheet.content ? (
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapArea: {
    flex: 1,
    position: "relative",
  },
  map: {
    flex: 1,
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
  retry: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
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
  controlsColumnCompact: {
    flexDirection: "row",
    alignItems: "center",
  },
  popoverAnchor: {
    width: 44,
    height: 44,
  },
  legendFrame: {
    position: "absolute",
    top: 0,
    start: 0,
    end: 0,
    bottom: 52,
  },
});
