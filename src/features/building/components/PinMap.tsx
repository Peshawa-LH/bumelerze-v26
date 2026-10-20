import { useCallback, useRef, useState } from "react";
import { StyleSheet, View, type NativeSyntheticEvent } from "react-native";
import { useTranslation } from "react-i18next";

// Deep imports only: the `@/features/map` index also exports the web's
// maplibre-gl loader, which must never reach the native bundle.
import { NativeMapCredits } from "@/features/map/components/NativeMapCredits";
import { NativeMapPin } from "@/features/map/components/NativeMapPin";
import { NativeMapZoomControls } from "@/features/map/components/NativeMapZoomControls";
import { loadNativeMapLibre } from "@/features/map/native-maplibre";
import { useMapPreferencesStore } from "@/features/map/preferences-store";
import { useNativeBasemap } from "@/features/map/use-native-basemap";
import { useTheme } from "@/theme";
import type { PinPoint, PinStart } from "../pin";

export interface PinMapProps {
  /** Where the pin and the map start. */
  start: PinStart;
  /** Called whenever the user taps the map or finishes dragging the pin. */
  onPoint: (point: PinPoint) => void;
  accessibilityLabel: string;
}

type MapRef = import("@maplibre/maplibre-react-native").MapRef;
type CameraRef = import("@maplibre/maplibre-react-native").CameraRef;
type PressEvent = import("@maplibre/maplibre-react-native").PressEvent;
type ViewAnnotationEvent = import("@maplibre/maplibre-react-native").ViewAnnotationEvent;

const HEIGHT = 320;
/** The pin's tip sits 6 pt above the bottom of its 41 pt drawing. */
const PIN_TIP_OFFSET: [number, number] = [0, 6];

/** iOS/Android offer "Place on map" when MapLibre's native code is in the
 * build (not in Expo Go); the location step keeps "Use my location" and
 * the town list either way. */
export const PIN_MAP_AVAILABLE = loadNativeMapLibre() !== null;

/**
 * Tap to place, drag to adjust, on the saved basemap style: the native twin
 * of `PinMap.web.tsx` on MapLibre Native. The pin starts at `start`, every
 * change goes out through `onPoint`, and the parent decides when to
 * confirm. A one-finger drag pans the map, as on the web.
 */
export function PinMap({ start, onPoint, accessibilityLabel }: PinMapProps) {
  const { i18n } = useTranslation();
  const { colors, scheme } = useTheme();
  const styleId = useMapPreferencesStore((state) => state.styleId);
  const hasHydrated = useMapPreferencesStore((state) => state.hasHydrated);
  const [mapLibre] = useState(loadNativeMapLibre);
  const [point, setPoint] = useState<PinPoint>({ lat: start.lat, lon: start.lon });
  // The first view only: a later pin move must not re-centre the camera.
  const [initialView] = useState(() => ({
    center: [start.lon, start.lat] as [number, number],
    zoom: start.zoom,
  }));
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);

  const basemap = useNativeBasemap({
    styleId,
    scheme,
    locale: i18n.language,
    terrain: false,
    localizeLabels: false,
    enabled: hasHydrated,
  });

  const place = useCallback(
    (next: PinPoint) => {
      setPoint(next);
      onPoint(next);
    },
    [onPoint],
  );

  const handleMapPress = useCallback(
    (event: NativeSyntheticEvent<PressEvent>) => {
      const [lon, lat] = event.nativeEvent.lngLat;
      place({ lat, lon });
    },
    [place],
  );

  const handleDragEnd = useCallback(
    (event: NativeSyntheticEvent<ViewAnnotationEvent>) => {
      const [lon, lat] = event.nativeEvent.lngLat;
      place({ lat, lon });
    },
    [place],
  );

  const zoomBy = useCallback(async (delta: number) => {
    const zoom = await mapRef.current?.getZoom().catch(() => null);
    if (typeof zoom === "number")
      cameraRef.current?.zoomTo(zoom + delta, { duration: 200 });
  }, []);

  if (!mapLibre) return null;
  const { Map: MapView, Camera, ViewAnnotation } = mapLibre;

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
            testID="pin-map-native"
            style={styles.map}
            mapStyle={basemap.mapStyle as string}
            logo={false}
            attribution={false}
            compass={false}
            onPress={handleMapPress}
            onDidFinishLoadingMap={basemap.onDidFinishLoadingMap}
            onDidFailLoadingMap={basemap.onDidFailLoadingMap}
          >
            <Camera ref={cameraRef} initialViewState={initialView} />
            <ViewAnnotation
              id="bumelerze-building-pin"
              lngLat={[point.lon, point.lat]}
              anchor="bottom"
              offset={PIN_TIP_OFFSET}
              draggable
              onDragEnd={handleDragEnd}
            >
              <NativeMapPin color={colors.status.danger} />
            </ViewAnnotation>
          </MapView>
        ) : null}
      </View>
      {basemap.phase === "ready" ? (
        <>
          <NativeMapZoomControls
            onZoomIn={() => void zoomBy(1)}
            onZoomOut={() => void zoomBy(-1)}
          />
          <NativeMapCredits
            provider={basemap.provider}
            onShowCredits={() => {
              mapRef.current?.showAttribution().catch(() => undefined);
            }}
          />
        </>
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
