/**
 * Deterministic city-label decluttering for `ShakeMapView` (ui-backlog.md
 * item 7 — "city labels collide near the epicenter"). No physics engine,
 * no iterative relaxation: a single greedy pass over the already-priority-
 * ordered city list (`pickMapCities`'s HomeBase-subset-then-distance
 * order), in SVG pixel space, that either places a label or skips it.
 * Every input here is a plain number/string so this module has zero
 * dependency on `react-native-svg`, the gazetteer, or i18n — `ShakeMapView`
 * resolves localized names and projects lon/lat to pixels first, then hands
 * this module the resulting candidate list.
 */

export interface ProjectedPoint {
  x: number;
  y: number;
}

export interface LabelCandidate {
  id: string;
  /** The city's dot position, already projected to SVG pixel space —
   * always rendered regardless of whether its label is placed. */
  dot: ProjectedPoint;
  /** Localized display text — used only to estimate the label's on-screen
   * bounding box (see `LABEL_CHAR_WIDTH_PX`), never rendered by this
   * module itself. */
  text: string;
}

export type TextAnchor = "start" | "end";

export interface PlacedLabel {
  id: string;
  dot: ProjectedPoint;
  /** Where the label's text should be drawn (an SVG `<text x y>` point). */
  anchor: ProjectedPoint;
  /** SVG `text-anchor`: "start" grows the text rightward from `anchor`
   * (dot was left-of-center, label pushed right stays wrong side — see
   * `resolveSide`), "end" grows it leftward. Always "start"/"end", never
   * "middle" — this map never mirrors under RTL (design-language.md §5),
   * so the anchor convention is locale-independent. */
  textAnchor: TextAnchor;
}

interface AxisAlignedBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Minimum distance (px) a city's own dot must be from the epicenter
 * marker before its label is even attempted — inside this radius there's
 * no room to offset a label without it sitting directly on top of the
 * epicenter icon, so the label is dropped outright (the dot itself still
 * renders; only the text is skipped). Sized around `ShakeMapView`'s
 * epicenter marker (7px radius circle + 3px halo stroke) plus a small
 * buffer. */
export const EPICENTER_LABEL_EXCLUSION_RADIUS_PX = 16;

/** Fixed gap (px) between a city's dot and where its label text starts. */
export const LABEL_DOT_OFFSET_PX = 6;

/** Rough average glyph width (px) at `ShakeMapView`'s 9px label font size —
 * used only to estimate a label's bounding box for collision purposes, not
 * for actual text layout (SVG has no text-measurement API available at
 * this layer). Deliberately generous (real glyphs average narrower) so the
 * estimate errs toward skipping a borderline-tight label rather than
 * letting two labels visibly overlap. */
const LABEL_CHAR_WIDTH_PX = 5.5;

/** Estimated label line height (px), same rationale as the char-width
 * constant above. */
const LABEL_HEIGHT_PX = 11;

/** Small breathing-room margin (px) added around every label's estimated
 * bounding box before collision-testing it against others, so accepted
 * labels end up with a bit of visible gap rather than just-touching. */
const LABEL_PADDING_PX = 2;

function boxesOverlap(a: AxisAlignedBox, b: AxisAlignedBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function distance(a: ProjectedPoint, b: ProjectedPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Which side of the dot the label should extend toward: away from the
 * map's own center point, so labels fan outward rather than piling up
 * toward the middle of the map (where the epicenter and its cluster of
 * nearby cities already are). Horizontal-only (never above/below) — text
 * reads left-to-right regardless of locale (this map never mirrors), so a
 * horizontal offset is what actually separates two adjacent labels; a dot
 * exactly on the vertical center line defaults to the right, an arbitrary
 * but deterministic tie-break. */
function resolveSide(dot: ProjectedPoint, mapCenter: ProjectedPoint): TextAnchor {
  return dot.x < mapCenter.x ? "end" : "start";
}

function labelBox(
  anchor: ProjectedPoint,
  textAnchor: TextAnchor,
  text: string,
): AxisAlignedBox {
  const width = Math.max(text.length, 1) * LABEL_CHAR_WIDTH_PX;
  const halfHeight = LABEL_HEIGHT_PX / 2;

  const [minX, maxX] =
    textAnchor === "start" ? [anchor.x, anchor.x + width] : [anchor.x - width, anchor.x];

  return {
    minX: minX - LABEL_PADDING_PX,
    maxX: maxX + LABEL_PADDING_PX,
    minY: anchor.y - halfHeight - LABEL_PADDING_PX,
    maxY: anchor.y + halfHeight + LABEL_PADDING_PX,
  };
}

/** Circle-vs-box overlap (epicenter exclusion zone vs. a candidate box),
 * via closest-point-on-box-to-circle-center — standard AABB/circle test. */
function boxIntersectsCircle(
  box: AxisAlignedBox,
  center: ProjectedPoint,
  radius: number,
): boolean {
  const closestX = Math.min(Math.max(center.x, box.minX), box.maxX);
  const closestY = Math.min(Math.max(center.y, box.minY), box.maxY);
  return distance({ x: closestX, y: closestY }, center) <= radius;
}

/**
 * Greedy label placement, one pass over `candidates` in the order given
 * (the caller's existing priority order — `pickMapCities`'s HomeBase-
 * subset-then-nearest ordering is what `ShakeMapView` passes in, so this
 * function never re-sorts, it only accepts or skips in that order):
 *
 * 1. Drop any candidate whose OWN dot sits inside the epicenter's
 *    exclusion radius — no offset can rescue a label for a city that's
 *    right on top of the epicenter.
 * 2. Offset the label to whichever side of the dot points away from the
 *    map's own center (`resolveSide`).
 * 3. Estimate that label's bounding box and skip it if it overlaps the
 *    epicenter marker's own footprint or any already-accepted label's
 *    box — otherwise accept it.
 *
 * The result is never longer than `candidates` (callers already cap the
 * candidate list itself, e.g. `SHAKEMAP_MAX_CITIES` — this function's job
 * is only to drop what doesn't fit, not to pad back up to a target count).
 */
export function layoutCityLabels(
  candidates: readonly LabelCandidate[],
  epicenter: ProjectedPoint,
  mapCenter: ProjectedPoint,
): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const placedBoxes: AxisAlignedBox[] = [];

  for (const candidate of candidates) {
    if (distance(candidate.dot, epicenter) < EPICENTER_LABEL_EXCLUSION_RADIUS_PX) {
      continue;
    }

    const textAnchor = resolveSide(candidate.dot, mapCenter);
    const offsetX =
      textAnchor === "start"
        ? candidate.dot.x + LABEL_DOT_OFFSET_PX
        : candidate.dot.x - LABEL_DOT_OFFSET_PX;
    const anchor: ProjectedPoint = { x: offsetX, y: candidate.dot.y };
    const box = labelBox(anchor, textAnchor, candidate.text);

    if (boxIntersectsCircle(box, epicenter, EPICENTER_LABEL_EXCLUSION_RADIUS_PX)) {
      continue;
    }
    if (placedBoxes.some((existing) => boxesOverlap(box, existing))) {
      continue;
    }

    placed.push({ id: candidate.id, dot: candidate.dot, anchor, textAnchor });
    placedBoxes.push(box);
  }

  return placed;
}
