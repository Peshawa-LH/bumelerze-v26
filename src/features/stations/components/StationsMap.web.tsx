import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  getConfiguredMapTilerKey,
  loadMapLibre,
  resolveCatalogMapStyle,
  useMapPreferencesStore,
} from "@/features/map";
import { useTheme } from "@/theme";
import { freshnessFromCatalog } from "../freshness";
import type { LiveStation, StationFreshness } from "../types";
import { freshnessColor } from "./colors";
import type { StationsMapProps } from "./StationsMap";

const SOURCE_ID = "bumelerze-stations";
const LAYER_ID = "bumelerze-stations-dots";
const HALO_ID = "bumelerze-stations-halo";
const HEIGHT = 320;

function toFeatureCollection(
  stations: LiveStation[],
  selectedId: string | null,
  colorOf: (tier: StationFreshness) => string,
  now: number,
) {
  return {
    type: "FeatureCollection" as const,
    features: stations.map((station) => ({
      type: "Feature" as const,
      id: station.id,
      properties: {
        id: station.id,
        color: colorOf(freshnessFromCatalog(station.lastSeenAt, now)),
        selected: station.id === selectedId,
      },
      geometry: { type: "Point" as const, coordinates: [station.lon, station.lat] },
    })),
  };
}

/**
 * The station map (web): the same basemap stack as the Map tab, one
 * GeoJSON source, a halo + dot layer coloured by freshness, tap to select.
 * Built once per style/scheme; stations and selection update in place
 * through `setData`.
 */
export function StationsMap({
  stations,
  selectedId,
  onSelect,
  accessibilityLabel,
}: StationsMapProps) {
  const { i18n } = useTranslation();
  const { colors, scheme } = useTheme();
  const styleId = useMapPreferencesStore((state) => state.styleId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // One clock reading per mount: the catalogue's build-time sighting is
  // hours old at best, so a fresh reading per render would only make the
  // render impure without changing a colour.
  const [now] = useState(() => Date.now());
  const data = useMemo(
    () =>
      toFeatureCollection(
        stations,
        selectedId,
        (tier) => freshnessColor(colors, tier),
        now,
      ),
    [stations, selectedId, colors, now],
  );
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
    const source = mapRef.current?.getSource(SOURCE_ID) as
      { setData?: (next: unknown) => void } | undefined;
    source?.setData?.(data);
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    const { url } = resolveCatalogMapStyle(styleId, scheme, getConfiguredMapTilerKey());
    void loadMapLibre().then((maplibre) => {
      if (cancelled || !containerRef.current) return;
      const lons = stations.map((s) => s.lon);
      const lats = stations.map((s) => s.lat);
      const map = new maplibre.Map({
        container: containerRef.current,
        style: url,
        bounds: [
          [Math.min(...lons) - 0.5, Math.min(...lats) - 0.5],
          [Math.max(...lons) + 0.5, Math.max(...lats) + 0.5],
        ],
        fitBoundsOptions: { padding: 24 },
        attributionControl: false,
      });
      mapRef.current = map;
      map.addControl(new maplibre.AttributionControl({ compact: true }));
      map.on("load", () => {
        map.addSource(SOURCE_ID, { type: "geojson", data: dataRef.current });
        map.addLayer({
          id: HALO_ID,
          type: "circle",
          source: SOURCE_ID,
          paint: {
            "circle-radius": ["case", ["get", "selected"], 16, 10],
            "circle-color": ["get", "color"],
            "circle-opacity": 0.25,
          },
        });
        map.addLayer({
          id: LAYER_ID,
          type: "circle",
          source: SOURCE_ID,
          paint: {
            "circle-radius": ["case", ["get", "selected"], 8, 5],
            "circle-color": ["get", "color"],
            "circle-stroke-color": "#FFFFFF",
            "circle-stroke-width": 1.5,
          },
        });
        map.on("click", LAYER_ID, (event) => {
          const id = event.features?.[0]?.properties?.id;
          if (typeof id === "string") onSelectRef.current(id);
        });
        map.on("mouseenter", LAYER_ID, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", LAYER_ID, () => {
          map.getCanvas().style.cursor = "";
        });
        map
          .getContainer()
          .querySelector("details.maplibregl-ctrl-attrib")
          ?.removeAttribute("open");
      });
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Rebuilt only when the basemap changes; stations flow through setData.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
