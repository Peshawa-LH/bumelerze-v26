import { useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Rect, Text as SvgText } from "react-native-svg";

import { pickLocalizedName, type TranslateFn } from "@/features/geo";
import {
  computeContourBoundingBox,
  createEquirectangularProjector,
  layoutCityLabels,
  mmiValueToLevel,
  pickMapCities,
  type LabelCandidate,
} from "@/features/shakemap";
import { formatFixedLocalized, localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import {
  FELTMAP_MAX_CITIES,
  FELTMAP_VIEW_HEIGHT,
  FELTMAP_VIEW_WIDTH,
} from "../config";
import { decodeGeohashBounds } from "../geohash-bounds";
import type { FeltCellRow } from "../types";

/**
 * ARCHITECTURE NOTE (mirrors `shakemap/components/ShakeMapView.tsx`'s own
 * doc comment, D9): SVG projection renderer, no MapLibre — same
 * `react-native-svg`-only constraint, same reasoning. This component reads
 * only `FeltCellRow[]` + lat/lon, never a Supabase-specific shape, so it
 * stays swappable the same way the ShakeMap renderer is.
 *
 * The wave brief asks this section to "feel like a sibling" of
 * `ShakeMapView` — this file deliberately reuses that component's actual
 * projection/city-labeling helpers (`@/features/shakemap`'s
 * `computeContourBoundingBox`, `createEquirectangularProjector`,
 * `pickMapCities`, `layoutCityLabels`, `mmiValueToLevel`) rather than
 * re-implementing equivalents, so the two maps can never visually drift
 * apart on how a bbox is padded, which cities get labeled, or which ramp
 * index a value maps to. Cell squares are geometrically simple enough
 * (axis-aligned in this equirectangular projection, since both `x` and `y`
 * are independent affine transforms of lon/lat respectively) that only two
 * projected corners are needed per cell.
 */

/** Same safe-fallback pattern as `ShakeMapView`'s own `rampColor` — kept as
 * a small local copy rather than exported from `shakemap` purely for this
 * one call site, so this component's only real coupling to that feature is
 * its already-public projection/labeling API. */
function rampColor(colors: ReturnType<typeof useTheme>["colors"], level: number): string {
  return colors.intensity[level] ?? colors.intensity[1] ?? colors.status.warning;
}

/** CDI floor/cap (felt-report-science-v1.md §3.2 R11, migration 0004's own
 * `cdi numeric(3,1)` comment: "floor 2.0, cap 9.0") — the legend always
 * shows this full fixed range regardless of which values are actually
 * present in `cells`, so its meaning doesn't shift map-to-map. */
const CDI_LEGEND_LEVELS = [2, 3, 4, 5, 6, 7, 8, 9] as const;

export interface FeltMapViewProps {
  /** Already resolved by `selectFeltMapCells` (finest-precision-wins,
   * null-`cdi` rows dropped) — every cell here has a non-null `cdi` and no
   * two cells geographically overlap. Must be non-empty; `FeltMapSection`
   * owns the empty/hidden decision, this component always assumes it has
   * real cells to draw (same division of responsibility as
   * `ShakeMapView`/`ShakeMapSection`). */
  cells: readonly FeltCellRow[];
  epicenter: { lat: number; lon: number };
  locale: string;
  t: TranslateFn;
  /** Localized "{distance} {direction} of {city}, {region}" place line —
   * folded into the map's `accessibilityLabel`, same role as
   * `ShakeMapViewProps.placeText`. */
  placeText: string;
}

export function FeltMapView({ cells, epicenter, locale, t, placeText }: FeltMapViewProps) {
  const { colors, typography, spacing } = useTheme();
  const [measuredWidth, setMeasuredWidth] = useState(0);

  function handleLayout(event: LayoutChangeEvent) {
    setMeasuredWidth(event.nativeEvent.layout.width);
  }

  const cellBounds = cells.map((cell) => ({
    cell,
    bounds: decodeGeohashBounds(cell.geohash),
  }));

  const bbox = computeContourBoundingBox(
    [],
    [
      ...cellBounds.flatMap(({ bounds }) => [
        [bounds.minLon, bounds.minLat] as const,
        [bounds.maxLon, bounds.maxLat] as const,
      ]),
      [epicenter.lon, epicenter.lat] as const,
    ],
  );
  const projector = createEquirectangularProjector(bbox, {
    width: FELTMAP_VIEW_WIDTH,
    height: FELTMAP_VIEW_HEIGHT,
  });

  const cities = pickMapCities(bbox, epicenter, FELTMAP_MAX_CITIES);
  const epicenterPoint = projector.project(epicenter.lon, epicenter.lat);
  const mapCenter = { x: FELTMAP_VIEW_WIDTH / 2, y: FELTMAP_VIEW_HEIGHT / 2 };

  const cityNames = new Map(
    cities.map((city) => [city.id, pickLocalizedName(city.names, locale)]),
  );
  const labelCandidates: LabelCandidate[] = cities.map((city) => ({
    id: city.id,
    dot: projector.project(city.lon, city.lat),
    text: cityNames.get(city.id) ?? "",
  }));
  const placedLabels = layoutCityLabels(labelCandidates, epicenterPoint, mapCenter);

  const totalReports = cells.reduce((sum, cell) => sum + cell.n_reports, 0);
  // `cell.cdi` is guaranteed non-null by `selectFeltMapCells` — the `?? 0`
  // fallbacks below exist only to satisfy `noUncheckedIndexedAccess`/strict
  // null-checking on the `Math.min`/`Math.max` reduction, not because a
  // null value is actually expected here.
  const cdiValues = cells.map((cell) => cell.cdi ?? 0);
  const minCdi = Math.min(...cdiValues);
  const maxCdi = Math.max(...cdiValues);

  const displayHeight =
    measuredWidth > 0
      ? (measuredWidth / FELTMAP_VIEW_WIDTH) * FELTMAP_VIEW_HEIGHT
      : FELTMAP_VIEW_HEIGHT;

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
        {t("eventDetail.feltMap.legendCaption")}
      </Text>

      {/* Never mirrors under RTL — same rule and same reasoning as
       * `ShakeMapView`'s map container (design-language.md §5): a
       * geographic projection has a fixed compass orientation. */}
      <View
        testID="feltmap-map-container"
        onLayout={handleLayout}
        accessible
        accessibilityRole="image"
        accessibilityLabel={t("eventDetail.feltMap.mapA11yLabel", {
          count: localizeDigits(String(totalReports), locale),
          min: formatFixedLocalized(minCdi, 1, locale),
          max: formatFixedLocalized(maxCdi, 1, locale),
          place: placeText,
        })}
        style={[styles.mapContainer, { direction: "ltr" }]}
      >
        {measuredWidth > 0 ? (
          <Svg
            width={measuredWidth}
            height={displayHeight}
            viewBox={`0 0 ${FELTMAP_VIEW_WIDTH} ${FELTMAP_VIEW_HEIGHT}`}
          >
            {cellBounds.map(({ cell, bounds }) => {
              const topLeft = projector.project(bounds.minLon, bounds.maxLat);
              const bottomRight = projector.project(bounds.maxLon, bounds.minLat);
              // `cell.cdi` is non-null here (`selectFeltMapCells`
              // contract) — the `?? 0` is the same defensive-only
              // fallback as above.
              const level = mmiValueToLevel(cell.cdi ?? 0);
              return (
                <Rect
                  key={cell.geohash}
                  testID={`feltmap-cell-${cell.geohash}`}
                  x={topLeft.x}
                  y={topLeft.y}
                  width={Math.max(bottomRight.x - topLeft.x, 0)}
                  height={Math.max(bottomRight.y - topLeft.y, 0)}
                  fill={rampColor(colors, level)}
                  fillOpacity={0.75}
                  stroke={colors.surface.base}
                  strokeWidth={0.5}
                />
              );
            })}

            {placedLabels.map((label) => {
              const labelText = cityNames.get(label.id) ?? "";
              const y = label.anchor.y + 3;
              // Same true-halo-behind-fill double-Text technique as
              // `ShakeMapView` (see that file's doc comment for why a
              // single Text with both `fill`+`stroke` doesn't work).
              return (
                <SvgText
                  key={`${label.id}-halo`}
                  x={label.anchor.x}
                  y={y}
                  textAnchor={label.textAnchor}
                  fontSize={7}
                  fontWeight="500"
                  fill="none"
                  stroke={colors.surface.base}
                  strokeWidth={1.25}
                  strokeLinejoin="round"
                >
                  {labelText}
                </SvgText>
              );
            })}
            {placedLabels.map((label) => (
              <SvgText
                key={label.id}
                testID={`feltmap-label-${label.id}`}
                x={label.anchor.x}
                y={label.anchor.y + 3}
                textAnchor={label.textAnchor}
                fontSize={7}
                fontWeight="500"
                fill={colors.text.secondary}
              >
                {cityNames.get(label.id) ?? ""}
              </SvgText>
            ))}
          </Svg>
        ) : null}
      </View>

      {/* Legend strip — same non-mirroring rule as the map itself, and the
       * same fixed-range convention `ShakeMapView`'s I..XII strip follows,
       * except numbered 2-9 (CDI's own floor/cap, not the EMS-98 Roman-
       * numeral convention that section uses) so the two legends read as
       * clearly different scales, not as the same one mislabeled. */}
      <View
        style={[styles.legendRow, { direction: "ltr", gap: spacing[1] }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {CDI_LEGEND_LEVELS.map((level) => (
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
              {localizeDigits(String(level), locale)}
            </Text>
          </View>
        ))}
      </View>

      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
        }}
      >
        {t("eventDetail.feltMap.reportCount", {
          count: localizeDigits(String(totalReports), locale),
          cells: localizeDigits(String(cells.length), locale),
        })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mapContainer: {
    width: "100%",
    aspectRatio: FELTMAP_VIEW_WIDTH / FELTMAP_VIEW_HEIGHT,
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
