import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  I18nManager,
  Pressable,
  StyleSheet,
  Text,
  TurboModuleRegistry,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyStateScreen } from "@/components/EmptyStateScreen";
import { REGION_BBOX } from "@/features/events/config";
import { MapTilerAttributionLogo } from "@/features/map/components/MapTilerAttributionLogo";
import { MAP_FIT_BOUNDS_PADDING_PX } from "@/features/map/config";
import { useMapPreferencesStore } from "@/features/map/preferences-store";
import { resolveCatalogMapStyle } from "@/features/map/style-catalog";
import { decideMapErrorAction, getConfiguredMapTilerKey } from "@/features/map/style-provider";
import { useTheme } from "@/theme";

/**
 * Native (iOS/Android) Map tab: a MapLibre Native map. Metro's platform
 * extensions keep the two maps apart: the web bundles `map.web.tsx`
 * (maplibre-gl) and never sees this file, so `@maplibre/maplibre-react-native`
 * never reaches the web bundle.
 *
 * First slice of the native map: the basemap only, from the SAME style
 * logic as the web (`resolveCatalogMapStyle` with the saved style choice and
 * the colour scheme, MapTiler with the configured key, the one-time
 * OpenFreeMap fallback of `decideMapErrorAction`), opening on the same view
 * (the region bounds with the same padding). No layers, markers or controls
 * yet.
 *
 * Expo Go and any other build without MapLibre's native code keep the
 * translated "needs a full app installation" state instead of crashing.
 */

type MapLibreModule = typeof import("@maplibre/maplibre-react-native");

/** MapLibre's map module as registered by a build with its native code. */
const MAPLIBRE_NATIVE_MODULE_NAME = "MLRNMapViewModule";

/** `@maplibre/maplibre-react-native`, or null where its native code is not in
 * this build (Expo Go). Its modules look themselves up with `getEnforcing`
 * the moment they are imported, which throws where the native side is
 * missing, so the import has to stay behind this check. */
function loadNativeMapLibre(): MapLibreModule | null {
  try {
    if (TurboModuleRegistry.get(MAPLIBRE_NATIVE_MODULE_NAME) == null) {
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must stay behind the native-module check above
    return require("@maplibre/maplibre-react-native") as MapLibreModule;
  } catch {
    return null;
  }
}

/** The web map's first view: the region bounds (west, south, east, north)
 * with `MAP_FIT_BOUNDS_PADDING_PX` on every side. */
const INITIAL_VIEW = {
  bounds: [REGION_BBOX.minLon, REGION_BBOX.minLat, REGION_BBOX.maxLon, REGION_BBOX.maxLat] as [
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

type LoadState = "loading" | "ready" | "error";

const ORNAMENT_INSET_PX = 8;

export default function MapScreen() {
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
  return <NativeMap mapLibre={mapLibre} />;
}

function NativeMap({ mapLibre }: { mapLibre: MapLibreModule }) {
  const { Map, Camera } = mapLibre;
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors, scheme, spacing, typography } = useTheme();
  const styleId = useMapPreferencesStore((state) => state.styleId);
  const hasStyleHydrated = useMapPreferencesStore((state) => state.hasHydrated);

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [fellBack, setFellBack] = useState(false);
  // A new value re-creates the native map (Retry, and the fallback swap).
  const [mapKey, setMapKey] = useState(0);

  const style = useMemo(
    () =>
      resolveCatalogMapStyle(
        styleId,
        scheme,
        getConfiguredMapTilerKey(),
        fellBack ? "openfreemap" : undefined,
      ),
    [styleId, scheme, fellBack],
  );

  const handleLoaded = useCallback(() => setLoadState("ready"), []);

  const handleFailed = useCallback(() => {
    const action = decideMapErrorAction({
      provider: style.provider,
      hasReachedReady: loadState === "ready",
      alreadyFellBack: fellBack,
    });
    if (action === "fallback-to-openfreemap") {
      setFellBack(true);
      setLoadState("loading");
      setMapKey((key) => key + 1);
      return;
    }
    setLoadState("error");
  }, [style.provider, loadState, fellBack]);

  const handleRetry = useCallback(() => {
    setFellBack(false);
    setLoadState("loading");
    setMapKey((key) => key + 1);
  }, []);

  // MapLibre places its ornaments by physical side: the attribution button
  // sits at the reading start, the MapTiler logo at the reading end.
  const attributionPosition = I18nManager.isRTL
    ? { bottom: ORNAMENT_INSET_PX, right: ORNAMENT_INSET_PX }
    : { bottom: ORNAMENT_INSET_PX, left: ORNAMENT_INSET_PX };

  return (
    <View
      style={[styles.container, { backgroundColor: colors.surface.base, paddingTop: insets.top }]}
    >
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: typography.h2.fontSize,
          lineHeight: typography.h2.lineHeight,
          fontWeight: typography.h2.fontWeight,
          paddingHorizontal: spacing[4],
          paddingBottom: spacing[2],
        }}
      >
        {t("map.title")}
      </Text>

      <View style={styles.mapArea}>
        {hasStyleHydrated && loadState !== "error" ? (
          <Map
            key={mapKey}
            testID="native-map"
            style={styles.map}
            mapStyle={style.url}
            logo={false}
            attribution
            attributionPosition={attributionPosition}
            onDidFinishLoadingMap={handleLoaded}
            onDidFailLoadingMap={handleFailed}
          >
            <Camera initialViewState={INITIAL_VIEW} />
          </Map>
        ) : null}

        {loadState === "ready" && style.provider === "maptiler" ? (
          <View style={styles.attributionLogo} pointerEvents="box-none">
            <MapTilerAttributionLogo />
          </View>
        ) : null}

        {loadState === "error" ? (
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
                <Ionicons name="cloud-offline-outline" size={16} color={colors.text.secondary} />
                <Text
                  style={{
                    color: colors.text.primary,
                    fontSize: typography.bodyDefault.fontSize,
                    lineHeight: typography.bodyDefault.lineHeight,
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
                }}
              >
                {t("map.offlineDescription")}
              </Text>
              <Pressable accessibilityRole="button" onPress={handleRetry} style={styles.retry}>
                <Text
                  style={{
                    color: colors.text.link,
                    fontSize: typography.bodyMeta.fontSize,
                    fontWeight: "600",
                  }}
                >
                  {t("map.retry")}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {loadState === "loading" ? (
          <View
            style={[styles.overlay, styles.centered, { backgroundColor: colors.surface.base }]}
            pointerEvents="none"
          >
            <ActivityIndicator color={colors.brand.primary} />
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.bodyMeta.fontSize,
                lineHeight: typography.bodyMeta.lineHeight,
                marginTop: spacing[2],
              }}
            >
              {t("map.loading")}
            </Text>
          </View>
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
  attributionLogo: {
    position: "absolute",
    bottom: ORNAMENT_INSET_PX,
    end: ORNAMENT_INSET_PX,
  },
});
