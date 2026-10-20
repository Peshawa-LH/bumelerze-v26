import { useCallback, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { REGION_BBOX } from "@/features/events/config";
// Deep imports only: the `@/features/map` index also exports the web's
// maplibre-gl loader, which must never reach the native bundle.
import { NativeMapCredits } from "@/features/map/components/NativeMapCredits";
import { NativeMapPin } from "@/features/map/components/NativeMapPin";
import { NativeMapZoomControls } from "@/features/map/components/NativeMapZoomControls";
import { MAP_FIT_BOUNDS_PADDING_PX } from "@/features/map/config";
import { loadNativeMapLibre, type MapLibreModule } from "@/features/map/native-maplibre";
import { useNativeBasemap } from "@/features/map/use-native-basemap";
import { formatFixedLocalized } from "@/lib/format-numbers";
import { useTheme, READING_START } from "@/theme";

export interface MapCoordinatePickerProps {
  /** Current coordinate parsed from the form's own text fields, or `null`
   * if they're empty/invalid — becomes the map's initial centre and pin
   * (Kurdistan is the fallback view otherwise, via `REGION_BBOX`). */
  initialLat: number | null;
  initialLon: number | null;
  /** Fires once the engineer confirms a point picked on the map — same
   * contract as the place search's `onSelect`: hands back a coordinate,
   * does not itself submit or look anything up. */
  onSelect: (lat: number, lon: number) => void;
}

type MapRef = import("@maplibre/maplibre-react-native").MapRef;
type CameraRef = import("@maplibre/maplibre-react-native").CameraRef;
type PressEvent = import("@maplibre/maplibre-react-native").PressEvent;
type ViewAnnotationEvent = import("@maplibre/maplibre-react-native").ViewAnnotationEvent;

/** The web's zoom when the map opens on an entered coordinate. */
const INITIAL_POINT_ZOOM = 10;
/** The pin's tip sits 6 pt above the bottom of its 41 pt drawing. */
const PIN_TIP_OFFSET: [number, number] = [0, 6];
const FIT_PADDING = {
  top: MAP_FIT_BOUNDS_PADDING_PX,
  right: MAP_FIT_BOUNDS_PADDING_PX,
  bottom: MAP_FIT_BOUNDS_PADDING_PX,
  left: MAP_FIT_BOUNDS_PADDING_PX,
};

/**
 * "Pick on the map" (iOS/Android), the twin of the web's
 * `MapCoordinatePicker.web.tsx`: a full-screen sheet with a bare basemap,
 * tap to drop a pin or drag it, a live coordinate read-out, then "Use this
 * location", which fills the form's fields like the place search does.
 * Absent (as before) in a build without MapLibre's native code (Expo Go);
 * the form keeps manual entry, "use my location" and the town search.
 */
export function MapCoordinatePicker(props: MapCoordinatePickerProps) {
  const [mapLibre] = useState(loadNativeMapLibre);
  if (!mapLibre) return null;
  return <NativeMapCoordinatePicker mapLibre={mapLibre} {...props} />;
}

function NativeMapCoordinatePicker({
  mapLibre,
  initialLat,
  initialLon,
  onSelect,
}: MapCoordinatePickerProps & { mapLibre: MapLibreModule }) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<{ lat: number; lon: number } | null>(null);

  function handleOpen() {
    setSelected(
      initialLat !== null && initialLon !== null
        ? { lat: initialLat, lon: initialLon }
        : null,
    );
    setIsOpen(true);
  }

  function handleConfirm() {
    if (!selected) return;
    onSelect(selected.lat, selected.lon);
    setIsOpen(false);
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={handleOpen}
        style={styles.openButton}
      >
        <Text
          style={{
            color: colors.text.link,
            fontSize: typography.labelButton.fontSize,
            fontWeight: typography.labelButton.fontWeight,
            fontFamily: typography.labelButton.fontFamily,
            ...READING_START,
          }}
        >
          {t("handbook.coordinates.pickOnMap")}
        </Text>
      </Pressable>

      <Modal
        visible={isOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setIsOpen(false)}
      >
        {isOpen ? (
          <View
            style={[
              styles.screen,
              { backgroundColor: colors.surface.base, paddingTop: insets.top },
            ]}
          >
            <View
              style={[
                styles.headerRow,
                { paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
              ]}
            >
              <Text
                accessibilityRole="header"
                style={{
                  flexShrink: 1,
                  color: colors.text.primary,
                  fontSize: typography.h3.fontSize,
                  lineHeight: typography.h3.lineHeight,
                  fontWeight: typography.h3.fontWeight,
                  fontFamily: typography.h3.fontFamily,
                  ...READING_START,
                }}
              >
                {t("handbook.coordinates.mapPickerTitle")}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("handbook.coordinates.mapPickerClose")}
                onPress={() => setIsOpen(false)}
                style={styles.closeButton}
              >
                <Text
                  style={{
                    color: colors.text.link,
                    fontSize: typography.labelButton.fontSize,
                    fontWeight: typography.labelButton.fontWeight,
                    fontFamily: typography.labelButton.fontFamily,
                    ...READING_START,
                  }}
                >
                  {t("handbook.coordinates.mapPickerClose")}
                </Text>
              </Pressable>
            </View>

            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.bodyMeta.fontSize,
                lineHeight: typography.bodyMeta.lineHeight,
                fontFamily: typography.bodyMeta.fontFamily,
                ...READING_START,
                paddingHorizontal: spacing[4],
                paddingBottom: spacing[2],
              }}
            >
              {t("handbook.coordinates.mapPickerHint")}
            </Text>

            <PickerMap
              mapLibre={mapLibre}
              initialLat={initialLat}
              initialLon={initialLon}
              selected={selected}
              onPick={setSelected}
            />

            <View
              style={[
                styles.footer,
                {
                  borderColor: colors.border.default,
                  backgroundColor: colors.surface.raised,
                  padding: spacing[4],
                  paddingBottom: insets.bottom + spacing[4],
                  gap: spacing[3],
                },
              ]}
            >
              <Text
                accessibilityLiveRegion="polite"
                style={{
                  color: selected ? colors.text.primary : colors.text.tertiary,
                  fontSize: typography.bodyDefault.fontSize,
                  fontFamily: typography.bodyDefault.fontFamily,
                  ...READING_START,
                }}
              >
                {selected
                  ? t("handbook.coordinates.mapPickerSelected", {
                      lat: formatFixedLocalized(selected.lat, 4, i18n.language),
                      lon: formatFixedLocalized(selected.lon, 4, i18n.language),
                    })
                  : t("handbook.coordinates.mapPickerNoSelection")}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !selected }}
                disabled={!selected}
                onPress={handleConfirm}
                style={[
                  styles.confirmButton,
                  {
                    backgroundColor: selected
                      ? colors.brand.primary
                      : colors.surface.sunken,
                    paddingVertical: spacing[3],
                  },
                ]}
              >
                <Text
                  style={{
                    color: selected ? colors.brand.onPrimary : colors.text.tertiary,
                    fontSize: typography.labelButton.fontSize,
                    fontWeight: typography.labelButton.fontWeight,
                    fontFamily: typography.labelButton.fontFamily,
                    ...READING_START,
                  }}
                >
                  {t("handbook.coordinates.mapPickerConfirm")}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </Modal>
    </>
  );
}

/** The picker's map: a bare basemap (no events, terrain or own labels; a
 * coordinate tool, not the Map tab), tap or drag the pin. */
function PickerMap({
  mapLibre,
  initialLat,
  initialLon,
  selected,
  onPick,
}: {
  mapLibre: MapLibreModule;
  initialLat: number | null;
  initialLon: number | null;
  selected: { lat: number; lon: number } | null;
  onPick: (point: { lat: number; lon: number }) => void;
}) {
  const { i18n } = useTranslation();
  const { colors, scheme } = useTheme();
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const basemap = useNativeBasemap({
    scheme,
    locale: i18n.language,
    terrain: false,
    localizeLabels: false,
  });
  // Opens on the entered coordinate, else on the region (read once).
  const [initialView] = useState(() =>
    initialLat !== null && initialLon !== null
      ? { center: [initialLon, initialLat] as [number, number], zoom: INITIAL_POINT_ZOOM }
      : {
          bounds: [
            REGION_BBOX.minLon,
            REGION_BBOX.minLat,
            REGION_BBOX.maxLon,
            REGION_BBOX.maxLat,
          ] as [number, number, number, number],
          padding: FIT_PADDING,
        },
  );

  const handlePress = useCallback(
    (event: NativeSyntheticEvent<PressEvent>) => {
      const [lon, lat] = event.nativeEvent.lngLat;
      onPick({ lat, lon });
    },
    [onPick],
  );
  const handleDragEnd = useCallback(
    (event: NativeSyntheticEvent<ViewAnnotationEvent>) => {
      const [lon, lat] = event.nativeEvent.lngLat;
      onPick({ lat, lon });
    },
    [onPick],
  );
  const zoomBy = useCallback(async (delta: number) => {
    const zoom = await mapRef.current?.getZoom().catch(() => null);
    if (typeof zoom === "number")
      cameraRef.current?.zoomTo(zoom + delta, { duration: 200 });
  }, []);

  const { Map: MapView, Camera, ViewAnnotation } = mapLibre;
  return (
    <View style={styles.mapArea}>
      {basemap.mapStyle !== null && basemap.phase !== "error" ? (
        <MapView
          key={basemap.mapKey}
          ref={mapRef}
          testID="coordinate-picker-map"
          style={styles.map}
          mapStyle={basemap.mapStyle as string}
          logo={false}
          attribution={false}
          compass={false}
          onPress={handlePress}
          onDidFinishLoadingMap={basemap.onDidFinishLoadingMap}
          onDidFailLoadingMap={basemap.onDidFailLoadingMap}
        >
          <Camera ref={cameraRef} initialViewState={initialView} />
          {selected ? (
            <ViewAnnotation
              id="bumelerze-handbook-pin"
              lngLat={[selected.lon, selected.lat]}
              anchor="bottom"
              offset={PIN_TIP_OFFSET}
              draggable
              onDragEnd={handleDragEnd}
            >
              <NativeMapPin color={colors.brand.primary} />
            </ViewAnnotation>
          ) : null}
        </MapView>
      ) : null}
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
  openButton: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  screen: {
    flex: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  closeButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  mapArea: {
    flex: 1,
    position: "relative",
  },
  map: {
    flex: 1,
  },
  footer: {
    borderTopWidth: 1,
  },
  confirmButton: {
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
});
