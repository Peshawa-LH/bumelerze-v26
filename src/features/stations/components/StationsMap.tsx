import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, View, type NativeSyntheticEvent } from "react-native";
import { useTranslation } from "react-i18next";

// Deep imports only: the `@/features/map` index also exports the web's
// maplibre-gl loader, which must never reach the native bundle.
import { NativeMapCredits } from "@/features/map/components/NativeMapCredits";
import { loadNativeMapLibre } from "@/features/map/native-maplibre";
import { useMapPreferencesStore } from "@/features/map/preferences-store";
import { useNativeBasemap } from "@/features/map/use-native-basemap";
import { useTheme } from "@/theme";
import { stationIconDataUri } from "../station-icon";
import type { LiveStation, StationFreshness } from "../types";
import { freshnessColor } from "./colors";

export interface StationsMapProps {
  stations: LiveStation[];
  /** Freshness per station id (queries.ts `useStationFreshness`). */
  tiers: Record<string, StationFreshness>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  accessibilityLabel: string;
}

type MapRef = import("@maplibre/maplibre-react-native").MapRef;
type LayerProps = import("@maplibre/maplibre-react-native").LayerProps;
type PressEventWithFeatures =
  import("@maplibre/maplibre-react-native").PressEventWithFeatures;

const SOURCE_ID = "bumelerze-stations";
const LAYER_ID = "bumelerze-stations-dots";
const HALO_ID = "bumelerze-stations-halo";
const HEIGHT = 320;
const TIERS: readonly StationFreshness[] = ["live", "recent", "silent", "unknown"];
/** The web draws the 36 px triangle at pixel ratio 2. */
const ICON_SCALE = 2;
const STATION_HITBOX = { top: 22, right: 22, bottom: 22, left: 22 };

/** The stations as one GeoJSON collection (the web's `toFeatureCollection`). */
export function toStationFeatureCollection(
  stations: readonly LiveStation[],
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

const LAYERS = [
  {
    id: HALO_ID,
    type: "symbol",
    filter: ["==", ["get", "selected"], true],
    layout: {
      "icon-image": ["concat", "station-", ["get", "tier"]],
      "icon-size": 2.2,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: { "icon-opacity": 0.25 },
  },
  {
    id: LAYER_ID,
    type: "symbol",
    layout: {
      "icon-image": ["concat", "station-", ["get", "tier"]],
      "icon-size": ["case", ["get", "selected"], 1.35, 1],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  },
] as unknown as LayerProps[];

/**
 * The station map on MapLibre Native (iOS/Android), the twin of
 * `StationsMap.web.tsx`: the saved basemap style, the seismologist's
 * triangle per station coloured by freshness (selected one larger, with a
 * soft halo), tap a station to select it. Fitted to the stations with half
 * a degree to spare, as on the web.
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
  const hasHydrated = useMapPreferencesStore((state) => state.hasHydrated);
  const [mapLibre] = useState(loadNativeMapLibre);
  const mapRef = useRef<MapRef>(null);

  const basemap = useNativeBasemap({
    styleId,
    scheme,
    locale: i18n.language,
    terrain: false,
    localizeLabels: false,
    enabled: hasHydrated,
  });

  const data = useMemo(
    () => toStationFeatureCollection(stations, tiers, selectedId),
    [stations, tiers, selectedId],
  );
  const images = useMemo(
    () =>
      Object.fromEntries(
        TIERS.map((tier) => [
          `station-${tier}`,
          {
            source: {
              uri: stationIconDataUri(freshnessColor(colors, tier)),
              scale: ICON_SCALE,
            },
          },
        ]),
      ),
    [colors],
  );
  // The first view only (the web builds its map once per style).
  const [initialView] = useState(() => {
    const lons = stations.map((s) => s.lon);
    const lats = stations.map((s) => s.lat);
    return {
      bounds: [
        Math.min(...lons) - 0.5,
        Math.min(...lats) - 0.5,
        Math.max(...lons) + 0.5,
        Math.max(...lats) + 0.5,
      ] as [number, number, number, number],
      padding: { top: 24, right: 24, bottom: 24, left: 24 },
    };
  });

  const handlePress = useCallback(
    (event: NativeSyntheticEvent<PressEventWithFeatures>) => {
      event.stopPropagation();
      const id = event.nativeEvent.features[0]?.properties?.id;
      if (typeof id === "string") onSelect(id);
    },
    [onSelect],
  );

  if (!mapLibre || stations.length === 0) return null;
  const { Map: MapView, Camera, GeoJSONSource, Images, Layer } = mapLibre;

  return (
    <View style={[styles.container, { borderColor: colors.border.subtle }]}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={StyleSheet.absoluteFill}
      >
        {basemap.mapStyle !== null && basemap.phase !== "error" ? (
          <MapView
            key={basemap.mapKey}
            ref={mapRef}
            testID="stations-map-native"
            style={styles.map}
            mapStyle={basemap.mapStyle as string}
            logo={false}
            attribution={false}
            compass={false}
            onDidFinishLoadingMap={basemap.onDidFinishLoadingMap}
            onDidFailLoadingMap={basemap.onDidFailLoadingMap}
          >
            <Camera initialViewState={initialView} />
            <Images images={images} />
            <GeoJSONSource
              id={SOURCE_ID}
              data={data}
              hitbox={STATION_HITBOX}
              onPress={handlePress}
            >
              {LAYERS.map((layer) => (
                <Layer key={String(layer.id)} {...layer} />
              ))}
            </GeoJSONSource>
          </MapView>
        ) : null}
      </View>
      {basemap.phase === "ready" ? (
        <NativeMapCredits
          provider={basemap.provider}
          onShowCredits={() => {
            mapRef.current?.showAttribution().catch(() => undefined);
          }}
        />
      ) : null}
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
  map: {
    flex: 1,
  },
});
