import { nearestCities, pickLocalizedName } from "@/features/geo";
import { BASEMAP_BORDERS, BASEMAP_COASTLINE } from "@/features/shakemap/basemap/basemap";
import { pickMapCities } from "@/features/shakemap/cities";
import { SHAKEMAP_LABEL_FONT_SIZE } from "@/features/shakemap/config";
import { formatIntensity } from "@/features/shakemap/intensity-format";
import { layoutCityLabels } from "@/features/shakemap/label-layout";
import {
  clipLineToBbox,
  createEquirectangularProjector,
  type LonLatBoundingBox,
} from "@/features/shakemap/projection";
import { starVertices } from "@/features/shakemap/star-marker";
import type {
  ContourRing,
  IntensityContourLevel,
  IntensityContourSet,
} from "@/features/shakemap/types";
import { isRTLLocale } from "@/i18n";
import { localizeDigits } from "@/lib/format-numbers";
import type { SemanticColors } from "@/theme";

import { SHARE_IMAGE_HEIGHTS, SHARE_IMAGE_WIDTH } from "./config";
import { buildQrPath } from "./qr-path";
import {
  estimateTextWidth,
  fitFontSize,
  wrapText,
  wrapTextBalanced,
  type TextWeight,
} from "./text-measure";
import type { ShareCardSize } from "./types";

/**
 * The share card as plain data (owner note N14). `buildCardModel` decides what
 * goes where; `ShareCardSvg` only draws what it is given. Keeping the layout
 * pure makes it testable without a renderer and keeps the web and phone
 * exports identical.
 *
 * Coordinates are in image pixels of the final 1080-wide card. The map is
 * geographic and never mirrors under RTL (like every other map in the app);
 * all text and blocks around it follow the reading direction.
 */

/** Outer margin of the card. */
const MARGIN = 56;
/** Story images keep clear of the strips Instagram and similar apps cover. */
const STORY_TOP_BAR = 150;
const STORY_BOTTOM_BAR = 170;

const HERO_SIZE = 176;
const PLACE_SIZE = 44;
const TIME_SIZE = 34;
const MAP_RADIUS = 28;
const FOOTER_HEIGHT = 100;
const FOOTER_MARK_WIDTH = 150;
const LEGEND_CAPTION_SIZE = 28;
const CHIP_HEIGHT = 56;
const CHIP_WIDTH = 150;
const CHIP_GAP = 8;
const PROMPT_SIZE = 46;
const QR_TILE = 236;
const QR_PADDING = 18;
const PILL_SIZE = 25;
const STAR_RADIUS = 30;
const TOWN_DOT_RADIUS = 7;
const TOWN_LABEL_SIZE = 27;
const MAX_TOWN_LABELS = 6;
const EXTRA_TOWN_DOT_RADIUS = 4.5;
const MAX_EXTRA_TOWN_DOTS = 8;
const KM_PER_DEGREE = 111.195;
/** Round distances offered for the scale bar, and (a sparser set, so two rings
 * never sit almost on top of each other) for the distance rings. */
const NICE_KM = [2, 5, 10, 20, 25, 50, 100, 200, 250, 500];
const RING_KM = [10, 25, 50, 100, 200];
const MIN_RING_PX = 40;
const SCALE_LABEL_SIZE = 24;
const MAX_RINGS = 2;

/** Lowest band the card paints: III. Level II covers the whole model grid. */
const MIN_BAND_VALUE = 2.5;
/** The map always spans at least this much latitude, so a small event still
 * shows its surroundings (and the basemap's coarse lines stay smooth). */
const MIN_MAP_LAT_SPAN_DEG = 0.9;
/** The nearest towns are kept in frame when they lie within this distance, so
 * even a small event shows where it is relative to a place people know. */
const NEAREST_TOWN_IN_FRAME_KM = 160;
const NEAREST_TOWN_COUNT = 3;
const MAP_PADDING_RATIO = 0.12;
const BAND_OPACITY = 0.78;
/** Points closer than this (px) to the previous kept point are dropped. */
const PATH_MIN_STEP = 1.2;

export type CardAnchor = "start" | "middle" | "end";

export interface CardTextRun {
  text: string;
  size: number;
}

export interface CardText {
  text: string;
  /** When set, the text is drawn as these consecutive runs (one line, mixed
   * sizes) and `text` is only the plain concatenation, for tests. */
  runs?: CardTextRun[];
  x: number;
  y: number;
  size: number;
  weight: TextWeight;
  fill: string;
  /** Physical anchor: `start` is the left edge of the text, `end` the right. */
  anchor: CardAnchor;
  /** The text is in a right-to-left language (the renderer isolates it). */
  rtl: boolean;
  opacity?: number;
  /** A halo painted behind the glyphs (map labels). */
  halo?: { stroke: string; width: number };
}

export interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  fill: string;
  opacity?: number;
  stroke?: { color: string; width: number };
}

export interface CardBand {
  d: string;
  fill: string;
  level: number;
}

export interface CardLine {
  d: string;
  stroke: string;
  width: number;
  opacity: number;
  dash?: string;
}

export interface CardTown {
  x: number;
  y: number;
  radius: number;
}

export interface CardRing {
  cx: number;
  cy: number;
  r: number;
}

export interface CardMap {
  frame: CardRect;
  background: string;
  bandOpacity: number;
  bands: CardBand[];
  lines: CardLine[];
  /** Distance rings round the epicentre (no-shakemap cards only). */
  rings: CardRing[];
  ringStyle: { stroke: string; width: number; opacity: number; dash: string };
  towns: CardTown[];
  townDot: { fill: string; halo: string };
  labels: CardText[];
  star: { points: string; fill: string; stroke: string; strokeWidth: number };
  /** The bounds shown, for tests and debugging. */
  bounds: LonLatBoundingBox;
}

export interface CardLegendChip {
  rect: CardRect;
  label: CardText;
  level: number;
}

export interface CardQr {
  tile: CardRect;
  /** Where the QR path (in a `size` box) is translated to. */
  x: number;
  y: number;
  size: number;
  path: string;
  fill: string;
}

export interface CardModel {
  size: ShareCardSize;
  width: number;
  height: number;
  rtl: boolean;
  background: string;
  /** Painted first: bars, accent stripe, footer band. */
  underlay: CardRect[];
  map: CardMap;
  /** Painted over the map: the "automatic estimate" pill. */
  overlay: CardRect[];
  /** Legend chips (empty when there is no shakemap). */
  legendChips: CardLegendChip[];
  mark: { x: number; y: number; scale: number; fill: string };
  qr: CardQr | null;
  /** All free text: header, legend caption, prompt, footer. */
  texts: CardText[];
}

export interface CardStrings {
  /** The localized magnitude display, split around the number: "M " + "3.2"
   * in English, "" + "٣.٢" + " پلە" in Sorani. The number is drawn large and a
   * unit word small, so the hero stays proportionate in every language. */
  magnitude: { prefix: string; value: string; suffix: string };
  place: string;
  time: string;
  legendCaption: string;
  /** Set when the product is an automatic (unreviewed) estimate. */
  automaticNote: string | null;
  siteText: string;
  /** The localized "km" unit, for the scale bar and distance rings. */
  kmUnit: string;
  credit: string;
  /** Story only. */
  prompt: string;
}

export interface CardInput {
  size: ShareCardSize;
  locale: string;
  strings: CardStrings;
  magnitudeValue: number;
  /** The product's origin when it has one, else the event's. */
  epicenter: { lat: number; lon: number };
  /** `null`: no shakemap, an epicentre-and-towns card. */
  contours: IntensityContourSet | null;
  /** Event link, drawn as a QR code on the story size. */
  url: string;
  /** Always the light palette: a shared image must not depend on dark mode. */
  colors: SemanticColors;
  magnitudeBandColor: string;
}

function r1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Contour band choice: one painted band per rounded intensity level (the
 * widest region of that level), III and above, closed polygons only. This
 * matches the legend exactly and avoids the tint stacking that two bands of
 * the same rounded level would produce. */
export function selectCardBands(contours: IntensityContourSet): IntensityContourLevel[] {
  const widest = new Map<number, IntensityContourLevel>();
  for (const level of contours.levels) {
    if (level.value < MIN_BAND_VALUE) continue;
    if (!level.rings.some((ring) => ring.closed !== false)) continue;
    const existing = widest.get(level.level);
    if (!existing || level.value < existing.value) {
      widest.set(level.level, level);
    }
  }
  return [...widest.values()].sort((a, b) => a.level - b.level);
}

function ringPoints(ring: ContourRing): (readonly [number, number])[] {
  return ring.points as (readonly [number, number])[];
}

/**
 * The edge of the model grid, when the product carries it. The engine's lowest
 * band is the whole grid (an axis-aligned rectangle), and every other band is
 * cut by that rectangle where it runs off the grid. A map that looked past it
 * would show those cuts as straight edges floating in empty space, so the
 * window is kept inside. `null` for a product without such a rectangle.
 */
export function findGridBox(contours: IntensityContourSet): LonLatBoundingBox | null {
  const lowest = contours.levels[0];
  if (!lowest) return null;
  const ring = lowest.rings.find((candidate) => candidate.closed !== false);
  if (!ring) return null;
  const points = ringPoints(ring);
  const lons = new Set(points.map(([lon]) => lon.toFixed(6)));
  const lats = new Set(points.map(([, lat]) => lat.toFixed(6)));
  if (points.length > 5 || lons.size !== 2 || lats.size !== 2) return null;
  const lonValues = points.map(([lon]) => lon);
  const latValues = points.map(([, lat]) => lat);
  return {
    minLon: Math.min(...lonValues),
    maxLon: Math.max(...lonValues),
    minLat: Math.min(...latValues),
    maxLat: Math.max(...latValues),
  };
}

/** True when a painted band runs along the grid edge, i.e. is cut by it. */
export function bandsTouchGrid(
  bands: readonly IntensityContourLevel[],
  grid: LonLatBoundingBox,
): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
  return bands.some((band) =>
    band.rings.some((ring) =>
      ringPoints(ring).some(
        ([lon, lat]) =>
          near(lon, grid.minLon) ||
          near(lon, grid.maxLon) ||
          near(lat, grid.minLat) ||
          near(lat, grid.maxLat),
      ),
    ),
  );
}

/**
 * The geographic window of the map: the painted bands, the epicentre and the
 * nearest towns, padded, at least `MIN_MAP_LAT_SPAN_DEG` tall, and widened or
 * heightened to exactly the frame's aspect so nothing is letterboxed.
 */
export function computeCardBounds(
  bands: readonly IntensityContourLevel[],
  epicenter: { lat: number; lon: number },
  nearTowns: readonly { lat: number; lon: number }[],
  frame: { width: number; height: number },
  grid: LonLatBoundingBox | null = null,
): LonLatBoundingBox {
  let minLon = epicenter.lon;
  let maxLon = epicenter.lon;
  let minLat = epicenter.lat;
  let maxLat = epicenter.lat;
  const include = (lon: number, lat: number) => {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  };
  for (const band of bands) {
    for (const ring of band.rings) {
      for (const [lon, lat] of ringPoints(ring)) include(lon, lat);
    }
  }
  for (const town of nearTowns) include(town.lon, town.lat);

  const midLat = (minLat + maxLat) / 2;
  const padLon = Math.max((maxLon - minLon) * MAP_PADDING_RATIO, 0.04);
  const padLat = Math.max((maxLat - minLat) * MAP_PADDING_RATIO, 0.04);
  minLon -= padLon;
  maxLon += padLon;
  minLat -= padLat;
  maxLat += padLat;

  // Grow to the minimum span and to the frame's aspect, around the centre of
  // the content. Widths are compared in ground units (longitude is
  // cos(latitude) shorter), as the projector does.
  const correction = Math.cos((midLat * Math.PI) / 180);
  const aspect = frame.width / frame.height;
  let latSpan = Math.max(maxLat - minLat, MIN_MAP_LAT_SPAN_DEG);
  let lonSpan = maxLon - minLon;
  if ((lonSpan * correction) / latSpan < aspect) {
    lonSpan = (latSpan * aspect) / correction;
  } else {
    latSpan = (lonSpan * correction) / aspect;
  }
  let centerLon = (minLon + maxLon) / 2;
  let centerLat = (minLat + maxLat) / 2;
  const clamp = (value: number, low: number, high: number) =>
    value < low ? low : value > high ? high : value;
  if (grid) {
    // Zoom in (keeping the aspect) until the window fits inside the grid.
    const fit = Math.min(
      1,
      (grid.maxLon - grid.minLon) / lonSpan,
      (grid.maxLat - grid.minLat) / latSpan,
    );
    lonSpan *= fit;
    latSpan *= fit;
  }
  // Slide the window so the epicentre and the nearest towns stay in it when
  // the (possibly zoomed-in) window is big enough to hold them all...
  const must = [epicenter, ...nearTowns];
  const mustMinLon = Math.min(...must.map((point) => point.lon)) - 0.06;
  const mustMaxLon = Math.max(...must.map((point) => point.lon)) + 0.06;
  const mustMinLat = Math.min(...must.map((point) => point.lat)) - 0.08;
  const mustMaxLat = Math.max(...must.map((point) => point.lat)) + 0.08;
  if (mustMaxLon - mustMinLon <= lonSpan) {
    centerLon = clamp(centerLon, mustMaxLon - lonSpan / 2, mustMinLon + lonSpan / 2);
  }
  if (mustMaxLat - mustMinLat <= latSpan) {
    centerLat = clamp(centerLat, mustMaxLat - latSpan / 2, mustMinLat + latSpan / 2);
  }
  // ...and never let it leave the grid (this wins over the above).
  if (grid) {
    centerLon = clamp(centerLon, grid.minLon + lonSpan / 2, grid.maxLon - lonSpan / 2);
    centerLat = clamp(centerLat, grid.minLat + latSpan / 2, grid.maxLat - latSpan / 2);
  }
  return {
    minLon: centerLon - lonSpan / 2,
    maxLon: centerLon + lonSpan / 2,
    minLat: centerLat - latSpan / 2,
    maxLat: centerLat + latSpan / 2,
  };
}

type Project = (lon: number, lat: number) => { x: number; y: number };

function ringToPath(
  points: readonly (readonly [number, number])[],
  project: Project,
  close: boolean,
): string {
  let path = "";
  let lastX = Number.NaN;
  let lastY = Number.NaN;
  points.forEach(([lon, lat], index) => {
    const { x, y } = project(lon, lat);
    const last = index === points.length - 1;
    if (
      index > 0 &&
      !last &&
      Math.abs(x - lastX) < PATH_MIN_STEP &&
      Math.abs(y - lastY) < PATH_MIN_STEP
    ) {
      return;
    }
    path += `${index === 0 ? "M" : "L"}${r1(x)} ${r1(y)}`;
    lastX = x;
    lastY = y;
  });
  return close ? `${path}Z` : path;
}

function bandPath(level: IntensityContourLevel, project: Project): string {
  const parts: string[] = [];
  for (const ring of level.rings) {
    if (ring.closed === false) continue;
    parts.push(ringToPath(ringPoints(ring), project, true));
    for (const hole of ring.holes ?? []) {
      parts.push(ringToPath(hole, project, true));
    }
  }
  return parts.join("");
}

function mapLines(
  project: Project,
  bounds: LonLatBoundingBox,
  colors: SemanticColors,
): CardLine[] {
  const lines: CardLine[] = [];
  const add = (source: typeof BASEMAP_BORDERS, style: Omit<CardLine, "d">) => {
    let d = "";
    for (const line of source) {
      for (const part of clipLineToBbox(line, bounds)) {
        d += ringToPath(part, project, false);
      }
    }
    if (d !== "") lines.push({ d, ...style });
  };
  add(BASEMAP_COASTLINE, {
    stroke: colors.brand.primary,
    width: 3,
    opacity: 0.5,
  });
  add(BASEMAP_BORDERS, {
    stroke: colors.text.secondary,
    width: 3,
    opacity: 0.75,
    dash: "14 9",
  });
  return lines;
}

function textItem(
  rtl: boolean,
  item: Omit<CardText, "rtl"> & { rtl?: boolean },
): CardText {
  return { ...item, rtl: item.rtl ?? rtl };
}

export function buildCardModel(input: CardInput): CardModel {
  const { size, locale, strings, colors } = input;
  const rtl = isRTLLocale(locale);
  const width = SHARE_IMAGE_WIDTH;
  const height = SHARE_IMAGE_HEIGHTS[size];
  const story = size === "story";
  const contentWidth = width - MARGIN * 2;

  const startX = rtl ? width - MARGIN : MARGIN;
  const startAnchor: CardAnchor = rtl ? "end" : "start";
  /** A point `offset` further into the page from the start edge. */
  const inward = (offset: number) => (rtl ? startX - offset : startX + offset);

  const brand = colors.brand.primary;
  const underlay: CardRect[] = [];
  const texts: CardText[] = [];

  // --- vertical budget, bottom up --------------------------------------
  const topBar = story ? STORY_TOP_BAR : 0;
  const bottomBar = story ? STORY_BOTTOM_BAR : 0;
  const footerTop = height - bottomBar - FOOTER_HEIGHT;

  // --- header -----------------------------------------------------------
  let y = topBar + MARGIN;
  const stripeWidth = 14;
  const stripeHeight = 128;
  const heroLeft = stripeWidth + 28;
  const heroMaxWidth = contentWidth - heroLeft;
  const { prefix, value, suffix } = strings.magnitude;
  // A lone Latin "M" belongs to the number; any other prefix or suffix is a
  // unit word and is set small beside it.
  const prefixIsSymbol = /^\s*[A-Za-z]\s*$/.test(prefix);
  const smallRatio = 0.4;
  const heroText = `${prefix}${value}${suffix}`;
  const heroRunWidth = (size: number) =>
    estimateTextWidth(value, size, 700) +
    estimateTextWidth(prefix, prefixIsSymbol ? size : size * smallRatio, 700) +
    estimateTextWidth(suffix, size * smallRatio, 700);
  let heroSize = HERO_SIZE;
  while (heroSize > 96 && heroRunWidth(heroSize) > heroMaxWidth) {
    heroSize -= 4;
  }
  underlay.push({
    x: rtl ? startX - stripeWidth : startX,
    y: y + 12,
    width: stripeWidth,
    height: stripeHeight,
    radius: stripeWidth / 2,
    fill: input.magnitudeBandColor,
  });
  const heroRuns: CardTextRun[] = [
    ...(prefix === ""
      ? []
      : [{ text: prefix, size: prefixIsSymbol ? heroSize : heroSize * smallRatio }]),
    { text: value, size: heroSize },
    ...(suffix === "" ? [] : [{ text: suffix, size: heroSize * smallRatio }]),
  ];
  texts.push(
    textItem(rtl, {
      text: heroText,
      runs: heroRuns,
      x: inward(heroLeft),
      y: y + 138,
      size: heroSize,
      weight: 700,
      fill: colors.text.primary,
      anchor: startAnchor,
    }),
  );
  y += 168;

  const placeLineHeight = Math.round(PLACE_SIZE * (rtl ? 1.45 : 1.3));
  const placeLines = wrapText(strings.place, PLACE_SIZE, 700, contentWidth, 2);
  placeLines.forEach((line, index) => {
    texts.push(
      textItem(rtl, {
        text: line,
        x: startX,
        y: y + PLACE_SIZE + index * placeLineHeight,
        size: PLACE_SIZE,
        weight: 700,
        fill: colors.text.primary,
        anchor: startAnchor,
      }),
    );
  });
  y += placeLines.length * placeLineHeight + 4;
  texts.push(
    textItem(rtl, {
      text: strings.time,
      x: startX,
      y: y + TIME_SIZE,
      size: TIME_SIZE,
      weight: 400,
      fill: colors.text.secondary,
      anchor: startAnchor,
    }),
  );
  y += TIME_SIZE + 30;
  const mapTop = y;

  // --- lower blocks, measured from the footer upward --------------------
  let lowerTop = footerTop;
  let qr: CardQr | null = null;
  if (story) {
    const promptBlockHeight = QR_TILE;
    const promptTop = lowerTop - 36 - promptBlockHeight;
    lowerTop = promptTop;

    const tileX = rtl ? MARGIN : width - MARGIN - QR_TILE;
    const drawing = buildQrPath(input.url, QR_TILE - QR_PADDING * 2);
    qr = {
      tile: {
        x: tileX,
        y: promptTop,
        width: QR_TILE,
        height: QR_TILE,
        radius: 24,
        fill: "#FFFFFF",
        stroke: { color: colors.border.default, width: 2 },
      },
      x: tileX + QR_PADDING,
      y: promptTop + QR_PADDING,
      size: QR_TILE - QR_PADDING * 2,
      path: drawing.path,
      fill: colors.text.primary,
    };
    const promptWidth = contentWidth - QR_TILE - 40;
    const promptLines = wrapTextBalanced(
      strings.prompt,
      PROMPT_SIZE,
      700,
      promptWidth,
      3,
    );
    const blockHeight = promptLines.length * (PROMPT_SIZE + 16);
    const firstBaseline = promptTop + (promptBlockHeight - blockHeight) / 2 + PROMPT_SIZE;
    promptLines.forEach((line, index) => {
      texts.push(
        textItem(rtl, {
          text: line,
          x: startX,
          y: firstBaseline + index * (PROMPT_SIZE + 16),
          size: PROMPT_SIZE,
          weight: 700,
          fill: brand,
          anchor: startAnchor,
        }),
      );
    });
  }

  // Legend: only when a shakemap is drawn.
  const bands = input.contours ? selectCardBands(input.contours) : [];
  const legendChips: CardLegendChip[] = [];
  if (bands.length > 0) {
    const legendBlockHeight = LEGEND_CAPTION_SIZE + 14 + CHIP_HEIGHT;
    const legendTop = lowerTop - 30 - legendBlockHeight;
    lowerTop = legendTop;
    texts.push(
      textItem(rtl, {
        text: strings.legendCaption,
        x: startX,
        y: legendTop + LEGEND_CAPTION_SIZE,
        size: LEGEND_CAPTION_SIZE,
        weight: 400,
        fill: colors.text.secondary,
        anchor: startAnchor,
      }),
    );
    // The scale reads left to right in every language, like the in-app
    // legend; the group sits at the reading-start edge.
    const count = bands.length;
    const chipWidth = Math.min(
      CHIP_WIDTH,
      (contentWidth - (count - 1) * CHIP_GAP) / count,
    );
    const groupWidth = count * chipWidth + (count - 1) * CHIP_GAP;
    const groupLeft = rtl ? width - MARGIN - groupWidth : MARGIN;
    const chipTop = legendTop + LEGEND_CAPTION_SIZE + 14;
    bands.forEach((band, index) => {
      const left = groupLeft + index * (chipWidth + CHIP_GAP);
      legendChips.push({
        level: band.level,
        rect: {
          x: left,
          y: chipTop,
          width: chipWidth,
          height: CHIP_HEIGHT,
          radius: 12,
          fill: colors.intensity[band.level] ?? colors.intensity[1] ?? brand,
        },
        label: {
          text: formatIntensity(band.level, locale),
          x: left + chipWidth / 2,
          y: chipTop + CHIP_HEIGHT / 2 + 10,
          size: 30,
          weight: 700,
          fill: colors.intensityOnFill[band.level] ?? colors.text.primary,
          anchor: "middle",
          rtl: false,
        },
      });
    });
  }

  // --- map ---------------------------------------------------------------
  const mapBottom = lowerTop - 30;
  const frame: CardRect = {
    x: MARGIN,
    y: mapTop,
    width: contentWidth,
    height: Math.max(240, mapBottom - mapTop),
    radius: MAP_RADIUS,
    fill: colors.surface.raised,
    stroke: { color: colors.border.default, width: 2 },
  };

  const near = nearestCities(
    input.epicenter.lat,
    input.epicenter.lon,
    NEAREST_TOWN_COUNT,
  );
  const keepInFrame = near
    .filter((entry) => entry.distanceKm <= NEAREST_TOWN_IN_FRAME_KM)
    .map((entry) => entry.city);
  // The grid edge only matters when a band is actually cut by it.
  const foundGrid = input.contours ? findGridBox(input.contours) : null;
  const gridBox = foundGrid && bandsTouchGrid(bands, foundGrid) ? foundGrid : null;
  const bounds = computeCardBounds(bands, input.epicenter, keepInFrame, frame, gridBox);
  const projector = createEquirectangularProjector(bounds, {
    width: frame.width,
    height: frame.height,
  });
  const project: Project = (lon, lat) => {
    const point = projector.project(lon, lat);
    return { x: frame.x + point.x, y: frame.y + point.y };
  };

  // Towns: the nearest first, then the usual main-town context.
  const seen = new Set<string>();
  const candidates = [
    ...near.map((entry) => entry.city),
    ...pickMapCities(bounds, input.epicenter, 9),
  ].filter((city) => {
    if (seen.has(city.id)) return false;
    seen.add(city.id);
    return (
      city.lon >= bounds.minLon &&
      city.lon <= bounds.maxLon &&
      city.lat >= bounds.minLat &&
      city.lat <= bounds.maxLat
    );
  });
  const names = new Map(
    candidates.map((city) => [city.id, pickLocalizedName(city.names, locale)]),
  );

  // The shared label layout is tuned for the 7-unit labels of the in-app map;
  // run it in that space and scale the result up, so the card uses the same
  // collision rules instead of a second copy of them.
  const labelScale = TOWN_LABEL_SIZE / SHAKEMAP_LABEL_FONT_SIZE;
  const toLayout = (point: { x: number; y: number }) => ({
    x: point.x / labelScale,
    y: point.y / labelScale,
  });
  const epicenterPoint = project(input.epicenter.lon, input.epicenter.lat);
  const localOf = (point: { x: number; y: number }) => ({
    x: point.x - frame.x,
    y: point.y - frame.y,
  });
  const placed = layoutCityLabels(
    candidates.map((city) => ({
      id: city.id,
      dot: toLayout(localOf(project(city.lon, city.lat))),
      text: names.get(city.id) ?? "",
    })),
    toLayout(localOf(epicenterPoint)),
    toLayout({ x: frame.width / 2, y: frame.height / 2 }),
  );

  const labels: CardText[] = [];
  const towns: CardTown[] = [];
  const labelled = new Set<string>();
  for (const label of placed) {
    if (labels.length >= MAX_TOWN_LABELS) break;
    const text = names.get(label.id) ?? "";
    const anchorX = frame.x + label.anchor.x * labelScale;
    const anchorY = frame.y + label.anchor.y * labelScale;
    const textWidth = estimateTextWidth(text, TOWN_LABEL_SIZE, 700);
    const left = label.textAnchor === "start" ? anchorX : anchorX - textWidth;
    const right = left + textWidth;
    const edge = 14;
    if (
      left < frame.x + edge ||
      right > frame.x + frame.width - edge ||
      anchorY < frame.y + edge + TOWN_LABEL_SIZE / 2 ||
      anchorY > frame.y + frame.height - edge - TOWN_LABEL_SIZE / 2
    ) {
      continue;
    }
    towns.push({
      x: frame.x + label.dot.x * labelScale,
      y: frame.y + label.dot.y * labelScale,
      radius: TOWN_DOT_RADIUS,
    });
    labelled.add(label.id);
    labels.push(
      textItem(rtl, {
        text,
        x: r1(anchorX),
        y: r1(anchorY + TOWN_LABEL_SIZE * 0.35),
        size: TOWN_LABEL_SIZE,
        weight: 700,
        fill: colors.text.primary,
        anchor: label.textAnchor === "start" ? "start" : "end",
        halo: { stroke: "#FFFFFF", width: 8 },
      }),
    );
  }

  // Towns that got no label still say "people live here": small dots, clear
  // of the star and of each other's labels' dots.
  let extraDots = 0;
  for (const city of candidates) {
    if (extraDots >= MAX_EXTRA_TOWN_DOTS) break;
    if (labelled.has(city.id)) continue;
    const point = project(city.lon, city.lat);
    const clearOfStar =
      Math.hypot(point.x - epicenterPoint.x, point.y - epicenterPoint.y) >
      STAR_RADIUS + 16;
    const inside =
      point.x > frame.x + 16 &&
      point.x < frame.x + frame.width - 16 &&
      point.y > frame.y + 16 &&
      point.y < frame.y + frame.height - 16;
    if (clearOfStar && inside) {
      towns.push({ x: point.x, y: point.y, radius: EXTRA_TOWN_DOT_RADIUS });
      extraDots += 1;
    }
  }

  // Scale: pixels per kilometre at the map's own scale (the projector is
  // uniform, so one number serves both axes).
  const pxPerKm = frame.height / ((bounds.maxLat - bounds.minLat) * KM_PER_DEGREE);
  const kmLabel = (km: number) =>
    `${localizeDigits(String(km), locale)} ${strings.kmUnit}`;

  const star = starVertices(epicenterPoint.x, epicenterPoint.y, STAR_RADIUS)
    .map(([x, y]) => `${r1(x)},${r1(y)}`)
    .join(" ");

  const drawnBands: CardBand[] = bands.map((band) => ({
    d: bandPath(band, project),
    fill: colors.intensity[band.level] ?? colors.intensity[1] ?? brand,
    level: band.level,
  }));

  // Without a shakemap the map would be nearly empty, so it gets distance
  // rings round the epicentre (a classic epicentre-map element, and an honest
  // statement of scale). With a shakemap the bands already do that job.
  const rings: CardRing[] = [];
  if (drawnBands.length === 0) {
    const reach = Math.min(frame.height / 2 - 24, frame.width / 2 - 24);
    const radii = RING_KM.filter(
      (km) => km * pxPerKm >= MIN_RING_PX && km * pxPerKm <= reach,
    );
    for (const km of radii.slice(0, MAX_RINGS)) {
      rings.push({ cx: epicenterPoint.x, cy: epicenterPoint.y, r: km * pxPerKm });
      labels.push(
        textItem(rtl, {
          text: kmLabel(km),
          x: r1(epicenterPoint.x),
          y: r1(epicenterPoint.y - km * pxPerKm - 8),
          size: SCALE_LABEL_SIZE,
          weight: 400,
          fill: colors.text.secondary,
          anchor: "middle",
          rtl: false,
          halo: { stroke: "#FFFFFF", width: 7 },
        }),
      );
    }
  }

  const map: CardMap = {
    frame,
    background: frame.fill,
    bandOpacity: BAND_OPACITY,
    bands: drawnBands.filter((band) => band.d !== ""),
    lines: mapLines(project, bounds, colors),
    rings,
    ringStyle: { stroke: colors.text.secondary, width: 2, opacity: 0.55, dash: "4 10" },
    towns,
    townDot: { fill: colors.text.primary, halo: "#FFFFFF" },
    labels,
    star: { points: star, fill: colors.status.danger, stroke: "#FFFFFF", strokeWidth: 4 },
    bounds,
  };

  // --- automatic-estimate pill -------------------------------------------
  const overlay: CardRect[] = [];
  if (strings.automaticNote && drawnBands.length > 0) {
    const pillHeight = 46;
    const pillWidth = estimateTextWidth(strings.automaticNote, PILL_SIZE, 700) + 62;
    const pillX = rtl ? frame.x + frame.width - 20 - pillWidth : frame.x + 20;
    const pillY = frame.y + 20;
    overlay.push({
      x: pillX,
      y: pillY,
      width: pillWidth,
      height: pillHeight,
      radius: pillHeight / 2,
      fill: "#FFFFFF",
      opacity: 0.94,
      stroke: { color: colors.status.warning, width: 2 },
    });
    // The dot sits at the reading-start side of the text.
    const dotInset = 22;
    overlay.push({
      x: rtl ? pillX + pillWidth - dotInset - 12 : pillX + dotInset - 6,
      y: pillY + pillHeight / 2 - 6,
      width: 12,
      height: 12,
      radius: 6,
      fill: colors.status.warning,
    });
    texts.push(
      textItem(rtl, {
        text: strings.automaticNote,
        x: rtl ? pillX + pillWidth - dotInset - 12 - 12 : pillX + dotInset + 12 + 4,
        y: pillY + pillHeight / 2 + PILL_SIZE * 0.35,
        size: PILL_SIZE,
        weight: 700,
        fill: colors.text.primary,
        anchor: startAnchor,
      }),
    );
  }

  // --- scale bar: the largest round distance under a fifth of the width -----
  const scaleKm = [...NICE_KM].reverse().find((km) => km * pxPerKm <= frame.width / 5);
  if (scaleKm !== undefined) {
    const barWidth = scaleKm * pxPerKm;
    const barLeft = rtl ? frame.x + 24 : frame.x + frame.width - 24 - barWidth;
    const barY = frame.y + frame.height - 26;
    const barColor = colors.text.secondary;
    overlay.push(
      { x: barLeft, y: barY, width: barWidth, height: 4, radius: 2, fill: barColor },
      { x: barLeft, y: barY - 10, width: 4, height: 14, radius: 2, fill: barColor },
      {
        x: barLeft + barWidth - 4,
        y: barY - 10,
        width: 4,
        height: 14,
        radius: 2,
        fill: barColor,
      },
    );
    texts.push(
      textItem(rtl, {
        text: kmLabel(scaleKm),
        x: r1(barLeft + barWidth / 2),
        y: r1(barY - 18),
        size: SCALE_LABEL_SIZE,
        weight: 400,
        fill: barColor,
        anchor: "middle",
        rtl: false,
        halo: { stroke: "#FFFFFF", width: 7 },
      }),
    );
  }

  // --- footer --------------------------------------------------------------
  // The brand colour carries on through the story's bottom strip.
  underlay.push({
    x: 0,
    y: footerTop,
    width,
    height: height - footerTop,
    radius: 0,
    fill: brand,
  });
  if (story) {
    underlay.push({ x: 0, y: 0, width, height: topBar, radius: 0, fill: brand });
  }
  const markScale = FOOTER_MARK_WIDTH / 548;
  const markHeight = 190 * markScale;
  const markX = rtl ? width - MARGIN - FOOTER_MARK_WIDTH : MARGIN;
  const markY = footerTop + (FOOTER_HEIGHT - markHeight) / 2;
  const footerTextOffset = FOOTER_MARK_WIDTH + 30;
  const footerTextWidth = contentWidth - footerTextOffset;
  texts.push(
    textItem(rtl, {
      text: strings.siteText,
      x: inward(footerTextOffset),
      y: footerTop + 44,
      size: 34,
      weight: 700,
      fill: "#FFFFFF",
      anchor: startAnchor,
      rtl: false,
    }),
  );
  texts.push(
    textItem(rtl, {
      text: strings.credit,
      x: inward(footerTextOffset),
      y: footerTop + 80,
      size: fitFontSize(strings.credit, 23, 400, footerTextWidth, 16),
      weight: 400,
      fill: "#FFFFFF",
      opacity: 0.86,
      anchor: startAnchor,
    }),
  );

  return {
    size,
    width,
    height,
    rtl,
    background: colors.surface.base,
    underlay,
    map,
    overlay,
    legendChips,
    mark: {
      x: markX,
      y: markY,
      scale: markScale,
      fill: "#FFFFFF",
    },
    qr,
    texts,
  };
}
