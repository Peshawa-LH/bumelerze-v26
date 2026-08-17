import type { Event } from "@/features/events";
import {
  CLUSTER_MAX_DIAMETER_PX,
  CLUSTER_MAX_ZOOM,
  CLUSTER_MIN_DIAMETER_PX,
  clusterRegionMarkers,
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

  it("groups co-located events into one cluster below the max zoom", () => {
    const events = [
      makeEvent({ id: "a", lat: 35.56, lon: 45.43 }),
      makeEvent({ id: "b", lat: 35.56, lon: 45.43 }),
    ];
    const features = clusterRegionMarkers(events, KURDISTAN_ZOOM);
    expect(features).toHaveLength(1);
    const [cluster] = features as [ClusterMarkerFeature];
    expect(cluster.kind).toBe("cluster");
    expect(cluster.count).toBe(2);
  });

  it("keeps events far apart as separate standalone points at the same zoom", () => {
    const events = [
      makeEvent({ id: "a", lat: 35.56, lon: 45.43 }),
      // ~20 degrees of longitude away — projects hundreds of px apart even
      // at a zoomed-out level 5, comfortably beyond the default cluster
      // radius (48px).
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
    ];
    const [cluster] = clusterRegionMarkers(events, KURDISTAN_ZOOM) as [ClusterMarkerFeature];
    expect(cluster.bounds.maxLon).toBeGreaterThan(cluster.bounds.minLon);
    expect(cluster.bounds.maxLat).toBeGreaterThan(cluster.bounds.minLat);
  });

  it("cluster bounds cover every member's actual coordinates when they're spread within the radius", () => {
    const events = [
      makeEvent({ id: "a", lat: 35.5, lon: 45.4 }),
      makeEvent({ id: "b", lat: 35.52, lon: 45.42 }),
    ];
    const [cluster] = clusterRegionMarkers(events, KURDISTAN_ZOOM) as [ClusterMarkerFeature];
    expect(cluster.bounds.minLat).toBeLessThanOrEqual(35.5);
    expect(cluster.bounds.maxLat).toBeGreaterThanOrEqual(35.52);
    expect(cluster.bounds.minLon).toBeLessThanOrEqual(45.4);
    expect(cluster.bounds.maxLon).toBeGreaterThanOrEqual(45.42);
  });

  it("cluster diameter grows with member count, clamped to the configured range", () => {
    const twoMembers = [
      makeEvent({ id: "a", lat: 35.56, lon: 45.43 }),
      makeEvent({ id: "b", lat: 35.56, lon: 45.43 }),
    ];
    const manyMembers = Array.from({ length: 25 }, (_, index) =>
      makeEvent({ id: `many-${index}`, lat: 35.56, lon: 45.43 }),
    );

    const [smallCluster] = clusterRegionMarkers(twoMembers, KURDISTAN_ZOOM) as [
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
});
