import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  getConfiguredMapTilerKey,
  loadMapLibre,
  resolveCatalogMapStyle,
  useMapPreferencesStore,
} from "@/features/map";
import { useTheme } from "@/theme";
import type { LiveStation, StationFreshness } from "../types";
import { freshnessColor } from "./colors";
import type { StationsMapProps } from "./StationsMap";

const SOURCE_ID = "bumelerze-stations";
const LAYER_ID = "bumelerze-stations-dots";
const HALO_ID = "bumelerze-stations-halo";
const HEIGHT = 320;

const TIERS: readonly StationFreshness[] = ["live", "recent", "silent", "unknown"];
const ICON_PX = 36;

/**
 * A filled triangle with a white outline — the seismologist's station
 * symbol (owner, 2026-09-27) — as an image MapLibre can place; one per
 * tier colour, drawn on a canvas at load. No SDF: exact colours, no
 * distance-field softness at small sizes.
 */
function drawTriangle(color: string): ImageData | null {
  const canvas = document.createElement("canvas");
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const inset = 4;
  ctx.beginPath();
  ctx.moveTo(ICON_PX / 2, inset);
  ctx.lineTo(ICON_PX - inset, ICON_PX - inset);
  ctx.lineTo(inset, ICON_PX - inset);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#FFFFFF";
  ctx.stroke();
  return ctx.getImageData(0, 0, ICON_PX, ICON_PX);
}

function toFeatureCollection(
  stations: LiveStation[],
  tiers: Record<string, StationFreshness>,
  selectedId: string | null,
) {
  return {
    type: "FeatureCollection" as const,
    features: stations.map((station) => ({
      type: "Feature" as const,
      id: station.id,
      properties: {
        id: station.id,
        tier: tiers[station.id] ?? "unknown",
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
  tiers,
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

  const data = useMemo(
    () => toFeatureCollection(stations, tiers, selectedId),
    [stations, tiers, selectedId],
  );
  const colorsRef = useRef(colors);
  useEffect(() => {
    colorsRef.current = colors;
  }, [colors]);
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
        for (const tier of TIERS) {
          const image = drawTriangle(freshnessColor(colorsRef.current, tier));
          if (image && !map.hasImage(`station-${tier}`)) {
            map.addImage(`station-${tier}`, image, { pixelRatio: 2 });
          }
        }
        map.addSource(SOURCE_ID, { type: "geojson", data: dataRef.current });
        map.addLayer({
          id: HALO_ID,
          type: "symbol",
          source: SOURCE_ID,
          filter: ["==", ["get", "selected"], true],
          layout: {
            "icon-image": ["concat", "station-", ["get", "tier"]],
            "icon-size": 2.2,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: { "icon-opacity": 0.25 },
        });
        map.addLayer({
          id: LAYER_ID,
          type: "symbol",
          source: SOURCE_ID,
          layout: {
            "icon-image": ["concat", "station-", ["get", "tier"]],
            "icon-size": ["case", ["get", "selected"], 1.35, 1],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
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
