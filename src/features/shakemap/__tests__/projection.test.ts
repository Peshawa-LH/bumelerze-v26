import { computeContourBoundingBox, createEquirectangularProjector } from "../projection";
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
