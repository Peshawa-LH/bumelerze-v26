import {
  clipLineToBbox,
  computeContourBoundingBox,
  createEquirectangularProjector,
} from "../projection";
import type { IntensityContourLevel } from "../types";

function level(
  value: number,
  points: readonly (readonly [number, number])[],
): IntensityContourLevel {
  return { value, level: value, rings: [{ points }] };
}

describe("computeContourBoundingBox", () => {
  it("wraps every ring point across every level, with padding", () => {
    const levels = [
      level(4, [
        [44, 34],
        [45, 35],
      ]),
      level(6, [
        [43, 33],
        [46, 36],
      ]),
    ];

    const bbox = computeContourBoundingBox(levels);

    // Raw extent is lon [43,46] lat [33,36] -> span 3 on each axis, 15%
    // padding = 0.45 on each side.
    expect(bbox.minLon).toBeCloseTo(43 - 0.45, 5);
    expect(bbox.maxLon).toBeCloseTo(46 + 0.45, 5);
    expect(bbox.minLat).toBeCloseTo(33 - 0.45, 5);
    expect(bbox.maxLat).toBeCloseTo(36 + 0.45, 5);
  });

  it("expands to include extra points (e.g. the epicenter) outside the contour extent", () => {
    const levels = [
      level(4, [
        [44, 34],
        [44.5, 34.5],
      ]),
    ];
    const bbox = computeContourBoundingBox(levels, [[50, 40]]);

    expect(bbox.maxLon).toBeGreaterThan(50);
    expect(bbox.maxLat).toBeGreaterThan(40);
  });

  it("falls back to a fixed-degree pad for a degenerate single-point extent", () => {
    const levels = [
      level(4, [
        [44, 34],
        [44, 34],
        [44, 34],
      ]),
    ];
    const bbox = computeContourBoundingBox(levels);

    expect(bbox.maxLon - bbox.minLon).toBeCloseTo(0.5, 5);
    expect(bbox.maxLat - bbox.minLat).toBeCloseTo(0.5, 5);
  });

  it("returns a valid non-empty box when there are no points at all", () => {
    const bbox = computeContourBoundingBox([]);
    expect(bbox.maxLon).toBeGreaterThan(bbox.minLon);
    expect(bbox.maxLat).toBeGreaterThan(bbox.minLat);
  });
});

describe("createEquirectangularProjector", () => {
  const bbox = { minLon: 44, maxLon: 46, minLat: 34, maxLat: 36 };
  const viewport = { width: 320, height: 240 };
  const projector = createEquirectangularProjector(bbox, viewport);

  it("projects the bbox center to the viewport center (symmetric letterboxing)", () => {
    const { x, y } = projector.project(45, 35);
    expect(x).toBeCloseTo(160, 0);
    expect(y).toBeCloseTo(120, 0);
  });

  it("projects the north-west corner near the top-left of the letterboxed area", () => {
    const { x, y } = projector.project(44, 36);
    expect(y).toBeCloseTo(0, 0);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(160);
  });

  it("projects the south-east corner near the bottom-right of the letterboxed area", () => {
    const { x, y } = projector.project(46, 34);
    expect(y).toBeCloseTo(240, 0);
    expect(x).toBeGreaterThan(160);
  });

  it("keeps north above south (y decreases as latitude increases)", () => {
    const north = projector.project(45, 36);
    const south = projector.project(45, 34);
    expect(north.y).toBeLessThan(south.y);
  });

  it("applies longitude correction via cos(midLat) rather than a naive 1:1 degree plot", () => {
    // At bbox mid-latitude 35°N, cos(35°) ≈ 0.8192 — the corrected lon
    // span (2° * 0.8192 ≈ 1.638) is narrower than the lat span (2°), so
    // the height axis is the constraining one and the drawn map is
    // letterboxed left/right, not top/bottom.
    const topLeft = projector.project(bbox.minLon, bbox.maxLat);
    const bottomRight = projector.project(bbox.maxLon, bbox.minLat);
    expect(topLeft.y).toBeCloseTo(0, 0);
    expect(bottomRight.y).toBeCloseTo(240, 0);
    expect(topLeft.x).toBeGreaterThan(0);
    expect(bottomRight.x).toBeLessThan(320);
  });

  it("does not divide by zero for a degenerate zero-span bbox", () => {
    const pointProjector = createEquirectangularProjector(
      { minLon: 45, maxLon: 45, minLat: 35, maxLat: 35 },
      viewport,
    );
    const { x, y } = pointProjector.project(45, 35);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
  });
});

describe("clipLineToBbox", () => {
  const bbox = { minLon: 44, maxLon: 46, minLat: 34, maxLat: 36 };

  it("returns the line unchanged (as one piece) when it's entirely inside the bbox", () => {
    const line = [
      [44.5, 34.5],
      [45, 35],
      [45.5, 35.5],
    ] as const;

    const result = clipLineToBbox(line, bbox);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(line);
  });

  it("returns nothing for a line entirely outside the bbox", () => {
    const line = [
      [0, 0],
      [1, 1],
    ] as const;

    expect(clipLineToBbox(line, bbox)).toEqual([]);
  });

  it("clips a line that crosses one edge down to the portion inside the bbox", () => {
    // Crosses the west edge (lon 44) partway through.
    const line = [
      [43, 35],
      [47, 35],
    ] as const;

    const result = clipLineToBbox(line, bbox);

    expect(result).toHaveLength(1);
    const [clipped] = result;
    expect(clipped).toBeDefined();
    for (const [lon] of clipped!) {
      expect(lon).toBeGreaterThanOrEqual(bbox.minLon);
      expect(lon).toBeLessThanOrEqual(bbox.maxLon);
    }
    // Still spans the full bbox width since the raw line ran clean through.
    expect(clipped![0]![0]).toBeCloseTo(bbox.minLon, 5);
    expect(clipped![clipped!.length - 1]![0]).toBeCloseTo(bbox.maxLon, 5);
  });

  it("splits a line that exits and re-enters the bbox into separate pieces", () => {
    // Dips out through the north edge (lat 36) in the middle, then back in.
    const line = [
      [45, 34.5],
      [45, 37],
      [45.2, 34.5],
    ] as const;

    const result = clipLineToBbox(line, bbox);

    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const piece of result) {
      for (const [, lat] of piece) {
        expect(lat).toBeLessThanOrEqual(bbox.maxLat);
      }
    }
  });

  it("never returns a single-point piece", () => {
    const line = [
      [44.5, 34.5],
      [100, 100],
    ] as const;

    const result = clipLineToBbox(line, bbox);
    for (const piece of result) {
      expect(piece.length).toBeGreaterThanOrEqual(2);
    }
  });
});
