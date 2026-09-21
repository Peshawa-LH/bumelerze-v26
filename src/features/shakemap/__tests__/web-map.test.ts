import {
  buildContourFeatureCollection,
  buildLevelColorMatchExpression,
  contourBoundsToLngLatBounds,
} from "../web-map";
import type { ContourRing } from "../types";

function ring(points: (readonly [number, number])[]): ContourRing {
  return { points };
}

describe("buildContourFeatureCollection", () => {
  it("builds one Polygon feature per ring, carrying the level and value", () => {
    const collection = buildContourFeatureCollection([
      {
        value: 6,
        level: 6,
        rings: [ring([[45, 35], [45.1, 35.1], [45.2, 35]])],
      },
    ]);

    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.properties).toEqual({ level: 6, value: 6 });
    expect(collection.features[0]?.geometry.type).toBe("Polygon");
  });

  it("closes an open ring (first point !== last point) for valid GeoJSON Polygon coordinates", () => {
    const collection = buildContourFeatureCollection([
      { value: 6, level: 6, rings: [ring([[45, 35], [45.1, 35.1], [45.2, 35]])] },
    ]);

    const coords = collection.features[0]?.geometry.coordinates[0];
    expect(coords?.[0]).toEqual(coords?.[coords.length - 1]);
    expect(coords).toHaveLength(4);
  });

  it("does not duplicate the closing point when a ring is already closed", () => {
    const collection = buildContourFeatureCollection([
      {
        value: 6,
        level: 6,
        rings: [ring([[45, 35], [45.1, 35.1], [45.2, 35], [45, 35]])],
      },
    ]);

    expect(collection.features[0]?.geometry.coordinates[0]).toHaveLength(4);
  });

  it("emits multiple features for a level with multiple rings", () => {
    const collection = buildContourFeatureCollection([
      {
        value: 6,
        level: 6,
        rings: [
          ring([[45, 35], [45.1, 35.1], [45.2, 35]]),
          ring([[46, 36], [46.1, 36.1], [46.2, 36]]),
        ],
      },
    ]);

    expect(collection.features).toHaveLength(2);
  });

  it("drops a ring with fewer than 3 points (not a real polygon)", () => {
    const collection = buildContourFeatureCollection([
      { value: 6, level: 6, rings: [ring([[45, 35], [45.1, 35.1]])] },
    ]);

    expect(collection.features).toHaveLength(0);
  });

  it("sorts levels ascending by value regardless of input order, so higher levels paint last", () => {
    const collection = buildContourFeatureCollection([
      { value: 8, level: 8, rings: [ring([[45, 35], [45.1, 35.1], [45.2, 35]])] },
      { value: 4, level: 4, rings: [ring([[46, 36], [46.1, 36.1], [46.2, 36]])] },
      { value: 6, level: 6, rings: [ring([[47, 37], [47.1, 37.1], [47.2, 37]])] },
    ]);

    expect(collection.features.map((f) => f.properties.value)).toEqual([4, 6, 8]);
  });
});

describe("buildLevelColorMatchExpression", () => {
  const ramp = ["", "#111", "#222", "#333", "#444", "#555"];

  it("builds a match expression pairing every level 1..maxLevel with its ramp color", () => {
    const expression = buildLevelColorMatchExpression(ramp, 5);

    expect(expression).toEqual([
      "match",
      ["get", "level"],
      1, "#111",
      2, "#222",
      3, "#333",
      4, "#444",
      5, "#555",
      "#111",
    ]);
  });

  it("falls back to the ramp's own index-1 color for the trailing default, never a hardcoded literal", () => {
    const expression = buildLevelColorMatchExpression(["", "#abc"], 1);
    expect(expression[expression.length - 1]).toBe("#abc");
  });
});

describe("contourBoundsToLngLatBounds", () => {
  it("converts a LonLatBoundingBox to MapLibre's [[west, south], [east, north]] tuple", () => {
    const bounds = contourBoundsToLngLatBounds({
      minLon: 44,
      maxLon: 46,
      minLat: 34,
      maxLat: 36,
    });

    expect(bounds).toEqual([[44, 34], [46, 36]]);
  });
});

describe("buildContourFeatureCollection — bands (2026-09-21)", () => {
  const square = (x: number, y: number, size: number): [number, number][] => [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
  ];

  it("emits a ring's holes as the polygon's interior rings", () => {
    const [feature] = buildContourFeatureCollection([
      {
        value: 6,
        level: 6,
        rings: [{ points: square(45, 35, 1), closed: true, holes: [square(45.2, 35.2, 0.2)] }],
      },
    ]).features;

    expect(feature?.geometry.coordinates).toHaveLength(2);
    expect(feature?.geometry.coordinates[0]).toHaveLength(5); // closed exterior
    expect(feature?.geometry.coordinates[1]).toHaveLength(5); // closed hole
  });

  it("skips an open ring instead of filling the chord that would close it", () => {
    // The far-field bug. A contour that left the producer's grid has no
    // interior; joining its last point back to its first draws across
    // open space, which is what cut wedges out of every published map.
    const { features } = buildContourFeatureCollection([
      {
        value: 5,
        level: 5,
        rings: [
          { points: square(42.7, 34, 6), closed: false },
          { points: square(45, 35, 1), closed: true },
        ],
      },
    ]);

    expect(features).toHaveLength(1);
    expect(features[0]?.geometry.coordinates[0]?.[0]).toEqual([45, 35]);
  });

  it("still fills a ring that says nothing about being closed", () => {
    // Back-compat: `closed` is optional, and a ring from before it
    // existed must keep rendering exactly as it did.
    const { features } = buildContourFeatureCollection([
      { value: 5, level: 5, rings: [{ points: square(45, 35, 1) }] },
    ]);
    expect(features).toHaveLength(1);
  });
});
