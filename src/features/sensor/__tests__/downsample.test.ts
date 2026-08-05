import { downsampleForPlot, selectWindow } from "../downsample";
import type { SensorSample } from "../types";

function sample(t: number): SensorSample {
  return { t, x: t, y: t, z: t };
}

describe("selectWindow", () => {
  it("keeps only samples within windowMs of now", () => {
    const samples = [sample(0), sample(4000), sample(8000), sample(9500)];
    const result = selectWindow(samples, 10_000, 5_000); // cutoff = 5000

    expect(result).toEqual([sample(8000), sample(9500)]);
  });

  it("returns everything when the whole series fits inside the window", () => {
    const samples = [sample(0), sample(100), sample(200)];
    expect(selectWindow(samples, 200, 10_000)).toEqual(samples);
  });

  it("returns an empty array when every sample is older than the window", () => {
    const samples = [sample(0), sample(100)];
    expect(selectWindow(samples, 100_000, 1_000)).toEqual([]);
  });
});

describe("downsampleForPlot", () => {
  it("returns the input unchanged when it's already at or under maxPoints", () => {
    const samples = [sample(0), sample(1), sample(2)];
    expect(downsampleForPlot(samples, 5)).toEqual(samples);
    expect(downsampleForPlot(samples, 3)).toEqual(samples);
  });

  it("throws for a non-positive maxPoints", () => {
    expect(() => downsampleForPlot([sample(0)], 0)).toThrow();
  });

  it("always keeps the first and last sample", () => {
    const samples = Array.from({ length: 500 }, (_, i) => sample(i));
    const result = downsampleForPlot(samples, 10);

    expect(result[0]).toEqual(sample(0));
    expect(result[result.length - 1]).toEqual(sample(499));
  });

  it("reduces the series to exactly maxPoints when there are more points than that", () => {
    const samples = Array.from({ length: 500 }, (_, i) => sample(i));
    const result = downsampleForPlot(samples, 50);

    expect(result.length).toBe(50);
  });

  it("preserves chronological order", () => {
    const samples = Array.from({ length: 200 }, (_, i) => sample(i));
    const result = downsampleForPlot(samples, 20);

    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.t).toBeGreaterThan(result[i - 1]!.t);
    }
  });

  it("handles maxPoints === 1 by returning only the last sample", () => {
    const samples = [sample(0), sample(1), sample(2)];
    expect(downsampleForPlot(samples, 1)).toEqual([sample(2)]);
  });
});
