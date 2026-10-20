import { readFileSync } from "fs";
import { join } from "path";

import { listLiveStations } from "../catalog";
import {
  buildDataselectUrl,
  FdsnStationTraceTransport,
  mergeSegments,
} from "../trace-transport";

describe("station trace transport", () => {
  it("builds an FDSN dataselect URL on the station's own service", () => {
    const station =
      listLiveStations().find((s) => s.service === "koeri") ?? listLiveStations()[0]!;
    const url = buildDataselectUrl(
      station,
      Date.parse("2026-09-27T18:50:00Z"),
      Date.parse("2026-09-27T19:00:00Z"),
    );
    expect(url).toContain("/fdsnws/dataselect/1/query?");
    expect(url).toContain(`net=${station.net}`);
    expect(url).toContain(`sta=${station.sta}`);
    expect(url).toContain("start=2026-09-27T18%3A50%3A00");
  });

  it("merges segments in time order, bridging a gap with the last value", () => {
    const merged = mergeSegments([
      { sampleRate: 10, startMs: 1_000, y: [5, 6, 7] },
      { sampleRate: 10, startMs: 0, y: [1, 2, 3] },
    ]);
    expect(merged).not.toBeNull();
    expect(merged?.sps).toBe(10);
    expect(merged?.startMs).toBe(0);
    // 0..200 ms = 3 samples, then a gap of 7 samples at 100 ms steps, then 1000..1200
    expect(merged?.samples).toEqual([1, 2, 3, 3, 3, 3, 3, 3, 3, 3, 5, 6, 7]);
    expect(merged?.endMs).toBe(1_200);
  });

  it("returns null with no samples", () => {
    expect(mergeSegments([])).toBeNull();
    expect(mergeSegments([{ sampleRate: 10, startMs: 0, y: [] }])).toBeNull();
  });

  it("[regression] decodes the trace on iOS/Android instead of reporting no data", async () => {
    // Off the web, decodeMiniSeed used to return [] (seisplotjs cannot load
    // on Hermes), so every selected station read "No data".
    const bytes = readFileSync(
      join(__dirname, "..", "__fixtures__", "earthscope-MP-KIR1-HHZ.mseed"),
    );
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => body,
    })) as unknown as typeof fetch;
    try {
      const station = listLiveStations().find((s) => s.id === "MP.KIR1")!;
      const trace = await FdsnStationTraceTransport.fetchTrace(station, 1792529100000);
      expect(trace?.stationId).toBe("MP.KIR1");
      expect(trace?.sps).toBe(100);
      expect(trace?.samples.length).toBe(3221);
      expect(trace?.startMs).toBe(1792529014000);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
