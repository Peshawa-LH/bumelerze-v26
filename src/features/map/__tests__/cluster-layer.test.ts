import {
  buildClusterCircleLayer,
  buildClusterCountLayer,
  buildClusterFeatureCollection,
  buildClusterSource,
  CLUSTER_CIRCLE_LAYER_ID,
  CLUSTER_COUNT_LAYER_ID,
  CLUSTER_SOURCE_ID,
  EMPTY_CLUSTER_FEATURE_COLLECTION,
  readClusterBoundsFromProperties,
} from "../cluster-layer";
import type { ClusterMarkerFeature } from "../clustering";

function makeCluster(overrides: Partial<ClusterMarkerFeature> = {}): ClusterMarkerFeature {
  return {
    kind: "cluster",
    id: "cluster-a-b",
    lon: 45.43,
    lat: 35.56,
    count: 4,
    diameterPx: 40,
    bounds: { minLon: 45.4, maxLon: 45.5, minLat: 35.5, maxLat: 35.6 },
    ...overrides,
  };
}

describe("buildClusterFeatureCollection", () => {
  it("builds one Point feature per cluster, with bounds/count/radius flattened onto properties", () => {
    const collection = buildClusterFeatureCollection([makeCluster()], "en");
    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features).toHaveLength(1);
    const [feature] = collection.features;
    expect(feature?.geometry).toEqual({ type: "Point", coordinates: [45.43, 35.56] });
    expect(feature?.properties).toMatchObject({
      count: 4,
      radiusPx: 20,
      minLon: 45.4,
      maxLon: 45.5,
      minLat: 35.5,
      maxLat: 35.6,
    });
  });

  it("localizes the count label per locale (Eastern Arabic-Indic for ckb/ar, Latin otherwise)", () => {
    const [enFeature] = buildClusterFeatureCollection(
      [makeCluster({ count: 12 })],
      "en",
    ).features;
    const [ckbFeature] = buildClusterFeatureCollection(
      [makeCluster({ count: 12 })],
      "ckb",
    ).features;
    expect(enFeature?.properties.countLabel).toBe("12");
    expect(ckbFeature?.properties.countLabel).toBe("١٢");
  });

  it("returns an empty feature collection for no clusters", () => {
    expect(buildClusterFeatureCollection([], "en")).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });
});

describe("buildClusterSource / layer builders", () => {
  it("defaults to the empty feature collection when no data is passed", () => {
    expect(buildClusterSource()).toEqual({
      type: "geojson",
      data: EMPTY_CLUSTER_FEATURE_COLLECTION,
    });
  });

  it("the circle layer reads its radius/color straight from feature properties and the given theme colors", () => {
    const layer = buildClusterCircleLayer("#123456", "#abcdef");
    expect(layer.id).toBe(CLUSTER_CIRCLE_LAYER_ID);
    expect(layer.source).toBe(CLUSTER_SOURCE_ID);
    expect(layer.paint?.["circle-radius"]).toEqual(["get", "radiusPx"]);
    expect(layer.paint?.["circle-color"]).toBe("#123456");
    expect(layer.paint?.["circle-stroke-color"]).toBe("#abcdef");
  });

  it("the count layer shows the localized countLabel property using the caller's font stack", () => {
    const layer = buildClusterCountLayer("#ffffff", ["Noto Sans Bold"]);
    expect(layer.id).toBe(CLUSTER_COUNT_LAYER_ID);
    expect(layer.source).toBe(CLUSTER_SOURCE_ID);
    expect(layer.layout?.["text-field"]).toEqual(["get", "countLabel"]);
    expect(layer.layout?.["text-font"]).toEqual(["Noto Sans Bold"]);
    expect(layer.paint?.["text-color"]).toBe("#ffffff");
  });
});

describe("readClusterBoundsFromProperties", () => {
  it("extracts a RegionBbox from a well-formed properties object", () => {
    expect(
      readClusterBoundsFromProperties({
        minLon: 1,
        maxLon: 2,
        minLat: 3,
        maxLat: 4,
        count: 5,
      }),
    ).toEqual({ minLon: 1, maxLon: 2, minLat: 3, maxLat: 4 });
  });

  it("returns null for missing/non-numeric fields, null, or non-object input", () => {
    expect(readClusterBoundsFromProperties(null)).toBeNull();
    expect(readClusterBoundsFromProperties(undefined)).toBeNull();
    expect(readClusterBoundsFromProperties("not an object")).toBeNull();
    expect(readClusterBoundsFromProperties({ minLon: 1, maxLon: 2 })).toBeNull();
    expect(
      readClusterBoundsFromProperties({
        minLon: "1",
        maxLon: 2,
        minLat: 3,
        maxLat: 4,
      }),
    ).toBeNull();
  });
});
