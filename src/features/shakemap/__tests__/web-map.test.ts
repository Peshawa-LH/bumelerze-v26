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
