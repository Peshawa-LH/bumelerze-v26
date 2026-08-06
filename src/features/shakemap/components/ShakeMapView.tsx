import { useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Polygon, Text as SvgText } from "react-native-svg";

import { pickLocalizedName } from "@/features/geo";
import type { TranslateFn } from "@/features/geo";
import { useTheme } from "@/theme";
import { pickMapCities } from "../cities";
import { SHAKEMAP_VIEW_HEIGHT, SHAKEMAP_VIEW_WIDTH } from "../config";
import { INTENSITY_ROMAN_NUMERALS } from "../intensity-ramp";
import { computeContourBoundingBox, createEquirectangularProjector } from "../projection";
import type { IntensityContourSet } from "../types";

/**
 * ARCHITECTURE NOTE (D9, decided — no MapLibre in this wave): MapLibre RN
 * is a native module that runs in neither Expo Go nor web, and web is
 * currently this project's only verification medium. ShakeMap display
 * therefore ships as a self-contained SVG projection renderer
 * (react-native-svg, already a dependency for `SeismogramChart`) —
 * visually similar to USGS's own static intensity map images and fully
 * product-shaped (this component reads only `IntensityContourSet` +
 * lat/lon, never a USGS-specific field), so when the interactive MapLibre
 * map lands later (dev-build phase) the exact same product model feeds it
 * with no data-layer change — only this component gets swapped/extended.
 */

/** MMI value rounds to a ramp index 1..12; index 0 is the theme ramp's own
 * unused placeholder (see `theme/palette.ts`). Provides a safe fallback so
 * `noUncheckedIndexedAccess` array reads never surface as `undefined` to a
 * required SVG `fill`/color prop. */
function rampColor(colors: ReturnType<typeof useTheme>["colors"], level: number): string {
  return colors.intensity[level] ?? colors.intensity[1] ?? colors.status.warning;
}

export interface ShakeMapViewProps {
  contours: IntensityContourSet;
  epicenter: { lat: number; lon: number };
  locale: string;
  t: TranslateFn;
}

/**
 * MMI intensity-contour map for one event's ShakeMap product (spec-v1.md
 * §4.5): filled contour rings (theme intensity ramp, D7), epicenter
 * marker, up to ~5 gazetteer city dots, and a fixed I..XII intensity
 * legend strip. Renders nothing conditionally itself — callers
 * (`ShakeMapSection`) decide loading/absent/offline states; this
 * component always assumes it has real contour data to draw.
 */
export function ShakeMapView({ contours, epicenter, locale, t }: ShakeMapViewProps) {
  const { colors, typography, spacing } = useTheme();
  const [measuredWidth, setMeasuredWidth] = useState(0);

  function handleLayout(event: LayoutChangeEvent) {
    setMeasuredWidth(event.nativeEvent.layout.width);
  }

  const bbox = computeContourBoundingBox(contours.levels, [
    [epicenter.lon, epicenter.lat],
  ]);
  const projector = createEquirectangularProjector(bbox, {
    width: SHAKEMAP_VIEW_WIDTH,
    height: SHAKEMAP_VIEW_HEIGHT,
  });

  const cities = pickMapCities(bbox, epicenter);
  const epicenterPoint = projector.project(epicenter.lon, epicenter.lat);
  const highestLevel = contours.levels[contours.levels.length - 1];

  const displayHeight =
    measuredWidth > 0
      ? (measuredWidth / SHAKEMAP_VIEW_WIDTH) * SHAKEMAP_VIEW_HEIGHT
      : SHAKEMAP_VIEW_HEIGHT;

  return (
    <View style={{ gap: spacing[2] }}>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.labelCaption.fontSize,
          lineHeight: typography.labelCaption.lineHeight,
          fontWeight: typography.labelCaption.fontWeight,
        }}
      >
        {t("eventDetail.shakemap.legendCaption")}
      </Text>

      {/* The map itself never mirrors under RTL (design-language.md §5
       * "what does NOT mirror" — same rule `SeismogramChart` follows for
       * its waveform): a geographic projection has a real, fixed compass
       * orientation, and flipping it would misrepresent which side of the
       * epicenter a city actually sits on. `direction: "ltr"` here
       * overrides the ambient RTL layout direction for this subtree only;
       * the caption/citation text around it (outside this View) still
       * follows the locale normally. */}
      <View
        testID="shakemap-map-container"
        onLayout={handleLayout}
        accessible
        accessibilityRole="image"
        accessibilityLabel={t("eventDetail.shakemap.mapA11yLabel", {
          level: highestLevel ? INTENSITY_ROMAN_NUMERALS[highestLevel.level] : "",
        })}
        style={[styles.mapContainer, { direction: "ltr" }]}
      >
        {measuredWidth > 0 ? (
          <Svg
            width={measuredWidth}
            height={displayHeight}
            viewBox={`0 0 ${SHAKEMAP_VIEW_WIDTH} ${SHAKEMAP_VIEW_HEIGHT}`}
          >
            {contours.levels.map((level) =>
              level.rings.map((ring, ringIndex) => {
                const points = ring.points
                  .map(([lon, lat]) => {
                    const { x, y } = projector.project(lon, lat);
                    return `${x},${y}`;
                  })
                  .join(" ");
                return (
                  <Polygon
                    key={`${level.value}-${ringIndex}`}
                    testID={`shakemap-contour-${level.value}-${ringIndex}`}
                    points={points}
                    fill={rampColor(colors, level.level)}
                    fillOpacity={0.6}
                    stroke="none"
                  />
                );
              }),
            )}

            {cities.map((city) => {
              const { x, y } = projector.project(city.lon, city.lat);
              return (
                <G key={city.id}>
                  <Circle cx={x} cy={y} r={2.5} fill={colors.text.primary} />
                  {/* Halo stroke behind the fill for legibility over any
                   * intensity color underneath (`react-native-svg`'s TS
                   * types don't expose `paintOrder`, so this relies on the
                   * default fill-then-stroke paint order — a small
                   * strokeWidth still reads as a legible outline). */}
                  <SvgText
                    x={x + 5}
                    y={y + 3}
                    fontSize={9}
                    fill={colors.text.primary}
                    stroke={colors.surface.base}
                    strokeWidth={2}
                  >
                    {pickLocalizedName(city.names, locale)}
                  </SvgText>
                </G>
              );
            })}

            {/* Epicenter marker: a halo circle for contrast against
             * whatever intensity color sits underneath, plus a filled
             * center dot — deliberately simple (no MapLibre-style custom
             * icon asset this wave). */}
            <Circle
              cx={epicenterPoint.x}
              cy={epicenterPoint.y}
              r={7}
              fill="none"
              stroke={colors.surface.base}
              strokeWidth={3}
            />
            <Circle
              cx={epicenterPoint.x}
              cy={epicenterPoint.y}
              r={7}
              fill="none"
              stroke={colors.status.danger}
              strokeWidth={1.5}
            />
            <Circle
              cx={epicenterPoint.x}
              cy={epicenterPoint.y}
              r={3}
              fill={colors.status.danger}
            />
          </Svg>
        ) : null}
      </View>

      {/* Legend strip — same non-mirroring rule as the map: Roman numerals
       * always read I -> XII left to right regardless of locale. */}
      <View
        style={[styles.legendRow, { direction: "ltr", gap: spacing[1] }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {INTENSITY_ROMAN_NUMERALS.slice(1).map((numeral, index) => {
          const level = index + 1;
          return (
            <View key={level} style={styles.legendItem}>
              <View
                style={[
                  styles.legendSwatch,
                  { backgroundColor: rampColor(colors, level) },
                ]}
              />
              <Text
                style={{
                  color: colors.text.secondary,
                  fontSize: 9,
                  fontWeight: "600",
                }}
              >
                {numeral}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mapContainer: {
    width: "100%",
    aspectRatio: SHAKEMAP_VIEW_WIDTH / SHAKEMAP_VIEW_HEIGHT,
    borderRadius: 12,
    overflow: "hidden",
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  legendItem: {
    alignItems: "center",
    width: 24,
  },
  legendSwatch: {
    width: 16,
    height: 10,
    borderRadius: 2,
  },
});
