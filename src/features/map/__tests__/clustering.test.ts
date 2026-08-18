import type { Event } from "@/features/events";
import {
  CLUSTER_EXPANSION_ZOOM_MARGIN,
  CLUSTER_LIST_MAX_SIZE,
  CLUSTER_MAX_DIAMETER_PX,
  CLUSTER_MAX_ZOOM,
  CLUSTER_MIN_DIAMETER_PX,
  CLUSTER_MIN_SIZE,
  clusterRegionMarkers,
  resolveClusterExpansionZoom,
  sortClusterMembersForList,
  type ClusterMarkerFeature,
  type PointMarkerFeature,
} from "../clustering";

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "us7000abcd",
    originTime: Date.UTC(2026, 7, 15, 12, 0, 0),
    lat: 35.56,
    lon: 45.43,
    depthKm: 10,
    magnitude: { value: 4.5, type: "mb" },
    placeName: "32 km SE of Halabja, Iraq",
    provenance: {
      provider: "usgs",
      providerId: "us7000abcd",
      fetchedAt: Date.now(),
      providerUpdatedAt: Date.now(),
    },
    sig: 300,
    isRegional: true,
    url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd",
    ...overrides,
  };
}

const KURDISTAN_ZOOM = 5;

describe("clusterRegionMarkers", () => {
  it("returns an empty array for an empty feed", () => {
    expect(clusterRegionMarkers([], KURDISTAN_ZOOM)).toEqual([]);
  });

  it("a single event is always a standalone, most-recent point", () => {
    const event = makeEvent({ id: "solo" });
    const [feature] = clusterRegionMarkers([event], KURDISTAN_ZOOM);
    expect(feature).toMatchObject({ kind: "point", id: "solo", isMostRecent: true });
  });

  it("groups 3+ co-located events (at/above the minimum cluster size) into one cluster below the max zoom", () => {
    const events = [
      makeEvent({ id: "a", lat: 35.56, lon: 45.43 }),
      makeEvent({ id: "b", lat: 35.56, lon: 45.43 }),
      makeEvent({ id: "c", lat: 35.56, lon: 45.43 }),
    ];
    const features = clusterRegionMarkers(events, KURDISTAN_ZOOM);
    expect(features).toHaveLength(1);
    const [cluster] = features as [ClusterMarkerFeature];
    expect(cluster.kind).toBe("cluster");
    expect(cluster.count).toBe(3);
  });

  it("never groups a pair of only 2 co-located events into a cluster badge, however close, below the minimum cluster size", () => {
    // Regression: a badge standing in for just 2 events costs a tap and
    // hides which events they are, for no readability win two adjacent
    // markers wouldn't already have (CLUSTER_MIN_SIZE's doc comment).
    const events = [
      makeEvent({ id: "a", lat: 35.56, lon: 45.43 }),
      makeEvent({ id: "b", lat: 35.56, lon: 45.43 }),
    ];
    const features = clusterRegionMarkers(events, KURDISTAN_ZOOM);
    expect(features).toHaveLength(2);
    expect(features.every((feature) => feature.kind === "point")).toBe(true);
  });

  it("respects an explicit minSize override", () => {
    const events = [
      makeEvent({ id: "a", lat: 35.56, lon: 45.43 }),
      makeEvent({ id: "b", lat: 35.56, lon: 45.43 }),
    ];
    const features = clusterRegionMarkers(events, KURDISTAN_ZOOM, { minSize: 2 });
    expect(features).toHaveLength(1);
    expect(features[0]?.kind).toBe("cluster");
  });

  it("keeps events far apart as separate standalone points at the same zoom", () => {
    const events = [
      makeEvent({ id: "a", lat: 35.56, lon: 45.43 }),
      // ~20 degrees of longitude away — projects hundreds of px apart even
      // at a zoomed-out level 5, comfortably beyond the default cluster
      // radius.
      makeEvent({ id: "b", lat: 35.56, lon: 65.43 }),
    ];
    const features = clusterRegionMarkers(events, KURDISTAN_ZOOM);
    expect(features).toHaveLength(2);
    expect(features.every((feature) => feature.kind === "point")).toBe(true);
  });

  it("splits apart into individual points at/above the max zoom regardless of density", () => {
    const events = [
      makeEvent({ id: "a", lat: 35.56, lon: 45.43 }),
      makeEvent({ id: "b", lat: 35.56, lon: 45.43 }),
      makeEvent({ id: "c", lat: 35.56, lon: 45.43 }),
    ];
    const clusteredBelow = clusterRegionMarkers(events, CLUSTER_MAX_ZOOM - 1);
    expect(clusteredBelow).toHaveLength(1);
    expect(clusteredBelow[0]?.kind).toBe("cluster");

    const individualAtMax = clusterRegionMarkers(events, CLUSTER_MAX_ZOOM);
    expect(individualAtMax).toHaveLength(3);
    expect(individualAtMax.every((feature) => feature.kind === "point")).toBe(true);

    const individualAboveMax = clusterRegionMarkers(events, CLUSTER_MAX_ZOOM + 4);
    expect(individualAboveMax).toHaveLength(3);
    expect(individualAboveMax.every((feature) => feature.kind === "point")).toBe(true);
  });

  it("marks only the single most-recent standalone event as isMostRecent", () => {
    const events = [
      makeEvent({ id: "old", lat: 30, lon: 30, originTime: 1000 }),
      makeEvent({ id: "new", lat: -10, lon: -80, originTime: 5000 }),
      makeEvent({ id: "mid", lat: 60, lon: 150, originTime: 3000 }),
    ];
    const features = clusterRegionMarkers(events, KURDISTAN_ZOOM) as PointMarkerFeature[];
    expect(features).toHaveLength(3);
    const byId = new Map(features.map((feature) => [feature.id, feature]));
    expect(byId.get("new")?.isMostRecent).toBe(true);
    expect(byId.get("old")?.isMostRecent).toBe(false);
    expect(byId.get("mid")?.isMostRecent).toBe(false);
  });

  it("cluster bounds are never degenerate, even for exactly co-located members", () => {
    const events = [
      makeEvent({ id: "a", lat: 35.56, lon: 45.43 }),
      makeEvent({ id: "b", lat: 35.56, lon: 45.43 }),
      makeEvent({ id: "c", lat: 35.56, lon: 45.43 }),
    ];
    const [cluster] = clusterRegionMarkers(events, KURDISTAN_ZOOM) as [ClusterMarkerFeature];
    expect(cluster.bounds.maxLon).toBeGreaterThan(cluster.bounds.minLon);
    expect(cluster.bounds.maxLat).toBeGreaterThan(cluster.bounds.minLat);
  });

  it("cluster bounds cover every member's actual coordinates when they're spread within the radius", () => {
    const events = [
      makeEvent({ id: "a", lat: 35.5, lon: 45.4 }),
      makeEvent({ id: "b", lat: 35.51, lon: 45.41 }),
      makeEvent({ id: "c", lat: 35.52, lon: 45.42 }),
    ];
    const [cluster] = clusterRegionMarkers(events, KURDISTAN_ZOOM) as [ClusterMarkerFeature];
    expect(cluster.bounds.minLat).toBeLessThanOrEqual(35.5);
    expect(cluster.bounds.maxLat).toBeGreaterThanOrEqual(35.52);
    expect(cluster.bounds.minLon).toBeLessThanOrEqual(45.4);
    expect(cluster.bounds.maxLon).toBeGreaterThanOrEqual(45.42);
  });

  it("cluster diameter grows with member count, clamped to the configured range", () => {
    const smallMembers = [
      makeEvent({ id: "a", lat: 35.56, lon: 45.43 }),
      makeEvent({ id: "b", lat: 35.56, lon: 45.43 }),
      makeEvent({ id: "c", lat: 35.56, lon: 45.43 }),
    ];
    const manyMembers = Array.from({ length: 25 }, (_, index) =>
      makeEvent({ id: `many-${index}`, lat: 35.56, lon: 45.43 }),
    );

    const [smallCluster] = clusterRegionMarkers(smallMembers, KURDISTAN_ZOOM) as [
      ClusterMarkerFeature,
    ];
    const [bigCluster] = clusterRegionMarkers(manyMembers, KURDISTAN_ZOOM) as [
      ClusterMarkerFeature,
    ];

    expect(smallCluster.diameterPx).toBeGreaterThanOrEqual(CLUSTER_MIN_DIAMETER_PX);
    expect(bigCluster.diameterPx).toBeLessThanOrEqual(CLUSTER_MAX_DIAMETER_PX);
    expect(bigCluster.diameterPx).toBeGreaterThan(smallCluster.diameterPx);
  });

  it("respects an explicit radiusPx override (0 never groups distinct coordinates)", () => {
    const events = [
      makeEvent({ id: "a", lat: 35.5, lon: 45.4 }),
      makeEvent({ id: "b", lat: 35.52, lon: 45.42 }),
    ];
    const features = clusterRegionMarkers(events, KURDISTAN_ZOOM, { radiusPx: 0 });
    expect(features).toHaveLength(2);
    expect(features.every((feature) => feature.kind === "point")).toBe(true);
  });

  it("respects an explicit maxZoom override", () => {
    const events = [
      makeEvent({ id: "a", lat: 35.56, lon: 45.43 }),
      makeEvent({ id: "b", lat: 35.56, lon: 45.43 }),
    ];
    const features = clusterRegionMarkers(events, 3, { maxZoom: 2 });
    expect(features).toHaveLength(2);
    expect(features.every((feature) => feature.kind === "point")).toBe(true);
  });

  it("CLUSTER_MIN_SIZE is the conventional minimum of 3", () => {
    expect(CLUSTER_MIN_SIZE).toBe(3);
  });

  it("exposes each cluster's member event ids, so a caller can resolve real Event data for a list-mode sheet", () => {
    const events = [
      makeEvent({ id: "a", lat: 35.56, lon: 45.43 }),
      makeEvent({ id: "b", lat: 35.56, lon: 45.43 }),
      makeEvent({ id: "c", lat: 35.56, lon: 45.43 }),
    ];
    const [cluster] = clusterRegionMarkers(events, KURDISTAN_ZOOM) as [ClusterMarkerFeature];
    expect([...cluster.memberIds].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("sortClusterMembersForList", () => {
  it("orders members most-recently-originated first", () => {
    const events = [
      makeEvent({ id: "old", originTime: 1000 }),
      makeEvent({ id: "newest", originTime: 5000 }),
      makeEvent({ id: "mid", originTime: 3000 }),
    ];
    const sorted = sortClusterMembersForList(events);
    expect(sorted.map((event) => event.id)).toEqual(["newest", "mid", "old"]);
  });

  it("never mutates the input array", () => {
    const events = [makeEvent({ id: "a", originTime: 1000 }), makeEvent({ id: "b", originTime: 2000 })];
    const original = [...events];
    sortClusterMembersForList(events);
    expect(events).toEqual(original);
  });
});

describe("CLUSTER_LIST_MAX_SIZE", () => {
  it("is comfortably above the minimum cluster size, so most real clusters get list treatment", () => {
    expect(CLUSTER_LIST_MAX_SIZE).toBeGreaterThan(CLUSTER_MIN_SIZE);
  });
});

describe("resolveClusterExpansionZoom", () => {
  it("uses the natural fit zoom as-is when it already clears the cutoff", () => {
    expect(resolveClusterExpansionZoom(CLUSTER_MAX_ZOOM + 3, CLUSTER_MAX_ZOOM)).toBe(
      CLUSTER_MAX_ZOOM + 3,
    );
  });

  it("uses the natural fit zoom as-is when it lands exactly on the cutoff", () => {
    expect(resolveClusterExpansionZoom(CLUSTER_MAX_ZOOM, CLUSTER_MAX_ZOOM)).toBe(CLUSTER_MAX_ZOOM);
  });

  it("forces the zoom past the cutoff, by the configured margin, when the natural fit falls short — this is what guarantees a cluster tap always makes progress", () => {
    const naturalZoom = CLUSTER_MAX_ZOOM - 3;
    const resolved = resolveClusterExpansionZoom(naturalZoom, CLUSTER_MAX_ZOOM);
    expect(resolved).toBeGreaterThan(CLUSTER_MAX_ZOOM);
    expect(resolved).toBe(CLUSTER_MAX_ZOOM + CLUSTER_EXPANSION_ZOOM_MARGIN);
  });

  it("forces progress even for a badly-spread cluster whose fit zoom is very low (e.g. a wide, whole-region cluster)", () => {
    const resolved = resolveClusterExpansionZoom(0, CLUSTER_MAX_ZOOM);
    expect(resolved).toBeGreaterThan(CLUSTER_MAX_ZOOM);
  });

  it("respects an explicit margin override", () => {
    expect(resolveClusterExpansionZoom(2, 8, 1.5)).toBe(9.5);
  });
});
