import { binForPlot, selectWindow } from "../downsample";
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

describe("binForPlot", () => {
  it("rejects a non-positive bin", () => {
    expect(() => binForPlot([sample(0)], 0)).toThrow();
  });

  it("returns nothing for nothing", () => {
    expect(binForPlot([], 40)).toEqual([]);
  });

  it("averages every sample of a bin and places the point at the bin centre", () => {
    const samples = [
      { t: 1000, x: 1, y: 2, z: 3 },
      { t: 1010, x: 3, y: 4, z: 5 },
      { t: 1039, x: 2, y: 0, z: 1 },
      { t: 1040, x: 10, y: 10, z: 10 },
    ];
    expect(binForPlot(samples, 40)).toEqual([
      { t: 1020, x: 2, y: 2, z: 3 },
      { t: 1060, x: 10, y: 10, z: 10 },
    ]);
  });

  it("draws the same points for the same bins whatever else the window holds (no flicker as it slides)", () => {
    const wave = (t: number) => ({ t, x: Math.sin(t / 30), y: 0, z: 0 });
    const a = Array.from({ length: 200 }, (_, i) => wave(5000 + i * 17));
    const b = Array.from({ length: 200 }, (_, i) => wave(5000 + 17 * 3 + i * 17));
    const fromA = binForPlot(a, 40).filter((point) => point.t > 5200 && point.t < 8000);
    const fromB = binForPlot(b, 40).filter((point) => point.t > 5200 && point.t < 8000);
    expect(fromB).toEqual(fromA);
  });

  it("keeps chronological order and one point per occupied bin", () => {
    const samples = Array.from({ length: 300 }, (_, i) => sample(i * 16));
    const result = binForPlot(samples, 40);
    expect(result.length).toBe(Math.floor((299 * 16) / 40) + 1);
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i]!.t).toBeGreaterThan(result[i - 1]!.t);
    }
  });
});
