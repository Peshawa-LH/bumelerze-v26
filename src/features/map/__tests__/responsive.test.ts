import {
  isCompactMapControlsWidth,
  MAP_CONTROLS_COMPACT_MAX_WIDTH_PX,
} from "../responsive";

describe("isCompactMapControlsWidth", () => {
  it("is compact below the breakpoint", () => {
    expect(isCompactMapControlsWidth(320)).toBe(true);
    expect(isCompactMapControlsWidth(375)).toBe(true);
    expect(isCompactMapControlsWidth(MAP_CONTROLS_COMPACT_MAX_WIDTH_PX - 1)).toBe(true);
  });

  it("is NOT compact at/above the breakpoint (a wide window keeps the roomier layout)", () => {
    expect(isCompactMapControlsWidth(MAP_CONTROLS_COMPACT_MAX_WIDTH_PX)).toBe(false);
    expect(isCompactMapControlsWidth(768)).toBe(false);
    expect(isCompactMapControlsWidth(1024)).toBe(false);
  });
});
