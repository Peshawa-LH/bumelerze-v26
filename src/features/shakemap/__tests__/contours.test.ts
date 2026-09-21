import halabjaContours from "../__fixtures__/us2000bmcg/cont_mi.trimmed.json";
import { parseIntensityContours } from "../contours";
import { mmiValueToLevel, INTENSITY_ROMAN_NUMERALS } from "../intensity-ramp";

describe("parseIntensityContours", () => {
  it("parses the real (trimmed) Halabja cont_mi.json into 4 levels", () => {
    const result = parseIntensityContours(halabjaContours);

    expect(result.skippedCount).toBe(0);
    expect(result.levels).toHaveLength(4);
  });

  it("sorts levels ascending by value even though the fixture stores them descending", () => {
    const result = parseIntensityContours(halabjaContours);
    const values = result.levels.map((level) => level.value);

    expect(values).toEqual([4.0, 4.5, 6.0, 8.0]);
  });

  it("maps each level's value to the correct rounded ramp index", () => {
    const result = parseIntensityContours(halabjaContours);
    const levelsByValue = new Map(
      result.levels.map((level) => [level.value, level.level]),
    );

    expect(levelsByValue.get(4.0)).toBe(4);
    // 4.5 rounds to 5 (JS Math.round rounds .5 up), exercising the
    // fractional-MMI-value case real USGS output actually contains.
    expect(levelsByValue.get(4.5)).toBe(5);
    expect(levelsByValue.get(6.0)).toBe(6);
    expect(levelsByValue.get(8.0)).toBe(8);
  });

  it("keeps real ring point data intact (not fabricated) for the highest level", () => {
    const result = parseIntensityContours(halabjaContours);
    const highest = result.levels[result.levels.length - 1];

    expect(highest?.value).toBe(8.0);
    expect(highest?.rings.length).toBeGreaterThan(0);
    const firstRing = highest?.rings[0];
    expect(firstRing?.points.length).toBeGreaterThanOrEqual(3);
    // Every point is a real [lon, lat] pair within the Halabja region
    // bbox-ish range, not a placeholder.
    for (const [lon, lat] of firstRing?.points ?? []) {
      expect(lon).toBeGreaterThan(40);
      expect(lon).toBeLessThan(50);
      expect(lat).toBeGreaterThan(30);
      expect(lat).toBeLessThan(40);
    }
  });

  it("skips malformed features (counted) rather than throwing", () => {
    const payload = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { value: 5 }, geometry: { type: "Point" } },
        {
          type: "Feature",
          properties: { value: 6 },
          geometry: {
            type: "MultiLineString",
            coordinates: [
              [
                [45, 35],
                [45.1, 35.1],
                [45.2, 35.2],
              ],
            ],
          },
        },
      ],
    };

    const result = parseIntensityContours(payload);
    expect(result.skippedCount).toBe(1);
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0]?.value).toBe(6);
  });

  it("throws for a payload that isn't even a FeatureCollection", () => {
    expect(() => parseIntensityContours({ type: "Feature" })).toThrow();
    expect(() => parseIntensityContours(null)).toThrow();
  });

  it("keeps each MultiPolygon's outer ring AND its holes", () => {
    const payload = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { value: 7 },
          geometry: {
            type: "MultiPolygon",
            coordinates: [
              [
                // outer ring
                [
                  [45, 35],
                  [45.1, 35],
                  [45.1, 35.1],
                  [45, 35.1],
                  [45, 35],
                ],
                // hole (must be kept, so the band below shows through)
                [
                  [45.02, 35.02],
                  [45.03, 35.02],
                  [45.03, 35.03],
                  [45.02, 35.02],
                ],
              ],
            ],
          },
        },
      ],
    };

    const result = parseIntensityContours(payload);
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0]?.rings).toHaveLength(1);
    const ring = result.levels[0]?.rings[0];
    expect(ring?.points).toHaveLength(5);
    expect(ring?.closed).toBe(true);
    expect(ring?.holes).toHaveLength(1);
    expect(ring?.holes?.[0]).toHaveLength(4);
  });

  it("marks a MultiLineString ring open when it did not close on itself", () => {
    // The far-field bug: a contour that ran off the edge of the
    // producer's grid comes back as an OPEN path. Nothing here can close
    // it correctly, because the correct closure walks the grid boundary
    // rather than joining the path's two ends, so it must be flagged and
    // left unfilled by the renderers.
    const ringFor = (coordinates: number[][][]) =>
      parseIntensityContours({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { value: 5 },
            geometry: { type: "MultiLineString", coordinates },
          },
        ],
      }).levels[0]?.rings[0];

    const open = ringFor([
      [
        [42.7, 34.5],
        [45, 36],
        [49.2, 35.5],
      ],
    ]);
    expect(open?.closed).toBe(false);

    const closed = ringFor([
      [
        [45, 35],
        [46, 35],
        [46, 36],
        [45, 35],
      ],
    ]);
    expect(closed?.closed).toBe(true);
  });

  it("caps each level by ring AREA, not by how many points a ring has", () => {
    // A long, wiggly thread of coastline detail has more points than the
    // compact block it winds around, but covers far less map. Ranking by
    // point count dropped the block and kept the thread.
    const square = (x: number, y: number, size: number) => [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
      [x, y],
    ];
    const thread = Array.from({ length: 60 }, (_, i) => [45 + i * 0.0001, 35 + (i % 2) * 0.0001]);
    thread.push(thread[0]!);

    const result = parseIntensityContours({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { value: 6 },
          geometry: { type: "MultiLineString", coordinates: [thread, square(46, 36, 1)] },
        },
      ],
    });
    const rings = result.levels[0]?.rings ?? [];
    expect(rings).toHaveLength(2);
    expect(rings[0]?.points).toHaveLength(5); // the big square, ranked first
    expect(rings[1]?.points).toHaveLength(61); // the many-point thread, second
  });

  it("drops degenerate rings with fewer than 3 points", () => {
    const payload = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { value: 5 },
          geometry: {
            type: "MultiLineString",
            coordinates: [
              [
                [45, 35],
                [45.1, 35.1],
              ], // 2 points, dropped
              [
                [45, 35],
                [45.1, 35.1],
                [45.2, 35.2],
              ], // 3 points, kept
            ],
          },
        },
      ],
    };

    const result = parseIntensityContours(payload);
    expect(result.levels[0]?.rings).toHaveLength(1);
  });
});

describe("mmiValueToLevel", () => {
  it("clamps below the ramp's minimum to 1", () => {
    expect(mmiValueToLevel(0)).toBe(1);
    expect(mmiValueToLevel(-3)).toBe(1);
  });

  it("clamps above the ramp's maximum to 12", () => {
    expect(mmiValueToLevel(13)).toBe(12);
    expect(mmiValueToLevel(20)).toBe(12);
  });

  it("rounds fractional values to the nearest integer level", () => {
    expect(mmiValueToLevel(3.2)).toBe(3);
    expect(mmiValueToLevel(3.5)).toBe(4);
    expect(mmiValueToLevel(3.8)).toBe(4);
  });

  it("passes whole-number values through unchanged", () => {
    for (let value = 1; value <= 12; value += 1) {
      expect(mmiValueToLevel(value)).toBe(value);
    }
  });
});

describe("INTENSITY_ROMAN_NUMERALS", () => {
  it("has a Roman numeral for every ramp index 1..12, empty placeholder at 0", () => {
    expect(INTENSITY_ROMAN_NUMERALS[0]).toBe("");
    expect(INTENSITY_ROMAN_NUMERALS[1]).toBe("I");
    expect(INTENSITY_ROMAN_NUMERALS[10]).toBe("X");
    expect(INTENSITY_ROMAN_NUMERALS[12]).toBe("XII");
    expect(INTENSITY_ROMAN_NUMERALS).toHaveLength(13);
  });
});
