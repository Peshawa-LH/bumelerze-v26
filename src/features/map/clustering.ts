/**
 * Pure event clustering for the web map (Problem 2: "markers overlap into
 * an unreadable blob"). Around Kurdistan the region feed's event density
 * makes magnitude-scaled circles pile on top of each other at low zoom —
 * this module groups nearby events into cluster badges below a max zoom,
 * splitting them back into individual points as the user zooms in.
 *
 * DELIBERATELY NOT MapLibre's native `cluster: true` GeoJSON-source option
 * (the architecture note's own "recommended approach" mentions it) — a
 * self-contained, independently-tested pure function was chosen instead,
 * for two concrete reasons specific to this codebase:
 *
 *  1. Testability without WebGL. Every map test in this app exercises
 *     `map.web.tsx` against a fully mocked `maplibre-gl` module (no real
 *     tile/canvas/worker pipeline — see `map-web-creation.test.tsx`'s doc
 *     comment). MapLibre's native clustering is implemented by a real
 *     supercluster index built and queried INSIDE the library's own source
 *     internals; there is no seam to drive "clusters form below a zoom
 *     threshold, split apart above it" as a deterministic unit test against
 *     that mock without reimplementing supercluster inside the mock itself.
 *     This module makes exactly that behavior a plain, synchronously
 *     testable function of `(events, zoom)` — see `clustering.test.ts`.
 *  2. One source of truth for two different renderers. The unclustered
 *     points here need to drive real DOM `maplibregl.Marker`s (kept for
 *     accessibility — see `map.web.tsx`'s marker-build effect), while the
 *     clustered groups drive a GL circle/count layer. Computing the split
 *     ourselves means both renderers work from the SAME grouping decision
 *     in the SAME render pass, rather than the DOM layer trying to infer
 *     "is this event currently swallowed into a cluster?" via an async,
 *     eventually-consistent query against MapLibre's own live cluster index
 *     (`querySourceFeatures`), which has no natural point to hook for a
 *     freshly-set `data` before the source has re-tiled.
 *
 * At this app's actual data volume (region/world pools are low hundreds of
 * events at most, `marker-helpers.ts`'s own doc comment), a simple O(n²)
 * greedy grouping is cheap enough to redo on every zoom change — no
 * incremental/hierarchical index needed.
 *
 * Two invariants this module enforces so a cluster badge is never a dead
 * end: (1) groups below `CLUSTER_MIN_SIZE` render as plain standalone
 * points, never a one/two-member badge that costs a tap for no readability
 * win; (2) `resolveClusterExpansionZoom` guarantees a tapped badge's forced
 * camera move always clears `CLUSTER_MAX_ZOOM`, so the tap always visibly
 * splits the group apart rather than possibly re-landing on the same badge.
 */
import { magnitudeTone, type Event, type MagnitudeTone } from "@/features/events";
import { MARKER_HIT_PADDING_PX, MARKER_MAX_DIAMETER_PX } from "./config";
import type { RegionBbox } from "./marker-helpers";
import { magnitudeToMarkerDiameterPx } from "./marker-helpers";

/** The largest a single marker's own TAP target ever gets — the biggest
 * magnitude-scaled dot (`MARKER_MAX_DIAMETER_PX`) plus its hit-padding halo
 * on each side (`MARKER_HIT_PADDING_PX`, config.ts). Two markers whose
 * centers are exactly this far apart have their hit targets just touching —
 * the threshold past which showing them as two separate markers starts
 * costing tap accuracy instead of helping it. */
const MAX_MARKER_HIT_RADIUS_PX = MARKER_MAX_DIAMETER_PX / 2 + MARKER_HIT_PADDING_PX;

/** Screen-pixel radius (at the given zoom) within which two events are
 * grouped into the same cluster. Set to exactly the largest marker's own hit
 * radius (`MAX_MARKER_HIT_RADIUS_PX`, 27px today) rather than a wider,
 * tasted-by-eye value: that's the precise distance at which two full-size
 * markers' tap targets would start overlapping, which is the actual problem
 * clustering exists to solve (Problem 2's "overlap into an unreadable
 * blob"). A wider radius (the previous 48px, ~1.8x this) swallowed far more
 * real-world area than any marker overlap justified — at the Kurdistan
 * region's default fitted zoom (~5-6), 48px projects to well over 100km,
 * which is how a normal-density feed ended up as a single mega-cluster with
 * zero standalone markers anywhere on screen. 27px keeps the same
 * "never let markers visually collide" guarantee while clustering roughly
 * 45% less real-world area at any given zoom. */
export const CLUSTER_RADIUS_PX = MAX_MARKER_HIT_RADIUS_PX;

/** At/above this zoom, clustering stops entirely regardless of density —
 * "splitting apart as the user zooms in" (wave brief). Chosen above the
 * Kurdistan region bbox's typical initial fitted zoom on a phone viewport
 * (~5-6 for `REGION_BBOX`'s ~5.5°x7.5° extent) so the default Kurdistan
 * view clusters dense areas, while zooming in to inspect a specific town's
 * events reliably reaches individual markers. */
export const CLUSTER_MAX_ZOOM = 8;

/** Below this member count, a "cluster" hides more than it helps: a badge
 * standing in for just two events costs the user a tap (to expand it) AND
 * hides which two events it actually is, for no readability win a single
 * pair of markers wouldn't already have. 3 is the conventional minimum
 * cluster size (the same floor supercluster and most map-cluster libraries
 * default to) — below it, `clusterRegionMarkers` renders the group as plain
 * standalone points instead. */
export const CLUSTER_MIN_SIZE = 3;

/** Extra zoom, past `CLUSTER_MAX_ZOOM`, that a cluster-badge tap's forced
 * camera move (`resolveClusterExpansionZoom` below) lands on top of the
 * cutoff — not strictly required (`clusterRegionMarkers` already treats
 * `zoom >= CLUSTER_MAX_ZOOM` as "never cluster," so landing exactly ON the
 * cutoff is technically sufficient), but a small, deliberate margin makes
 * the zoom-in animation visibly register as progress even when the tapped
 * cluster's natural fit-bounds zoom sits right at the cutoff already, and
 * gives floating-point camera math a bit of headroom against the boundary. */
export const CLUSTER_EXPANSION_ZOOM_MARGIN = 0.5;

export const CLUSTER_MIN_DIAMETER_PX = 30;
export const CLUSTER_MAX_DIAMETER_PX = 54;

/** Cluster member count at which the badge reaches `CLUSTER_MAX_DIAMETER_PX`
 * — a log scale (below) means the badge grows quickly for small clusters
 * (2 -> 5 events reads as clearly bigger) and levels off for large ones,
 * rather than a linear scale where a 100-event cluster would dwarf the map. */
const CLUSTER_COUNT_FOR_MAX_DIAMETER = 30;

/** Degenerate-bounds safety margin (degrees) — see `toClusterFeature`'s
 * doc comment. */
const CLUSTER_BOUNDS_EPSILON_DEG = 0.01;

export interface ClusterMarkerFeature {
  kind: "cluster";
  id: string;
  lon: number;
  lat: number;
  count: number;
  diameterPx: number;
  /** Member events' combined extent — what a cluster-badge tap fits the
   * viewport to (`map.web.tsx`'s cluster click handler). Always a non-
   * degenerate (nonzero-area) box, even for co-located events. */
  bounds: RegionBbox;
}

export interface PointMarkerFeature {
  kind: "point";
  id: string;
  lon: number;
  lat: number;
  magnitudeValue: number;
  tone: MagnitudeTone;
  diameterPx: number;
  /** True for the single most-recently-originated event in the input set,
   * when it renders standalone (not currently swallowed into a cluster) —
   * drives the distinct "what just happened" outline (`map.web.tsx`'s
   * marker-build effect). */
  isMostRecent: boolean;
}

export type ClusteredMapMarker = ClusterMarkerFeature | PointMarkerFeature;

export interface ClusterOptions {
  radiusPx?: number;
  maxZoom?: number;
  minSize?: number;
}

interface ProjectedPoint {
  event: Event;
  x: number;
  y: number;
}

/** Spherical-Mercator lon/lat -> pixel-space projection at `zoom` (standard
 * 256px-tile convention) — the same projection every XYZ/Mercator tile
 * pyramid uses, so a fixed pixel radius reads as roughly the same on-screen
 * distance regardless of latitude, matching how a real tile-based cluster
 * index (e.g. supercluster) evaluates proximity. */
function projectToPixels(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const scale = 256 * 2 ** zoom;
  const x = ((lon + 180) / 360) * scale;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function toPointFeature(event: Event, isMostRecent: boolean): PointMarkerFeature {
  return {
    kind: "point",
    id: event.id,
    lon: event.lon,
    lat: event.lat,
    magnitudeValue: event.magnitude.value,
    tone: magnitudeTone(event.magnitude.value),
    diameterPx: magnitudeToMarkerDiameterPx(event.magnitude.value),
    isMostRecent,
  };
}

/** Count -> badge diameter, log-scaled and clamped (see
 * `CLUSTER_COUNT_FOR_MAX_DIAMETER`'s doc comment). */
function clusterDiameterPx(count: number): number {
  const ratio = Math.min(
    1,
    Math.log2(Math.max(2, count)) / Math.log2(CLUSTER_COUNT_FOR_MAX_DIAMETER),
  );
  return Math.round(
    CLUSTER_MIN_DIAMETER_PX + ratio * (CLUSTER_MAX_DIAMETER_PX - CLUSTER_MIN_DIAMETER_PX),
  );
}

function toClusterFeature(members: readonly Event[]): ClusterMarkerFeature {
  const lons = members.map((event) => event.lon);
  const lats = members.map((event) => event.lat);
  let minLon = Math.min(...lons);
  let maxLon = Math.max(...lons);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  // Every member sits at (or extremely near) the same point — `fitBounds`
  // on a zero-area box is a degenerate no-op in some MapLibre versions, so
  // pad it to a small-but-real box rather than let a same-place cluster's
  // click do nothing.
  if (maxLon - minLon < CLUSTER_BOUNDS_EPSILON_DEG) {
    minLon -= CLUSTER_BOUNDS_EPSILON_DEG;
    maxLon += CLUSTER_BOUNDS_EPSILON_DEG;
  }
  if (maxLat - minLat < CLUSTER_BOUNDS_EPSILON_DEG) {
    minLat -= CLUSTER_BOUNDS_EPSILON_DEG;
    maxLat += CLUSTER_BOUNDS_EPSILON_DEG;
  }

  const centroidLon = lons.reduce((sum, value) => sum + value, 0) / lons.length;
  const centroidLat = lats.reduce((sum, value) => sum + value, 0) / lats.length;
  const ids = members
    .map((event) => event.id)
    .sort()
    .join("-");

  return {
    kind: "cluster",
    id: `cluster-${ids}`,
    lon: centroidLon,
    lat: centroidLat,
    count: members.length,
    diameterPx: clusterDiameterPx(members.length),
    bounds: { minLon, maxLon, minLat, maxLat },
  };
}

function findMostRecentEventId(events: readonly Event[]): string | null {
  if (events.length === 0) {
    return null;
  }
  return events.reduce((latest, event) =>
    event.originTime > latest.originTime ? event : latest,
  ).id;
}

/**
 * Groups `events` into cluster/point features for the given map `zoom`.
 * Deterministic for a stable input order: a simple greedy pass (star-shaped
 * clusters around whichever unassigned event is encountered first, not a
 * mutual-nearest-neighbor algorithm) — see the module doc comment for why
 * that's a deliberate, sufficient simplification at this app's data scale.
 */
export function clusterRegionMarkers(
  events: readonly Event[],
  zoom: number,
  options: ClusterOptions = {},
): ClusteredMapMarker[] {
  if (events.length === 0) {
    return [];
  }
  const radiusPx = options.radiusPx ?? CLUSTER_RADIUS_PX;
  const maxZoom = options.maxZoom ?? CLUSTER_MAX_ZOOM;
  const minSize = options.minSize ?? CLUSTER_MIN_SIZE;
  const mostRecentId = findMostRecentEventId(events);

  if (zoom >= maxZoom) {
    return events.map((event) => toPointFeature(event, event.id === mostRecentId));
  }

  const projected: ProjectedPoint[] = events.map((event) => ({
    event,
    ...projectToPixels(event.lon, event.lat, zoom),
  }));
  const assigned = new Array<boolean>(projected.length).fill(false);
  const groups: ProjectedPoint[][] = [];

  for (let i = 0; i < projected.length; i += 1) {
    if (assigned[i]) {
      continue;
    }
    const anchor = projected[i] as ProjectedPoint;
    const group: ProjectedPoint[] = [anchor];
    assigned[i] = true;
    for (let j = i + 1; j < projected.length; j += 1) {
      if (assigned[j]) {
        continue;
      }
      const candidate = projected[j] as ProjectedPoint;
      const dx = anchor.x - candidate.x;
      const dy = anchor.y - candidate.y;
      if (Math.sqrt(dx * dx + dy * dy) <= radiusPx) {
        group.push(candidate);
        assigned[j] = true;
      }
    }
    groups.push(group);
  }

  // A group below `minSize` renders as its own standalone points, NOT a
  // cluster badge (`CLUSTER_MIN_SIZE`'s doc comment) — a badge that only
  // stands in for one or two events costs a tap and hides which events they
  // are, for no overlap-avoidance win a lone marker (or two adjacent ones)
  // wouldn't already have.
  return groups.flatMap((group): ClusteredMapMarker[] => {
    if (group.length < minSize) {
      return group.map((point) => toPointFeature(point.event, point.event.id === mostRecentId));
    }
    return [toClusterFeature(group.map((point) => point.event))];
  });
}

/**
 * A cluster-badge tap must ALWAYS make visible progress (never re-land on
 * the same badge covering the same members) — see this module's own
 * `CLUSTER_MAX_ZOOM`: `clusterRegionMarkers` treats any zoom at/above it as
 * "never cluster," so forcing the post-tap zoom to clear that cutoff is a
 * hard guarantee the tapped members split apart, independent of how far
 * apart they actually are on the ground. `naturalZoom` is whatever a plain
 * bounds-fit (`Map.cameraForBounds`) would land on for the cluster's member
 * extent; when that's already past the cutoff (a tight, nearby group), it's
 * used as-is — no need to force a bigger jump than the bounds fit already
 * gives. When it isn't (a cluster whose members are spread wide enough that
 * fitting their bounds alone doesn't clear the cutoff — exactly the "tap a
 * badge, watch it not visibly change" bug this fixes), the zoom is forced
 * to `maxZoom + CLUSTER_EXPANSION_ZOOM_MARGIN` instead.
 */
export function resolveClusterExpansionZoom(
  naturalZoom: number,
  maxZoom: number = CLUSTER_MAX_ZOOM,
  margin: number = CLUSTER_EXPANSION_ZOOM_MARGIN,
): number {
  return naturalZoom >= maxZoom ? naturalZoom : maxZoom + margin;
}
