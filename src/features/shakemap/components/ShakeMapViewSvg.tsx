import { useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Polygon, Polyline, Text as SvgText } from "react-native-svg";

import { pickLocalizedName } from "@/features/geo";
import type { TranslateFn } from "@/features/geo";
import { useTheme } from "@/theme";
import { BASEMAP_BORDERS, BASEMAP_COASTLINE, type BasemapLine } from "../basemap/basemap";
import { pickMapCities } from "../cities";
import {
  SHAKEMAP_BASEMAP_BORDER_WIDTH,
  SHAKEMAP_BASEMAP_COASTLINE_WIDTH,
  SHAKEMAP_BASEMAP_LINE_OPACITY,
  SHAKEMAP_CITY_DOT_RADIUS,
  SHAKEMAP_LABEL_FONT_SIZE,
  SHAKEMAP_LABEL_HALO_WIDTH,
  SHAKEMAP_VIEW_HEIGHT,
  SHAKEMAP_VIEW_WIDTH,
} from "../config";
import { DAMAGE_GRADE_LABELS } from "../damage-ramp";
import { INTENSITY_ROMAN_NUMERALS } from "../intensity-ramp";
import { layoutCityLabels, type LabelCandidate } from "../label-layout";
import {
  clipLineToBbox,
  computeContourBoundingBox,
  createEquirectangularProjector,
  type LonLatBoundingBox,
  type Projector,
} from "../projection";
import { starPointsAttribute } from "../star-marker";
import type { DamageContourSet, IntensityContourSet } from "../types";
import { ShakeMapLayerToggle } from "./ShakeMapLayerToggle";
import { ShakeMapLegend, type ShakeMapLayer } from "./ShakeMapLegend";

export type { ShakeMapLayer };

/**
 * ARCHITECTURE NOTE (D9, decided — no MapLibre in this wave): MapLibre RN
 * is a native module that runs in neither Expo Go nor web, and web is
 * currently this project's only verification medium. SHAKEmap display
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

/** Clips every line in `lines` to the map's own contour `bbox` (not the
 * basemap fixture's own much larger coverage bbox — see `projection.ts`'s
 * `clipLineToBbox` doc comment) and projects the surviving points to SVG
 * `<Polyline points="...">` strings. A single source line can come back as
 * zero, one, or several path strings (a line that exits and re-enters the
 * box, or never touches it at all). */
function projectBasemapLines(
  lines: readonly BasemapLine[],
  bbox: LonLatBoundingBox,
  projector: Projector,
): string[] {
  const paths: string[] = [];
  for (const line of lines) {
    for (const part of clipLineToBbox(line, bbox)) {
      paths.push(
        part
          .map(([lon, lat]) => {
            const { x, y } = projector.project(lon, lat);
            return `${x},${y}`;
          })
          .join(" "),
      );
    }
  }
  return paths;
}

export interface ShakeMapViewProps {
  contours: IntensityContourSet;
  epicenter: { lat: number; lon: number };
  locale: string;
  t: TranslateFn;
  /** Localized "{distance} {direction} of {city}, {region}" place line
   * (`@/features/geo`'s `placeLine`) — folded into `mapA11yLabel` so a
   * screen-reader user gets the same "where" context a sighted user reads
   * off the epicenter marker + nearby-city labels drawn on the map SVG. */
  placeText: string;
  /** Optional expected-damage-grade contour set (`risk-dashboard` wave,
   * D46) — when present and non-empty, a small Intensity/Damage segmented
   * toggle appears above the map (default Intensity) and the Damage option
   * becomes selectable; `null`/`undefined`/empty means no risk product
   * exists for this event, and the map behaves exactly as before this
   * wave (no toggle at all). */
  damageContours?: DamageContourSet | null;
}

/**
 * MMI intensity-contour map for one event's shakemap product (spec-v1.md
 * §4.5): filled contour rings (theme intensity ramp, D7), epicenter
 * marker, up to ~5 gazetteer city dots, and a fixed I..XII intensity
 * legend strip. Renders nothing conditionally itself — callers
 * (`ShakeMapSection`) decide loading/absent/offline states; this
 * component always assumes it has real contour data to draw.
 */
export function ShakeMapView({
  contours,
  epicenter,
  locale,
  t,
  placeText,
  damageContours,
}: ShakeMapViewProps) {
  const { colors, typography, spacing } = useTheme();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [layer, setLayer] = useState<ShakeMapLayer>("intensity");

  function handleLayout(event: LayoutChangeEvent) {
    setMeasuredWidth(event.nativeEvent.layout.width);
  }

  // Toggle only ever shows/matters when there is real damage-layer data to
  // switch to — an event with a risk product but no `cont_damage.json`
  // (damageContours null/empty, `risk.ts`'s own "damageContours optional"
  // doc comment) still gets the Intensity map exactly as before, just
  // without the toggle.
  const hasDamageLayer = Boolean(damageContours && damageContours.levels.length > 0);
  const activeLayer: ShakeMapLayer = hasDamageLayer ? layer : "intensity";

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
  const highestDamageLevel = damageContours?.levels[damageContours.levels.length - 1];

  // Static basemap layer (wave brief point 2 — "there should be a basemap
  // similar to SHAKEmaps toolkit"): country border lines + coastline,
  // clipped to this product's own bbox and projected once per render, same
  // as the contour rings below. Computed here (not memoized) — the fixture
  // itself is tiny (~1200 points total across the whole region) and this
  // only ever runs on `bbox`/`projector` changes, i.e. once per event.
  const borderPaths = projectBasemapLines(BASEMAP_BORDERS, bbox, projector);
  const coastlinePaths = projectBasemapLines(BASEMAP_COASTLINE, bbox, projector);

  // Label decluttering (ui-backlog.md item 7): dots for every picked city
  // always render (position accuracy never depends on label space), but
  // the text labels go through a deterministic greedy layout pass that
  // skips/offsets anything that would collide with the epicenter marker or
  // an already-placed label — see `label-layout.ts`. `cities` is already
  // priority-ordered (HomeBase-subset first, then nearest), which is
  // exactly the greedy pass's priority order too.
  const cityNames = new Map(
    cities.map((city) => [city.id, pickLocalizedName(city.names, locale)]),
  );
  const labelCandidates: LabelCandidate[] = cities.map((city) => ({
    id: city.id,
    dot: projector.project(city.lon, city.lat),
    text: cityNames.get(city.id) ?? "",
  }));
  const placedLabels = layoutCityLabels(labelCandidates, epicenterPoint, {
    x: SHAKEMAP_VIEW_WIDTH / 2,
    y: SHAKEMAP_VIEW_HEIGHT / 2,
  });

  const displayHeight =
    measuredWidth > 0
      ? (measuredWidth / SHAKEMAP_VIEW_WIDTH) * SHAKEMAP_VIEW_HEIGHT
      : SHAKEMAP_VIEW_HEIGHT;

  const mapA11yLabel =
    activeLayer === "damage"
      ? t("eventDetail.shakemap.mapA11yLabelDamage", {
          level: highestDamageLevel ? DAMAGE_GRADE_LABELS[highestDamageLevel.level] : "",
          place: placeText,
        })
      : t("eventDetail.shakemap.mapA11yLabel", {
          level: highestLevel ? INTENSITY_ROMAN_NUMERALS[highestLevel.level] : "",
          place: placeText,
        });

  return (
    <View style={{ gap: spacing[2] }}>
      <ShakeMapLayerToggle
        hasDamageLayer={hasDamageLayer}
        activeLayer={activeLayer}
        onChange={setLayer}
        t={t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />

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
        accessibilityLabel={mapA11yLabel}
        style={[styles.mapContainer, { direction: "ltr" }]}
      >
        {measuredWidth > 0 ? (
          <Svg
            width={measuredWidth}
            height={displayHeight}
            viewBox={`0 0 ${SHAKEMAP_VIEW_WIDTH} ${SHAKEMAP_VIEW_HEIGHT}`}
          >
            {/* Basemap layer (coastline, then borders, then intensity
             * contours on top) — same layer order the toolkit's own
             * `SHAKEmapper.create_basemap()` draws (coastlines, then
             * `cfeature.BORDERS`, everything else painted over it).
             * `fill="none"` + a subtle theme border color + partial opacity
             * keeps this as context, not the map's own subject; the 60%-
             * opacity contour fills painted on top still let it read
             * through (wave brief). */}
            {coastlinePaths.map((points, index) => (
              <Polyline
                key={`coastline-${index}`}
                testID={`shakemap-basemap-coastline-${index}`}
                points={points}
                fill="none"
                stroke={colors.text.secondary}
                strokeWidth={SHAKEMAP_BASEMAP_COASTLINE_WIDTH}
                strokeOpacity={SHAKEMAP_BASEMAP_LINE_OPACITY}
                strokeLinejoin="round"
              />
            ))}
            {borderPaths.map((points, index) => (
              <Polyline
                key={`border-${index}`}
                testID={`shakemap-basemap-border-${index}`}
                points={points}
                fill="none"
                stroke={colors.text.secondary}
                strokeWidth={SHAKEMAP_BASEMAP_BORDER_WIDTH}
                strokeOpacity={SHAKEMAP_BASEMAP_LINE_OPACITY}
                strokeLinejoin="round"
              />
            ))}

            {activeLayer === "intensity"
              ? contours.levels.map((level) =>
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
                )
              : (damageContours?.levels ?? []).map((level) =>
                  level.rings.map((ring, ringIndex) => {
                    const points = ring.points
                      .map(([lon, lat]) => {
                        const { x, y } = projector.project(lon, lat);
                        return `${x},${y}`;
                      })
                      .join(" ");
                    return (
                      <Polygon
                        key={`damage-${level.value}-${ringIndex}`}
                        testID={`shakemap-damage-contour-${level.value}-${ringIndex}`}
                        points={points}
                        fill={colors.damageGrade[level.level] ?? colors.damageGrade[1] ?? colors.status.warning}
                        fillOpacity={0.6}
                        stroke="none"
                      />
                    );
                  }),
                )}

            {cities.map((city) => {
              const { x, y } = projector.project(city.lon, city.lat);
              // Dots always render regardless of label placement — position
              // accuracy shouldn't depend on whether there was room for a
              // text label (see label-decluttering block above). Sized to
              // match the smaller, lighter labels below (wave brief:
              // "dots smaller to match").
              return (
                <Circle
                  key={city.id}
                  testID={`shakemap-city-dot-${city.id}`}
                  cx={x}
                  cy={y}
                  r={SHAKEMAP_CITY_DOT_RADIUS}
                  fill={colors.text.secondary}
                />
              );
            })}

            {placedLabels.map((label) => {
              const labelText = cityNames.get(label.id) ?? "";
              const y = label.anchor.y + 3;
              // True halo-behind-fill: `react-native-svg`'s TS types don't
              // expose SVG's `paint-order`, and a single Text with both
              // `fill` + `stroke` paints the stroke ON TOP of the fill
              // (default SVG paint order), eating into the glyph's own
              // strokes and reading as bolder/heavier — exactly the "too
              // large and dark" complaint. Two stacked Text elements (a
              // stroke-only "halo" copy painted first, a fill-only copy on
              // top, later-in-document-order = on-top in SVG) gets the
              // halo BEHIND the glyph instead, at `text.secondary`'s
              // lighter, subtler weight.
              return (
                <SvgText
                  key={`${label.id}-halo`}
                  x={label.anchor.x}
                  y={y}
                  textAnchor={label.textAnchor}
                  fontSize={SHAKEMAP_LABEL_FONT_SIZE}
                  fontWeight="500"
                  fill="none"
                  stroke={colors.surface.base}
                  strokeWidth={SHAKEMAP_LABEL_HALO_WIDTH}
                  strokeLinejoin="round"
                >
                  {labelText}
                </SvgText>
              );
            })}
            {placedLabels.map((label) => (
              <SvgText
                key={label.id}
                testID={`shakemap-label-${label.id}`}
                x={label.anchor.x}
                y={label.anchor.y + 3}
                textAnchor={label.textAnchor}
                fontSize={SHAKEMAP_LABEL_FONT_SIZE}
                fontWeight="500"
                fill={colors.text.secondary}
              >
                {cityNames.get(label.id) ?? ""}
              </SvgText>
            ))}

            {/* Epicenter marker: a five-pointed star, not a circle (owner:
             * "epicenter star, not a too-big circle") — a thin
             * `surface.base` halo stroke keeps it legible against whatever
             * intensity/damage color sits underneath, same contrast trick
             * the old halo circle used. */}
            <Polygon
              testID="shakemap-epicenter"
              points={starPointsAttribute(epicenterPoint.x, epicenterPoint.y, 6)}
              fill={colors.status.danger}
              stroke={colors.surface.base}
              strokeWidth={1}
              strokeLinejoin="round"
            />
          </Svg>
        ) : null}
      </View>

      <ShakeMapLegend
        layer={activeLayer}
        t={t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />
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
});
