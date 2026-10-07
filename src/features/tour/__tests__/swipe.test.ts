import { swipeStep } from "../swipe";

describe("swipeStep", () => {
  it("steps forward on a drag toward the left edge in a left-to-right language", () => {
    expect(swipeStep(-80, 0, false)).toBe(1);
    expect(swipeStep(80, 0, false)).toBe(-1);
  });

  it("mirrors in a right-to-left language", () => {
    expect(swipeStep(-80, 0, true)).toBe(-1);
    expect(swipeStep(80, 0, true)).toBe(1);
  });

  it("ignores a short, slow drag and accepts a short quick flick", () => {
    expect(swipeStep(-20, 0.1, false)).toBe(0);
    expect(swipeStep(-30, -0.8, false)).toBe(1);
    expect(swipeStep(-5, -0.9, false)).toBe(0);
  });
});
