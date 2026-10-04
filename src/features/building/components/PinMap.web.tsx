import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

// Imported from each submodule directly, never the `@/features/map` barrel:
// the barrel pulls in expo-router and the events feature, which is dead
// weight for an embedded map (and breaks under jsdom tests).
import { loadMapLibre } from "@/features/map/maplibre-loader";
import { useMapPreferencesStore } from "@/features/map/preferences-store";
import { resolveCatalogMapStyle } from "@/features/map/style-catalog";
import { getConfiguredMapTilerKey } from "@/features/map/style-provider";
import { useTheme } from "@/theme";
import type { PinMapProps } from "./PinMap";

const HEIGHT = 320;

/** The pin map is available on web (MapLibre GL JS). */
export const PIN_MAP_AVAILABLE = true;

/**
 * Tap to place, drag to adjust. Same basemap stack as the Map tab. The map
 * is built once per basemap/scheme; the pin starts at `start` and every
 * change is reported through `onPoint`. The parent decides when to confirm.
 */
export function PinMap({ start, onPoint, accessibilityLabel }: PinMapProps) {
  const { i18n } = useTranslation();
  const { colors, scheme } = useTheme();
  const styleId = useMapPreferencesStore((state) => state.styleId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onPointRef = useRef(onPoint);
  useEffect(() => {
    onPointRef.current = onPoint;
  }, [onPoint]);
  const startRef = useRef(start);
  // The pin survives a basemap switch: the rebuilt map starts where it was.
  const lastPointRef = useRef<{ lat: number; lon: number } | null>(null);
  const pinColorRef = useRef(colors.status.danger);
  useEffect(() => {
    pinColorRef.current = colors.status.danger;
  }, [colors.status.danger]);

  useEffect(() => {
    let cancelled = false;
    let removeMap: (() => void) | null = null;
    const { url } = resolveCatalogMapStyle(styleId, scheme, getConfiguredMapTilerKey());
    void loadMapLibre().then((maplibre) => {
      if (cancelled || !containerRef.current) return;
      const origin = { ...startRef.current, ...lastPointRef.current };
      const map = new maplibre.Map({
        container: containerRef.current,
        style: url,
        center: [origin.lon, origin.lat],
        zoom: origin.zoom,
        attributionControl: false,
      });
      map.addControl(new maplibre.AttributionControl({ compact: true }));
      map.addControl(new maplibre.NavigationControl({ showCompass: false }));
      const marker = new maplibre.Marker({
        draggable: true,
        color: pinColorRef.current,
      })
        .setLngLat([origin.lon, origin.lat])
        .addTo(map);
      marker.on("dragend", () => {
        const { lat, lng } = marker.getLngLat();
        lastPointRef.current = { lat, lon: lng };
        onPointRef.current({ lat, lon: lng });
      });
      map.on("click", (event) => {
        marker.setLngLat(event.lngLat);
        lastPointRef.current = { lat: event.lngLat.lat, lon: event.lngLat.lng };
        onPointRef.current({ lat: event.lngLat.lat, lon: event.lngLat.lng });
      });
      map.on("load", () => {
        map
          .getContainer()
          .querySelector("details.maplibregl-ctrl-attrib")
          ?.removeAttribute("open");
      });
      removeMap = () => map.remove();
    });
    return () => {
      cancelled = true;
      removeMap?.();
    };
    // Rebuilt only when the basemap changes; the pin lives inside the map.
  }, [styleId, scheme, i18n.language]);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[styles.container, { borderColor: colors.border.subtle, direction: "ltr" }]}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: HEIGHT,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
});
