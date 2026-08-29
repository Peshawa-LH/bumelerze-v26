import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";

import { REGION_BBOX } from "@/features/events";
import {
  MAP_FIT_BOUNDS_PADDING_PX,
  MAP_RTL_TEXT_PLUGIN_URL,
  MAP_WORKER_URL,
  MapTilerAttributionLogo,
  regionBboxToLngLatBounds,
  resolveMapStyle,
  shouldRequestRTLTextPlugin,
  type MapStyleProviderId,
} from "@/features/map";
import { formatFixedLocalized } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

export interface MapCoordinatePickerProps {
  /** Current coordinate parsed from the form's own text fields, or `null`
   * if they're empty/invalid — becomes the map's initial center/marker
   * (Kurdistan is the fallback view otherwise, via `REGION_BBOX`). */
  initialLat: number | null;
  initialLon: number | null;
  /** Fires once the engineer confirms a point picked on the map — same
   * contract as `InlineTownPicker`'s `onSelectTown`: hands back a
   * coordinate, does not itself submit/look anything up. */
  onSelect: (lat: number, lon: number) => void;
}

/** Zoom level the map opens at when centered on an already-entered
 * coordinate — close enough to place a pin precisely, far enough to still
 * see surrounding towns for context. */
const INITIAL_POINT_ZOOM = 10;

/**
 * The real, MapLibre-backed picker (web only — see the platform-split
 * `.tsx` sibling's doc comment for why native gets nothing here instead of
 * a broken/placeholder button). Opens a full-screen modal with a bare
 * basemap — no event markers, terrain, or own-labels; this is a
 * coordinate tool, not the Map tab. Tapping the map, or dragging the pin
 * it drops, updates a numeric coordinate read-out; "Use this location"
 * hands that coordinate back to `CoordinateInputForm` exactly like
 * `InlineTownPicker.onSelectTown` does — fills the text fields, does not
 * submit — so the SAME `handleSubmit` → `lookupHandbookData` path every
 * other entry method already uses runs unchanged, including its honest
 * `handbook.outOfCoverage` empty-state for a point outside the bundled
 * Kurdistan/Iraq data (`HandbookResultTable.tsx`, `types.ts`'s
 * `HandbookLookupResult` doc comments) — there is no separate "outside
 * Kurdistan" check here, deliberately, so that state has exactly one
 * definition in the whole app.
 */
export function MapCoordinatePicker({
  initialLat,
  initialLon,
  onSelect,
}: MapCoordinatePickerProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing, scheme } = useTheme();
  const insets = useSafeAreaInsets();

  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<{ lat: number; lon: number } | null>(null);
  const [activeProvider, setActiveProvider] = useState<MapStyleProviderId>("openfreemap");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const maplibreModuleRef = useRef<typeof import("maplibre-gl") | null>(null);

  /** Creates the marker on first pick, or just moves it on every later tap
   * / drag — either way, updates the read-out state that both the numeric
   * label and "Use this location" (`handleConfirm`) read from. */
  function placeMarkerAt(lat: number, lon: number) {
    setSelected({ lat, lon });
    const maplibre = maplibreModuleRef.current;
    const map = mapRef.current;
    if (!maplibre || !map) {
      return;
    }
    if (markerRef.current) {
      markerRef.current.setLngLat([lon, lat]);
      return;
    }
    const marker = new maplibre.Marker({ draggable: true, color: colors.brand.primary })
      .setLngLat([lon, lat])
      .addTo(map);
    marker.on("dragend", () => {
      const lngLat = marker.getLngLat();
      setSelected({ lat: lngLat.lat, lon: lngLat.lng });
    });
    markerRef.current = marker;
  }

  // Map creation/teardown — a fresh map instance every time the modal
  // opens, torn down on close. Unlike the Map tab (`map.web.tsx`, one
  // instance kept alive for the whole session), this picker is opened
  // occasionally and briefly, so paying MapLibre's construction cost again
  // per open is the better trade against holding a second live map/worker
  // pool in memory the entire time the handbook screen is open.
  useEffect(() => {
    if (!isOpen || !containerRef.current) {
      return;
    }
    let cancelled = false;
    const startLat = initialLat;
    const startLon = initialLon;

    import("maplibre-gl").then((maplibre) => {
      if (cancelled || !containerRef.current) {
        return;
      }
      maplibreModuleRef.current = maplibre;

      // Both must run before `new maplibre.Map(...)` below — the map reads
      // the worker URL and RTL plugin state once, at construction (see
      // `MAP_WORKER_URL`/`shouldRequestRTLTextPlugin`'s own doc comments,
      // `@/features/map`).
      maplibre.setWorkerUrl(MAP_WORKER_URL);
      if (shouldRequestRTLTextPlugin(maplibre.getRTLTextPluginStatus())) {
        maplibre.setRTLTextPlugin(MAP_RTL_TEXT_PLUGIN_URL, true).catch(() => {
          // Swallowed, same as `map.web.tsx`: a failed plugin fetch
          // degrades to unshaped Arabic-script basemap labels, not a
          // crash.
        });
      }

      const { provider, url } = resolveMapStyle(scheme);
      setActiveProvider(provider);

      // Built as two entirely separate option shapes (not one object with
      // `undefined`-valued optional keys) because `exactOptionalPropertyTypes`
      // (tsconfig) treats an explicit `center: undefined` as a real, invalid
      // value for `maplibre-gl`'s `LngLatLike` — the key must be OMITTED,
      // not present-but-undefined, whenever there's no starting point.
      const hasStartPoint = startLat !== null && startLon !== null;
      const map = hasStartPoint
        ? new maplibre.Map({
            container: containerRef.current,
            style: url,
            center: [startLon as number, startLat as number],
            zoom: INITIAL_POINT_ZOOM,
            attributionControl: false,
          })
        : new maplibre.Map({
            container: containerRef.current,
            style: url,
            bounds: regionBboxToLngLatBounds(REGION_BBOX),
            fitBoundsOptions: { padding: MAP_FIT_BOUNDS_PADDING_PX },
            attributionControl: false,
          });
      mapRef.current = map;
      // "REQUIRED: visible attribution... do not hide it" (config.ts's
      // `MAP_STYLE_URLS` doc comment) — same `compact: false` policy as the
      // Map tab, applied here too rather than only on the primary map
      // surface.
      map.addControl(new maplibre.AttributionControl({ compact: false }));
      // Physical corner, not a logical one: this positions MapLibre's OWN
      // on-canvas control, part of the map itself — the brief's "the map
      // itself must not mirror" applies here, unlike the surrounding
      // React Native layout this file also builds.
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");

      if (hasStartPoint) {
        placeMarkerAt(startLat as number, startLon as number);
      }

      map.on("click", (event) => {
        placeMarkerAt(event.lngLat.lat, event.lngLat.lng);
      });
    });

    return () => {
      cancelled = true;
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      maplibreModuleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `initialLat`/`initialLon`/`colors`/`scheme` are only read once at open/creation time here, same "read once at creation" reasoning `map.web.tsx`'s own creation effect documents against its own deps list; `isOpen` is the sole re-run trigger, since this effect recreates the whole map fresh on every open.
  }, [isOpen]);

  function handleOpen() {
    setSelected(
      initialLat !== null && initialLon !== null ? { lat: initialLat, lon: initialLon } : null,
    );
    setIsOpen(true);
  }

  function handleClose() {
    setIsOpen(false);
  }

  function handleConfirm() {
    if (!selected) {
      return;
    }
    onSelect(selected.lat, selected.lon);
    setIsOpen(false);
  }

  return (
    <>
      <Pressable accessibilityRole="button" onPress={handleOpen} hitSlop={8}>
        <Text
          style={{
            color: colors.text.link,
            fontSize: typography.labelButton.fontSize,
            fontWeight: typography.labelButton.fontWeight,
          }}
        >
          {t("handbook.coordinates.pickOnMap")}
        </Text>
      </Pressable>

      <Modal visible={isOpen} animationType="slide" onRequestClose={handleClose}>
        {isOpen ? (
          <View
            style={[styles.screen, { backgroundColor: colors.surface.base, paddingTop: insets.top }]}
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
                  color: colors.text.primary,
                  fontSize: typography.h3.fontSize,
                  lineHeight: typography.h3.lineHeight,
                  fontWeight: typography.h3.fontWeight,
                }}
              >
                {t("handbook.coordinates.mapPickerTitle")}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("handbook.coordinates.mapPickerClose")}
                onPress={handleClose}
                hitSlop={12}
                style={styles.closeButton}
              >
                <Text
                  style={{
                    color: colors.text.link,
                    fontSize: typography.labelButton.fontSize,
                    fontWeight: typography.labelButton.fontWeight,
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
                paddingHorizontal: spacing[4],
                paddingBottom: spacing[2],
              }}
            >
              {t("handbook.coordinates.mapPickerHint")}
            </Text>

            <View style={styles.mapArea}>
              <div ref={containerRef} style={mapContainerStyle} />
              {activeProvider === "maptiler" ? (
                <View style={styles.attributionLogo} pointerEvents="box-none">
                  <MapTilerAttributionLogo />
                </View>
              ) : null}
            </View>

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
                    backgroundColor: selected ? colors.brand.primary : colors.surface.sunken,
                    paddingVertical: spacing[3],
                  },
                ]}
              >
                <Text
                  style={{
                    color: selected ? colors.brand.onPrimary : colors.text.tertiary,
                    fontSize: typography.labelButton.fontSize,
                    fontWeight: typography.labelButton.fontWeight,
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

// A plain object (not `StyleSheet.create`, which react-native-web can't
// resolve for a raw DOM element) — same reasoning as `map.web.tsx`'s own
// `mapContainerStyle`: the map container needs to fill its parent for
// MapLibre's canvas to size correctly.
const mapContainerStyle: Record<string, string> = {
  width: "100%",
  height: "100%",
};

const styles = StyleSheet.create({
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
  attributionLogo: {
    position: "absolute",
    bottom: 0,
    end: 0,
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
