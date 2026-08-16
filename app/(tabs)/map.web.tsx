import "maplibre-gl/dist/maplibre-gl.css";

import { useFocusEffect, useRouter } from "expo-router";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import {
  formatMagnitudeValue,
  REGION_BBOX,
  useRegionEvents,
  type Event,
} from "@/features/events";
import { placeLine } from "@/features/geo";
import {
  buildRegionMarkers,
  MAP_FIT_BOUNDS_PADDING_PX,
  MAP_STYLE_URLS,
  MAP_WORKER_URL,
  MARKER_HIT_PADDING_PX,
  regionBboxToLngLatBounds,
} from "@/features/map";
import { useTheme } from "@/theme";

/**
 * Web Map tab — the real interactive map (wave brief: "web-first... the
 * deployed web build at bumelerze.netlify.app/app is the primary live
 * channel; the native MapLibre module waits for the dev-build workflow").
 *
 * Metro-only file: this `.web.tsx` platform-extension sibling of `map.tsx`
 * is the *only* module in the app that imports `maplibre-gl` — Metro's
 * platform resolver never even considers this file (or anything it
 * imports) when bundling for iOS/Android, so the dependency and its CSS
 * never reach a native bundle by construction, not just by a runtime
 * `Platform.OS` check. `maplibre-gl` itself is still loaded lazily via a
 * dynamic `import()` below (not a static top-of-file import) so its ~large
 * JS chunk only downloads once this tab is actually focused
 * (panic-time/low-bandwidth: never paid for by someone who never opens the
 * Map tab).
 *
 * Content this wave: circle-ish markers for the already-loaded region feed
 * (`useRegionEvents` — no new fetching), sized/colored by magnitude, tap →
 * event detail. No ShakeMap overlay, felt cells, or fault lines yet
 * (follow-up waves).
 */
export default function MapScreenWeb() {
  const { t, i18n } = useTranslation();
  const { colors, scheme, spacing, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { events } = useRegionEvents();

  // Kept as a ref (synced via effect, never written during render — the
  // React Compiler's react-hooks/refs rule forbids ref writes in render) so
  // each marker's click handler, created once when the marker is built,
  // always calls through to the LATEST router even though the closure
  // itself is never recreated on a router identity change.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreModuleRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markersRef = useRef<MapLibreMarker[]>([]);
  // Re-entrancy gate for the creation effect below — deliberately a ref,
  // not state: the effect itself calls `setLoadState("loading")`, and if
  // `loadState` were also in that effect's dependency array, that very
  // state update would immediately re-run (and tear down/cancel) the same
  // effect before its async `import()` ever resolved. `retryTick` is what
  // legitimately reruns it (`handleRetry` clears this flag first).
  const creationStartedRef = useRef(false);

  const [isFocused, setIsFocused] = useState(false);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [retryTick, setRetryTick] = useState(0);

  // "Map loads lazily when the tab is focused" (wave brief) — the mount
  // effect below only starts loading `maplibre-gl` once this becomes true.
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  // Creates the map exactly once, the first time the tab is focused. Not
  // re-run on scheme change — the style URL is only read at creation time
  // this wave (flipping OS theme mid-session won't hot-swap the basemap;
  // a small, deliberate scope cut, not a bug).
  useEffect(() => {
    if (!isFocused || creationStartedRef.current) {
      return;
    }
    if (!containerRef.current) {
      return;
    }

    creationStartedRef.current = true;
    let cancelled = false;
    setLoadState("loading");

    import("maplibre-gl")
      .then((module) => {
        if (cancelled || !containerRef.current) {
          return;
        }
        const maplibre = module;
        maplibreModuleRef.current = maplibre;

        // Must run before `new maplibre.Map(...)` below — the map reads
        // the worker URL once, at construction, when it spins up its
        // worker pool. See MAP_WORKER_URL's doc comment (config.ts) for
        // why this is required at all (maplibre-gl 6.x + Metro's web
        // bundler).
        maplibre.setWorkerUrl(MAP_WORKER_URL);

        const styleUrl = scheme === "dark" ? MAP_STYLE_URLS.dark : MAP_STYLE_URLS.light;
        const map = new maplibre.Map({
          container: containerRef.current,
          style: styleUrl,
          bounds: regionBboxToLngLatBounds(REGION_BBOX),
          fitBoundsOptions: { padding: MAP_FIT_BOUNDS_PADDING_PX },
          attributionControl: false,
        });
        // Assigned before `.on(...)` registration below (not after) so
        // `mapRef.current` is already populated for any handler that fires
        // synchronously — a real MapLibre map never fires "load"
        // synchronously, but nothing should depend on that.
        mapRef.current = map;
        // No `customAttribution` — the vector source's own TileJSON already
        // supplies the correct credit line, which MapLibre collects
        // automatically; adding a hand-typed copy on top duplicated it on
        // screen (config.ts's doc comment above `MAP_WORKER_URL` has the
        // full story). `compact: false` keeps it always expanded rather
        // than hidden behind a toggle.
        map.addControl(new maplibre.AttributionControl({ compact: false }));
        map.on("load", () => {
          if (!cancelled) {
            setLoadState("ready");
          }
        });
        // Style/tile load failures (offline, DNS down, etc.) surface here —
        // "if tiles fail/offline show the standard offline state pattern"
        // (wave brief).
        map.on("error", () => {
          if (!cancelled) {
            setLoadState("error");
          }
        });
      })
      .catch(() => {
        if (!cancelled) {
          setLoadState("error");
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `scheme` is read once at creation time (see comment above); `retryTick` is the deliberate re-run trigger for handleRetry
  }, [isFocused, retryTick]);

  // Tears down a broken map instance on unmount too — belt-and-braces
  // alongside the per-effect `cancelled` flag above.
  useEffect(() => {
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  const handleRetry = useCallback(() => {
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    mapRef.current?.remove();
    mapRef.current = null;
    maplibreModuleRef.current = null;
    creationStartedRef.current = false;
    setLoadState("idle");
    setRetryTick((tick) => tick + 1);
  }, []);

  // Rebuilds the marker layer whenever the map becomes ready or the region
  // feed refetches (every 60s while foregrounded, queries.ts) — cheap at
  // this event volume (30-day regional window, low hundreds at most).
  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreModuleRef.current;
    if (loadState !== "ready" || !map || !maplibre) {
      return;
    }

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    const eventById = new Map<string, Event>(events.map((event) => [event.id, event]));

    for (const marker of buildRegionMarkers(events)) {
      const sourceEvent = eventById.get(marker.id);
      const magnitudeLabel = t("events.magnitudeA11yLabel", {
        value: formatMagnitudeValue(marker.magnitudeValue, i18n.language),
      });
      const placeText = sourceEvent ? placeLine(sourceEvent, i18n.language, t) : "";
      const label = [magnitudeLabel, placeText].filter(Boolean).join(". ");

      // Two nested elements: the outer one is the tappable hit area (dot
      // diameter + padding on every side, "big touch targets... extra hit
      // radius" per the wave brief), the inner one is the visible dot —
      // keeps the enlarged hit area invisible rather than a giant colored
      // circle.
      const hitEl = document.createElement("div");
      hitEl.style.width = `${marker.diameterPx + MARKER_HIT_PADDING_PX * 2}px`;
      hitEl.style.height = `${marker.diameterPx + MARKER_HIT_PADDING_PX * 2}px`;
      hitEl.style.display = "flex";
      hitEl.style.alignItems = "center";
      hitEl.style.justifyContent = "center";
      hitEl.style.cursor = "pointer";
      hitEl.setAttribute("role", "button");
      hitEl.setAttribute("aria-label", label);
      hitEl.tabIndex = 0;

      const dotEl = document.createElement("div");
      dotEl.style.width = `${marker.diameterPx}px`;
      dotEl.style.height = `${marker.diameterPx}px`;
      dotEl.style.borderRadius = "50%";
      dotEl.style.backgroundColor = colors.status[marker.tone];
      dotEl.style.border = `2px solid ${colors.surface.raised}`;
      dotEl.style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.35)";
      hitEl.appendChild(dotEl);

      const activate = () => routerRef.current.push(`/event/${marker.id}`);
      hitEl.addEventListener("click", activate);
      hitEl.addEventListener("keydown", (domEvent) => {
        if (domEvent.key === "Enter" || domEvent.key === " ") {
          domEvent.preventDefault();
          activate();
        }
      });

      const markerInstance = new maplibre.Marker({ element: hitEl })
        .setLngLat([marker.lon, marker.lat])
        .addTo(map);
      markersRef.current.push(markerInstance);
    }
  }, [loadState, events, colors, t, i18n.language]);

  const showOverlayLoading = loadState === "idle" || loadState === "loading";

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface.base,
          paddingTop: insets.top,
        },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[
          styles.title,
          {
            color: colors.text.primary,
            fontSize: typography.h2.fontSize,
            lineHeight: typography.h2.lineHeight,
            fontWeight: typography.h2.fontWeight,
            paddingHorizontal: spacing[4],
            paddingBottom: spacing[2],
          },
        ]}
      >
        {t("map.title")}
      </Text>

      <View style={styles.mapArea}>
        {/* Web-only file (Metro platform resolution keeps this out of native
            bundles entirely) — MapLibre needs a real DOM node to attach its
            canvas to, so this is a plain DOM element rather than an RN View. */}
        <div ref={containerRef} style={mapContainerStyle} />

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
                <Ionicons
                  name="cloud-offline-outline"
                  size={16}
                  color={colors.text.secondary}
                />
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
              <Pressable accessibilityRole="button" onPress={handleRetry} hitSlop={12}>
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

        {showOverlayLoading ? (
          <View
            style={[
              styles.overlay,
              styles.centered,
              { backgroundColor: colors.surface.base },
            ]}
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

// A plain object (not `StyleSheet.create`, which react-native-web can't
// resolve for a raw DOM element) — the map container needs to fill its
// parent for MapLibre's canvas to size correctly.
const mapContainerStyle: Record<string, string> = {
  width: "100%",
  height: "100%",
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  title: {
    // No explicit textAlign — the default already follows the active
    // writing direction (RTL locales right-align without forcing a
    // physical side, per typescript-react-native.md's logical-properties
    // rule).
  },
  mapArea: {
    flex: 1,
    position: "relative",
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
});
