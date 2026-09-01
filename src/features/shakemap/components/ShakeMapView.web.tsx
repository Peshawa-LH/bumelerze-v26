import "maplibre-gl/dist/maplibre-gl.css";

import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { ActivityIndicator, StyleSheet, View } from "react-native";

// Deliberately imported from each submodule directly, never the
// `@/features/map` BARREL (`index.ts`) — that barrel also re-exports
// `marker-helpers.ts`, which pulls in `@/features/events` and, through it,
// `expo-router` at real-module-eval time. Harmless in production (this
// screen already has `expo-router` loaded), but under this repo's default
// Jest jsdom environment `expo-router`'s own `global-state` module throws
// at import time (`URLSearchParams is not defined` — a real environment
// gap, not something this component should need to route around via an
// `expo-router` mock just to reach a handful of pure map/style helpers
// that have nothing to do with routing).
import {
  buildTerrainDemSource,
  buildTerrainHillshadeLayer,
  findHillshadeBeforeLayerId,
  styleHasRasterDemSource,
  TERRAIN_DEM_SOURCE_ID,
} from "@/features/map/terrain";
import { loadMapLibre } from "@/features/map/maplibre-loader";
import { MAP_FIT_BOUNDS_PADDING_PX } from "@/features/map/config";
import { MAP_CONTROLS_COMPACT_MAX_WIDTH_PX } from "@/features/map/responsive";
import {
  decideMapErrorAction,
  resolveMapStyle,
  type MapStyleProviderId,
} from "@/features/map/style-provider";
import { useTheme } from "@/theme";
import { DAMAGE_GRADE_LABELS } from "../damage-ramp";
import { INTENSITY_ROMAN_NUMERALS } from "../intensity-ramp";
import { computeContourBoundingBox } from "../projection";
import { buildStarMarkerSvgMarkup } from "../star-marker";
import {
  buildContourFeatureCollection,
  buildLevelColorMatchExpression,
  contourBoundsToLngLatBounds,
  SHAKEMAP_WEB_DAMAGE_FILL_LAYER_ID,
  SHAKEMAP_WEB_DAMAGE_LINE_LAYER_ID,
  SHAKEMAP_WEB_DAMAGE_SOURCE_ID,
  SHAKEMAP_WEB_INTENSITY_FILL_LAYER_ID,
  SHAKEMAP_WEB_INTENSITY_LINE_LAYER_ID,
  SHAKEMAP_WEB_INTENSITY_SOURCE_ID,
} from "../web-map";
import { ShakeMapLayerToggle } from "./ShakeMapLayerToggle";
import { ShakeMapLegend, type ShakeMapLayer } from "./ShakeMapLegend";
import { ShakeMapView as ShakeMapViewSvg, type ShakeMapViewProps } from "./ShakeMapViewSvg";

/** Below this measured width the map renders at the shorter (phone)
 * height; at/above it, the taller (wider-layout) height — same threshold
 * `@/features/map`'s own `isCompactMapControlsWidth` uses for "is this
 * phone-narrow", reused directly rather than a second near-duplicate
 * constant. */
const SHAKEMAP_WEB_HEIGHT_PHONE_PX = 320;
const SHAKEMAP_WEB_HEIGHT_WIDE_PX = 420;

/** DOM marker size (px) for the epicenter star — matches the wave brief
 * ("about 22 px"). */
const EPICENTER_MARKER_SIZE_PX = 22;

/**
 * `app/(tabs)/map.web.tsx`'s doc comment explains why this file only
 * exists on web at all (Metro's platform-extension resolution). This is
 * the SAME reason `./ShakeMapView` (no extension, what `ShakeMapSection`
 * imports) resolves to THIS file for real web builds and to
 * `ShakeMapView.tsx` (the thin SVG re-export) for native builds and under
 * Jest (no "web" platform in this repo's default jest-expo preset — see
 * `ShakeMapView.tsx`'s own doc comment). Jest tests for this file must
 * therefore import it by its own explicit filename
 * (`../components/ShakeMapView.web`), exactly like the Map tab's own
 * `map-web-*.test.tsx` files import `../(tabs)/map.web`.
 */

function heightForWidth(measuredWidth: number): number {
  return measuredWidth >= MAP_CONTROLS_COMPACT_MAX_WIDTH_PX
    ? SHAKEMAP_WEB_HEIGHT_WIDE_PX
    : SHAKEMAP_WEB_HEIGHT_PHONE_PX;
}

/**
 * Interactive MapLibre GL JS SHAKEmap for one event (web-map wave — owner:
 * "I don't see a basemap or interactive map"). Same real basemap
 * resolution as the Map tab (`@/features/map`'s `resolveMapStyle`/
 * `decideMapErrorAction`: MapTiler when a key is configured, OpenFreeMap
 * otherwise or as the one-shot runtime fallback if MapTiler ever fails to
 * load) plus the same AWS terrarium hillshade (`terrain.ts`) when the
 * active style doesn't already ship its own.
 *
 * The intensity/damage contour rings become two independent GeoJSON
 * sources (`web-map.ts`'s `buildContourFeatureCollection`), each with a
 * `fill` (data-driven `match` on `level`, `theme.colors.intensity`/
 * `damageGrade`) and a thin `line` layer for ring outlines; the existing
 * Intensity/Damage toggle (`ShakeMapLayerToggle`, shared with the SVG
 * view) switches which pair is visible via `setLayoutProperty`, never by
 * rebuilding the sources. The epicenter is a real `maplibre.Marker` (a
 * small inline-SVG star DOM element, `star-marker.ts` — shared geometry
 * with the SVG view's own star), and the legend strip below the map is
 * the exact same shared `ShakeMapLegend` component the SVG view uses.
 *
 * "Never a blank box": if `maplibre-gl` itself fails to load (network
 * blip, ad-blocker, whatever), OR the style fails to load and even the
 * OpenFreeMap fallback fails, this component renders the SVG view
 * (`ShakeMapViewSvg`) instead — the exact same product, always something
 * real on screen.
 */
export function ShakeMapView(props: ShakeMapViewProps) {
  const { contours, epicenter, t, placeText, damageContours } = props;
  const { scheme, colors, typography, spacing } = useTheme();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const epicenterMarkerRef = useRef<MapLibreMarker | null>(null);
  const creationStartedRef = useRef(false);
  const activeProviderRef = useRef<MapStyleProviderId>("openfreemap");
  const fallbackAttemptedRef = useRef(false);

  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready">("idle");
  const [layer, setLayer] = useState<ShakeMapLayer>("intensity");
  const [retryTick, setRetryTick] = useState(0);
  // Set once, never cleared — the ultimate "never a blank box" fallback
  // (module doc comment above). Once true, the component permanently
  // renders `ShakeMapViewSvg` instead of attempting MapLibre again.
  const [showSvgFallback, setShowSvgFallback] = useState(false);

  const hasDamageLayer = Boolean(damageContours && damageContours.levels.length > 0);
  const activeLayer: ShakeMapLayer = hasDamageLayer ? layer : "intensity";

  function handleLayout(event: LayoutChangeEvent) {
    setMeasuredWidth(event.nativeEvent.layout.width);
  }

  // Map creation — runs once (`creationStartedRef`), or again after a
  // runtime MapTiler->OpenFreeMap fallback (`retryTick`, same latch
  // pattern `map.web.tsx` uses). Guarded on `containerRef.current` already
  // existing, i.e. after the first layout/paint.
  useEffect(() => {
    if (showSvgFallback || creationStartedRef.current || !containerRef.current) {
      return;
    }
    creationStartedRef.current = true;
    let cancelled = false;
    let hasLoaded = false;
    setLoadState("loading");

    const { provider, url: styleUrl } = resolveMapStyle(
      scheme,
      fallbackAttemptedRef.current ? "openfreemap" : undefined,
    );
    activeProviderRef.current = provider;

    loadMapLibre()
      .then((maplibre) => {
        if (cancelled || !containerRef.current) {
          return;
        }

        const map = new maplibre.Map({
          container: containerRef.current,
          style: styleUrl,
          // Fits to the contour bbox once "load" fires (below) — this
          // initial `center`/`zoom` is only a placeholder frame before
          // that first `fitBounds` call.
          center: [epicenter.lon, epicenter.lat],
          zoom: 4,
          attributionControl: false,
          // "scroll-zoom only with ctrl/cmd... page scrolling is not
          // hijacked" (wave brief) — a real maplibre-gl 6.x `Map` option,
          // not a hand-rolled wheel-event guard.
          cooperativeGestures: true,
        });
        mapRef.current = map;

        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        // `compact: true` (unlike the Map tab's `compact: false`): this is
        // a small embedded widget, not a full-screen map — an always-
        // expanded credit line would dominate a 320px-tall box.
        map.addControl(new maplibre.AttributionControl({ compact: true }));

        map.on("load", () => {
          if (cancelled) {
            return;
          }
          hasLoaded = true;

          const style = map.getStyle();
          if (style && !styleHasRasterDemSource(style.sources)) {
            map.addSource(TERRAIN_DEM_SOURCE_ID, buildTerrainDemSource());
            const beforeId = findHillshadeBeforeLayerId(style.layers ?? []);
            map.addLayer(buildTerrainHillshadeLayer(scheme), beforeId);
          }

          const intensityCollection = buildContourFeatureCollection(contours.levels);
          map.addSource(SHAKEMAP_WEB_INTENSITY_SOURCE_ID, {
            type: "geojson",
            data: intensityCollection,
          });
          map.addLayer({
            id: SHAKEMAP_WEB_INTENSITY_FILL_LAYER_ID,
            type: "fill",
            source: SHAKEMAP_WEB_INTENSITY_SOURCE_ID,
            paint: {
              "fill-color": buildLevelColorMatchExpression(colors.intensity, 12) as never,
              "fill-opacity": 0.55,
            },
          });
          map.addLayer({
            id: SHAKEMAP_WEB_INTENSITY_LINE_LAYER_ID,
            type: "line",
            source: SHAKEMAP_WEB_INTENSITY_SOURCE_ID,
            paint: {
              "line-color": buildLevelColorMatchExpression(colors.intensity, 12) as never,
              "line-width": 0.75,
              "line-opacity": 0.8,
            },
          });

          if (hasDamageLayer && damageContours) {
            const damageCollection = buildContourFeatureCollection(damageContours.levels);
            map.addSource(SHAKEMAP_WEB_DAMAGE_SOURCE_ID, {
              type: "geojson",
              data: damageCollection,
            });
            map.addLayer({
              id: SHAKEMAP_WEB_DAMAGE_FILL_LAYER_ID,
              type: "fill",
              source: SHAKEMAP_WEB_DAMAGE_SOURCE_ID,
              layout: { visibility: "none" },
              paint: {
                "fill-color": buildLevelColorMatchExpression(colors.damageGrade, 5) as never,
                "fill-opacity": 0.55,
              },
            });
            map.addLayer({
              id: SHAKEMAP_WEB_DAMAGE_LINE_LAYER_ID,
              type: "line",
              source: SHAKEMAP_WEB_DAMAGE_SOURCE_ID,
              layout: { visibility: "none" },
              paint: {
                "line-color": buildLevelColorMatchExpression(colors.damageGrade, 5) as never,
                "line-width": 0.75,
                "line-opacity": 0.8,
              },
            });
          }

          const markerEl = document.createElement("div");
          markerEl.innerHTML = buildStarMarkerSvgMarkup(
            EPICENTER_MARKER_SIZE_PX,
            colors.status.danger,
            colors.surface.base,
          );
          const markerInstance = new maplibre.Marker({
            element: markerEl,
            anchor: "center",
          })
            .setLngLat([epicenter.lon, epicenter.lat])
            .addTo(map);
          epicenterMarkerRef.current = markerInstance;

          const bbox = computeContourBoundingBox(contours.levels, [
            [epicenter.lon, epicenter.lat],
          ]);
          map.fitBounds(contourBoundsToLngLatBounds(bbox), {
            padding: MAP_FIT_BOUNDS_PADDING_PX,
            duration: 0,
          });

          setLoadState("ready");
        });

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
            epicenterMarkerRef.current?.remove();
            epicenterMarkerRef.current = null;
            mapRef.current?.remove();
            mapRef.current = null;
            creationStartedRef.current = false;
            setRetryTick((tick) => tick + 1);
            return;
          }
          // OpenFreeMap itself failed (or a repeat failure after the
          // one-shot fallback already ran) — the genuine "cannot show any
          // interactive map" case. Never a blank box: fall back to the
          // always-available SVG renderer instead of a visible error
          // state (this embedded widget has no separate offline-retry UI
          // of its own, unlike the full Map tab).
          epicenterMarkerRef.current?.remove();
          epicenterMarkerRef.current = null;
          mapRef.current?.remove();
          mapRef.current = null;
          setShowSvgFallback(true);
        });
      })
      .catch(() => {
        if (!cancelled) {
          setShowSvgFallback(true);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- creation-time-only inputs (scheme/contours/epicenter/colors), same convention `map.web.tsx`'s own creation effect documents; `retryTick` is the deliberate re-run trigger for the MapTiler->OpenFreeMap fallback, `showSvgFallback` guards re-entry once the ultimate fallback has fired
  }, [retryTick, showSvgFallback]);

  // Toggling the layer never rebuilds the sources — just flips which
  // fill+line pair is visible, same "cheap, instant" behavior the SVG
  // view's own re-render gives it.
  useEffect(() => {
    const map = mapRef.current;
    if (loadState !== "ready" || !map || !hasDamageLayer) {
      return;
    }
    const intensityVisibility = activeLayer === "intensity" ? "visible" : "none";
    const damageVisibility = activeLayer === "damage" ? "visible" : "none";
    map.setLayoutProperty(SHAKEMAP_WEB_INTENSITY_FILL_LAYER_ID, "visibility", intensityVisibility);
    map.setLayoutProperty(SHAKEMAP_WEB_INTENSITY_LINE_LAYER_ID, "visibility", intensityVisibility);
    map.setLayoutProperty(SHAKEMAP_WEB_DAMAGE_FILL_LAYER_ID, "visibility", damageVisibility);
    map.setLayoutProperty(SHAKEMAP_WEB_DAMAGE_LINE_LAYER_ID, "visibility", damageVisibility);
  }, [activeLayer, hasDamageLayer, loadState]);

  // Teardown on unmount.
  useEffect(() => {
    return () => {
      epicenterMarkerRef.current?.remove();
      mapRef.current?.remove();
    };
  }, []);

  if (showSvgFallback) {
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
          level: highestLevel ? INTENSITY_ROMAN_NUMERALS[highestLevel.level] : "",
          place: placeText,
        });

  return (
    <View style={{ gap: spacing[2] }} onLayout={handleLayout}>
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
        accessible
        accessibilityRole="image"
        accessibilityLabel={mapA11yLabel}
        style={[
          styles.mapContainer,
          {
            height: heightForWidth(measuredWidth),
            direction: "ltr",
            backgroundColor: colors.surface.sunken,
          },
        ]}
      >
        {/* Web-only file (Metro platform resolution keeps this out of
         * native bundles entirely) — MapLibre needs a real DOM node to
         * attach its canvas to, so this is a plain DOM element rather
         * than an RN View, same convention `map.web.tsx`'s own container
         * div uses. */}
        <div ref={containerRef} style={webMapContainerStyle} />
        {loadState !== "ready" ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator color={colors.text.secondary} />
          </View>
        ) : null}
      </View>

      <ShakeMapLegend
        layer={activeLayer}
        t={t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />
    </View>
  );
}

const webMapContainerStyle: Record<string, string> = {
  width: "100%",
  height: "100%",
};

const styles = StyleSheet.create({
  mapContainer: {
    width: "100%",
    borderRadius: 12,
    overflow: "hidden",
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
