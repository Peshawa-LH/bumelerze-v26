import { appendSegment, streamPattern } from "../datalink";
import type { LiveStation, StationTrace } from "../types";

const trace: StationTrace = {
  stationId: "MP.KIR1",
  channel: "HHZ",
  sps: 10,
  startMs: 0,
  endMs: 200,
  samples: [1, 2, 3],
};

describe("datalink", () => {
  it("matches the station's stream whatever its location code", () => {
    const st = { net: "MP", sta: "KIR1", channel: "HHZ" } as LiveStation;
    const re = new RegExp(streamPattern(st));
    expect(re.test("MP_KIR1_00_HHZ/MSEED")).toBe(true);
    expect(re.test("MP_KIR1__HHZ/MSEED")).toBe(true);
    expect(re.test("MP_KIR1_00_HHN/MSEED")).toBe(false);
    expect(re.test("KO_KIR1_00_HHZ/MSEED")).toBe(false);
  });

  it("appends a following segment, bridges a gap flat, and trims to the window", () => {
    const next = appendSegment(
      trace,
      { sampleRate: 10, startMs: 300, y: [4, 5] },
      10_000,
    );
    expect(next.samples).toEqual([1, 2, 3, 4, 5]);
    expect(next.endMs).toBe(400);
    const gapped = appendSegment(next, { sampleRate: 10, startMs: 700, y: [9] }, 10_000);
    expect(gapped.samples).toEqual([1, 2, 3, 4, 5, 5, 5, 9]);
    const trimmed = appendSegment(
      gapped,
      { sampleRate: 10, startMs: 800, y: [10, 11] },
      500,
    );
    expect(trimmed.samples.length).toBe(6);
    expect(trimmed.endMs).toBe(900);
    expect(trimmed.startMs).toBe(400);
  });

  it("ignores overlaps and other sample rates", () => {
    expect(
      appendSegment(trace, { sampleRate: 10, startMs: 0, y: [7, 7, 7] }, 10_000),
    ).toBe(trace);
    expect(appendSegment(trace, { sampleRate: 20, startMs: 300, y: [1] }, 10_000)).toBe(
      trace,
    );
  });
});
