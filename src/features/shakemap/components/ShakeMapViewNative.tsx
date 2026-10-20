import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Svg, { Polygon } from "react-native-svg";

// Deep imports only: the `@/features/map` index also exports the web's
// maplibre-gl loader, which must never reach the native bundle.
import { NativeMapCredits } from "@/features/map/components/NativeMapCredits";
import { NativeMapZoomControls } from "@/features/map/components/NativeMapZoomControls";
import { MAP_FIT_BOUNDS_PADDING_PX } from "@/features/map/config";
import type { MapLibreModule } from "@/features/map/native-maplibre";
import { MAP_CONTROLS_COMPACT_MAX_WIDTH_PX } from "@/features/map/responsive";
import { useNativeBasemap } from "@/features/map/use-native-basemap";
import { useTheme } from "@/theme";
import { SHAKEMAP_BAND_FILL_OPACITY } from "../config";
import { DAMAGE_GRADE_LABELS } from "../damage-ramp";
import { formatIntensity } from "../intensity-format";
import { computeContourBoundingBox } from "../projection";
import { starPointsAttribute } from "../star-marker";
import {
  buildContourFeatureCollection,
  buildLevelColorMatchExpression,
  SHAKEMAP_WEB_DAMAGE_FILL_LAYER_ID,
  SHAKEMAP_WEB_DAMAGE_LINE_LAYER_ID,
  SHAKEMAP_WEB_DAMAGE_SOURCE_ID,
  SHAKEMAP_WEB_INTENSITY_FILL_LAYER_ID,
  SHAKEMAP_WEB_INTENSITY_LINE_LAYER_ID,
  SHAKEMAP_WEB_INTENSITY_SOURCE_ID,
} from "../web-map";
import { ShakeMapLayerToggle } from "./ShakeMapLayerToggle";
import { ShakeMapLegend, type ShakeMapLayer } from "./ShakeMapLegend";
import {
  ShakeMapView as ShakeMapViewSvg,
  type ShakeMapViewProps,
} from "./ShakeMapViewSvg";

type MapRef = import("@maplibre/maplibre-react-native").MapRef;
type CameraRef = import("@maplibre/maplibre-react-native").CameraRef;
type LayerProps = import("@maplibre/maplibre-react-native").LayerProps;

/** The web's heights: phone width, and wider layouts. */
const HEIGHT_PHONE_PT = 320;
const HEIGHT_WIDE_PT = 420;
/** The epicentre star (the web's DOM marker size). */
const EPICENTER_PT = 22;

/** The bands go under the basemap's labels (owner, 2026-09-27: the place
 * names must stay readable), at this placeholder (`insertAnchorLayers`). */
export const SHAKEMAP_BANDS_ANCHOR_ID = "bumelerze-anchor-shakemap";
const ANCHORS: readonly string[] = [SHAKEMAP_BANDS_ANCHOR_ID];

function heightForWidth(width: number): number {
  return width >= MAP_CONTROLS_COMPACT_MAX_WIDTH_PX ? HEIGHT_WIDE_PT : HEIGHT_PHONE_PT;
}

/**
 * The event page's SHAKEmap on MapLibre Native (iOS/Android), the same map
 * as the web's `ShakeMapView.web.tsx`: the default MapTiler basemap (the
 * OpenFreeMap fall-back, the hillshade when the style has none), the
 * intensity and damage bands as fill + outline layers under the labels,
 * switched by the shared Intensity/Damage toggle, the epicentre star, zoom
 * buttons, the credits, and the shared legend below.
 *
 * Inside the scrolling event page one finger scrolls the page, as the web's
 * cooperative gestures do: the map pans only with two fingers (pinch) and
 * the zoom buttons. If no map can be shown at all, the SVG map stands in,
 * as on the web.
 */
export function ShakeMapViewNative({
  mapLibre,
  ...props
}: ShakeMapViewProps & { mapLibre: MapLibreModule }) {
  const { contours, epicenter, locale, t, placeText, damageContours } = props;
  const { scheme, colors, typography, spacing } = useTheme();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [layer, setLayer] = useState<ShakeMapLayer>("intensity");
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);

  const hasDamageLayer = Boolean(damageContours && damageContours.levels.length > 0);
  const activeLayer: ShakeMapLayer = hasDamageLayer ? layer : "intensity";

  const basemap = useNativeBasemap({
    scheme,
    locale,
    terrain: true,
    anchorLayerIds: ANCHORS,
    localizeLabels: false,
  });

  const initialView = useMemo(() => {
    const bbox = computeContourBoundingBox(contours.levels, [
      [epicenter.lon, epicenter.lat],
    ]);
    return {
      bounds: [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat] as [
        number,
        number,
        number,
        number,
      ],
      padding: {
        top: MAP_FIT_BOUNDS_PADDING_PX,
        right: MAP_FIT_BOUNDS_PADDING_PX,
        bottom: MAP_FIT_BOUNDS_PADDING_PX,
        left: MAP_FIT_BOUNDS_PADDING_PX,
      },
    };
  }, [contours.levels, epicenter.lon, epicenter.lat]);

  const intensityData = useMemo(
    () => buildContourFeatureCollection(contours.levels),
    [contours.levels],
  );
  const damageData = useMemo(
    () => (damageContours ? buildContourFeatureCollection(damageContours.levels) : null),
    [damageContours],
  );

  const bandLayers = useCallback(
    (
      fillId: string,
      lineId: string,
      sourceId: string,
      ramp: readonly string[],
      maxLevel: number,
      visible: boolean,
    ): LayerProps[] => {
      const color = buildLevelColorMatchExpression(ramp, maxLevel);
      const layout = { visibility: visible ? "visible" : "none" };
      return [
        {
          id: fillId,
          type: "fill",
          source: sourceId,
          beforeId: SHAKEMAP_BANDS_ANCHOR_ID,
          layout,
          paint: { "fill-color": color, "fill-opacity": SHAKEMAP_BAND_FILL_OPACITY },
        },
        {
          id: lineId,
          type: "line",
          source: sourceId,
          beforeId: SHAKEMAP_BANDS_ANCHOR_ID,
          layout,
          paint: { "line-color": color, "line-width": 0.75, "line-opacity": 0.8 },
        },
      ] as unknown as LayerProps[];
    },
    [],
  );

  const zoomBy = useCallback(async (delta: number) => {
    const zoom = await mapRef.current?.getZoom().catch(() => null);
    if (typeof zoom === "number") {
      cameraRef.current?.zoomTo(zoom + delta, { duration: 200 });
    }
  }, []);

  const handleShowCredits = useCallback(() => {
    mapRef.current?.showAttribution().catch(() => {
      // Only fails once the native map is gone.
    });
  }, []);

  if (basemap.phase === "error") {
    return <ShakeMapViewSvg {...props} />;
  }

  const highestLevel = contours.levels[contours.levels.length - 1];
  const highestDamageLevel = damageContours?.levels[damageContours.levels.length - 1];
  const mapA11yLabel =
    activeLayer === "damage"
      ? t("eventDetail.shakemap.mapA11yLabelDamage", {
          level: highestDamageLevel ? DAMAGE_GRADE_LABELS[highestDamageLevel.level] : "",
          place: placeText,
        })
      : t("eventDetail.shakemap.mapA11yLabel", {
          level: highestLevel ? formatIntensity(highestLevel.level, locale) : "",
          place: placeText,
        });

  const { Map: MapView, Camera, GeoJSONSource, Layer, ViewAnnotation } = mapLibre;
  const isReady = basemap.phase === "ready";

  return (
    <View
      style={{ gap: spacing[2] }}
      onLayout={(event: LayoutChangeEvent) =>
        setMeasuredWidth(event.nativeEvent.layout.width)
      }
    >
      <ShakeMapLayerToggle
        hasDamageLayer={hasDamageLayer}
        activeLayer={activeLayer}
        onChange={setLayer}
        t={t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />

      <View
        testID="shakemap-map-container"
        style={[
          styles.mapContainer,
          {
            height: heightForWidth(measuredWidth),
            backgroundColor: colors.surface.sunken,
          },
        ]}
      >
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={mapA11yLabel}
          style={StyleSheet.absoluteFill}
        >
          {basemap.mapStyle !== null ? (
            <MapView
              key={basemap.mapKey}
              ref={mapRef}
              testID="shakemap-native-map"
              style={styles.map}
              mapStyle={basemap.mapStyle as string}
              logo={false}
              attribution={false}
              compass={false}
              dragPan={false}
              touchRotate={false}
              touchPitch={false}
              onDidFinishLoadingMap={basemap.onDidFinishLoadingMap}
              onDidFailLoadingMap={basemap.onDidFailLoadingMap}
            >
              <Camera ref={cameraRef} initialViewState={initialView} />
              <GeoJSONSource id={SHAKEMAP_WEB_INTENSITY_SOURCE_ID} data={intensityData}>
                {bandLayers(
                  SHAKEMAP_WEB_INTENSITY_FILL_LAYER_ID,
                  SHAKEMAP_WEB_INTENSITY_LINE_LAYER_ID,
                  SHAKEMAP_WEB_INTENSITY_SOURCE_ID,
                  colors.intensity,
                  12,
                  activeLayer === "intensity",
                ).map((spec) => (
                  <Layer key={String(spec.id)} {...spec} />
                ))}
              </GeoJSONSource>
              {hasDamageLayer && damageData ? (
                <GeoJSONSource id={SHAKEMAP_WEB_DAMAGE_SOURCE_ID} data={damageData}>
                  {bandLayers(
                    SHAKEMAP_WEB_DAMAGE_FILL_LAYER_ID,
                    SHAKEMAP_WEB_DAMAGE_LINE_LAYER_ID,
                    SHAKEMAP_WEB_DAMAGE_SOURCE_ID,
                    colors.damageGrade,
                    5,
                    activeLayer === "damage",
                  ).map((spec) => (
                    <Layer key={String(spec.id)} {...spec} />
                  ))}
                </GeoJSONSource>
              ) : null}
              <ViewAnnotation
                id="bumelerze-shakemap-epicenter"
                lngLat={[epicenter.lon, epicenter.lat]}
                anchor="center"
              >
                <View pointerEvents="none" style={styles.star}>
                  <Svg width={EPICENTER_PT} height={EPICENTER_PT}>
                    <Polygon
                      points={starPointsAttribute(
                        EPICENTER_PT / 2,
                        EPICENTER_PT / 2,
                        EPICENTER_PT * 0.42,
                      )}
                      fill={colors.status.danger}
                      stroke={colors.surface.base}
                      strokeWidth={1.5}
                      strokeLinejoin="round"
                    />
                  </Svg>
                </View>
              </ViewAnnotation>
            </MapView>
          ) : null}
        </View>

        {isReady ? (
          <>
            <NativeMapZoomControls
              onZoomIn={() => void zoomBy(1)}
              onZoomOut={() => void zoomBy(-1)}
            />
            <NativeMapCredits
              provider={basemap.provider}
              onShowCredits={handleShowCredits}
            />
          </>
        ) : (
          <View style={styles.loading} pointerEvents="none">
            <ActivityIndicator color={colors.text.secondary} />
          </View>
        )}
      </View>

      <ShakeMapLegend
        layer={activeLayer}
        locale={locale}
        t={t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  mapContainer: {
    width: "100%",
    borderRadius: 12,
    overflow: "hidden",
  },
  map: {
    flex: 1,
  },
  star: {
    width: EPICENTER_PT,
    height: EPICENTER_PT,
  },
  loading: {
    position: "absolute",
    top: 0,
    start: 0,
    end: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
