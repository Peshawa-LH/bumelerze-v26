import { readFileSync } from "fs";
import { join } from "path";

import { listLiveStations } from "../catalog";
import {
  buildDataselectUrl,
  DELAYED_PROBE_SLICE_MS,
  FdsnStationTraceTransport,
  mergeSegments,
  TRACE_WINDOW_MS,
  traceLookbackMs,
  trimTraceToWindow,
} from "../trace-transport";
import type { LiveStation, StationTrace } from "../types";

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

describe("Raspberry Shake (delayed archive) transport", () => {
  // Shaped like the catalogue's AM.R079D; the dataselect answer is the real
  // R079D fixture (8 Steim2 records, 2133 samples from 12:34:31.222 UTC).
  const shake: LiveStation = {
    id: "AM.R079D",
    net: "AM",
    sta: "R079D",
    loc: "00",
    name: "Hawler, TIU",
    channel: "EHZ",
    sps: 100,
    lat: 36.16216,
    lon: 43.9461,
    elevM: 390,
    service: "raspberryshake",
    country: "IQ",
    operator: "Kurdistan Educational Seismic Observatory, Tishk International University",
    credit: "Kurdistan Educational Seismic Observatory via Raspberry Shake, S.A.",
    distanceKmFromErbil: 7,
    lastSeenAt: null,
  };
  const FIXTURE_START = Date.parse("2026-10-21T12:34:31.222Z");
  const FIXTURE_END = FIXTURE_START + 2132 * 10;
  // Thirty minutes after the fixture's last sample: the archive's usual delay.
  const NOW = FIXTURE_END + 30 * 60_000;
  const fixtureBytes = readFileSync(
    join(__dirname, "..", "__fixtures__", "raspberryshake-AM-R079D-EHZ.mseed"),
  );
  const fixture = fixtureBytes.buffer.slice(
    fixtureBytes.byteOffset,
    fixtureBytes.byteOffset + fixtureBytes.byteLength,
  );
  const reference = (
    JSON.parse(
      readFileSync(
        join(__dirname, "..", "__fixtures__", "seisplotjs-decoded.json"),
        "utf8",
      ),
    ) as Record<string, { y: number[] }[]>
  )["raspberryshake-AM-R079D-EHZ.mseed"]![0]!.y;

  const originalFetch = global.fetch;
  let calls: string[];
  function answer(...responses: { status: number; body?: ArrayBuffer }[]) {
    calls = [];
    global.fetch = jest.fn(async (url: string) => {
      calls.push(String(url));
      const next = responses.shift() ?? { status: 204 };
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        arrayBuffer: async () => next.body ?? new ArrayBuffer(0),
      };
    }) as unknown as typeof fetch;
  }
  afterEach(() => {
    global.fetch = originalFetch;
  });
  const param = (url: string | undefined, name: string) =>
    decodeURIComponent(new RegExp(`[?&]${name}=([^&]*)`).exec(url ?? "")?.[1] ?? "");
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19);

  it("asks Raspberry Shake with the long parameter names and the location code", () => {
    // Its server answers the short form (net=, sta=) with 404 (2026-10-21).
    const url = buildDataselectUrl(
      shake,
      Date.parse("2026-10-21T12:31:00Z"),
      Date.parse("2026-10-21T13:31:00Z"),
    );
    expect(url).toBe(
      "https://data.raspberryshake.org/fdsnws/dataselect/1/query?network=AM&station=R079D&location=00&channel=EHZ&starttime=2026-10-21T12%3A31%3A00&endtime=2026-10-21T13%3A31%3A00",
    );
  });

  it("[regression guard] leaves the other services' URLs exactly as they were", () => {
    const kir1 = listLiveStations().find((s) => s.id === "MP.KIR1")!;
    expect(
      buildDataselectUrl(
        kir1,
        Date.parse("2026-09-27T18:50:00Z"),
        Date.parse("2026-09-27T19:00:00Z"),
      ),
    ).toBe(
      "https://service.earthscope.org/fdsnws/dataselect/1/query?net=MP&sta=KIR1&cha=HHZ&start=2026-09-27T18%3A50%3A00&end=2026-09-27T19%3A00%3A00",
    );
  });

  it("looks back an hour for a Raspberry Shake and ten minutes for the rest", () => {
    expect(traceLookbackMs("raspberryshake")).toBe(60 * 60_000);
    for (const service of ["earthscope", "koeri", "geofon"] as const) {
      expect(traceLookbackMs(service)).toBe(TRACE_WINDOW_MS);
    }
  });

  it("first asks for the last hour and decodes the Steim2 answer", async () => {
    answer({ status: 200, body: fixture });
    const trace = await FdsnStationTraceTransport.fetchTrace(shake, NOW);
    expect(calls).toHaveLength(1);
    expect(param(calls[0], "starttime")).toBe(iso(NOW - 60 * 60_000));
    expect(param(calls[0], "endtime")).toBe(iso(NOW));
    expect(trace?.stationId).toBe("AM.R079D");
    expect(trace?.channel).toBe("EHZ");
    expect(trace?.sps).toBe(100);
    expect(trace?.startMs).toBe(FIXTURE_START);
    expect(trace?.endMs).toBe(FIXTURE_END);
    expect(trace?.samples).toEqual(reference);
  });

  it("keeps only the newest ten minutes of the hour", () => {
    const sps = 100;
    const samples = Array.from({ length: 30 * 60 * sps }, (_, i) => i);
    const startMs = Date.parse("2026-10-21T12:30:00Z");
    const endMs = startMs + (samples.length - 1) * 10;
    const trimmed = trimTraceToWindow(
      { stationId: "AM.R079D", channel: "EHZ", sps, startMs, endMs, samples },
      TRACE_WINDOW_MS,
    );
    expect(trimmed.endMs).toBe(endMs);
    expect(trimmed.startMs).toBe(endMs - TRACE_WINDOW_MS);
    expect(trimmed.samples).toHaveLength(10 * 60 * sps + 1);
    expect(trimmed.samples[trimmed.samples.length - 1]).toBe(samples.length - 1);
    // A trace shorter than the window is returned as it is.
    const short = { ...trimmed, samples: [1, 2, 3], endMs: trimmed.startMs + 20 };
    expect(trimTraceToWindow(short, TRACE_WINDOW_MS)).toBe(short);
  });

  it("then asks only from its last sample on and appends what is new", async () => {
    // The previous answer: the fixture's first ten seconds.
    const previous: StationTrace = {
      stationId: "AM.R079D",
      channel: "EHZ",
      sps: 100,
      startMs: FIXTURE_START,
      endMs: FIXTURE_START + 1000 * 10,
      samples: reference.slice(0, 1001),
    };
    answer({ status: 200, body: fixture });
    const trace = await FdsnStationTraceTransport.fetchTrace(shake, NOW, previous);
    expect(param(calls[0], "starttime")).toBe(iso(previous.endMs));
    expect(param(calls[0], "endtime")).toBe(iso(NOW));
    // The overlapping record is skipped, the rest appended in place.
    expect(trace?.startMs).toBe(FIXTURE_START);
    expect(trace?.endMs).toBe(FIXTURE_END);
    expect(trace?.samples).toEqual(reference);
  });

  it("keeps the previous trace when nothing new has arrived (204)", async () => {
    const previous: StationTrace = {
      stationId: "AM.R079D",
      channel: "EHZ",
      sps: 100,
      startMs: FIXTURE_START,
      endMs: FIXTURE_END,
      samples: reference,
    };
    answer({ status: 204 });
    await expect(
      FdsnStationTraceTransport.fetchTrace(shake, NOW + 30_000, previous),
    ).resolves.toBe(previous);
  });

  it("asks for the whole hour again when the previous trace is older than that or another station's", async () => {
    const stale: StationTrace = {
      stationId: "AM.R079D",
      channel: "EHZ",
      sps: 100,
      startMs: FIXTURE_START,
      endMs: FIXTURE_END,
      samples: reference,
    };
    const later = FIXTURE_END + 61 * 60_000;
    answer({ status: 200, body: fixture }, { status: 200, body: fixture });
    await FdsnStationTraceTransport.fetchTrace(shake, later, stale);
    await FdsnStationTraceTransport.fetchTrace(shake, NOW, {
      ...stale,
      stationId: "MP.KIR1",
    });
    expect(param(calls[0], "starttime")).toBe(iso(later - 60 * 60_000));
    expect(param(calls[1], "starttime")).toBe(iso(NOW - 60 * 60_000));
  });

  it("[regression guard] other services ignore the previous trace and ask for ten minutes", async () => {
    const kir1 = listLiveStations().find((s) => s.id === "MP.KIR1")!;
    answer({ status: 204 });
    const previous: StationTrace = {
      stationId: "MP.KIR1",
      channel: "HHZ",
      sps: 100,
      startMs: NOW - 60_000,
      endMs: NOW - 1_000,
      samples: [1, 2, 3],
    };
    await expect(
      FdsnStationTraceTransport.fetchTrace(kir1, NOW, previous),
    ).resolves.toBeNull();
    expect(param(calls[0], "start")).toBe(iso(NOW - TRACE_WINDOW_MS));
  });

  it("probes a five-minute slice at the far edge of the hour, not the whole hour", async () => {
    answer({ status: 200, body: fixture }, { status: 204 });
    await expect(FdsnStationTraceTransport.probeRecent(shake, NOW)).resolves.toBe(true);
    await expect(FdsnStationTraceTransport.probeRecent(shake, NOW)).resolves.toBe(false);
    expect(DELAYED_PROBE_SLICE_MS).toBe(5 * 60_000);
    expect(param(calls[0], "starttime")).toBe(iso(NOW - 60 * 60_000));
    expect(param(calls[0], "endtime")).toBe(iso(NOW - 55 * 60_000));
    // The other services keep their ten-minute probe up to now.
    const kir1 = listLiveStations().find((s) => s.id === "MP.KIR1")!;
    answer({ status: 204 });
    await FdsnStationTraceTransport.probeRecent(kir1, NOW);
    expect(param(calls[0], "start")).toBe(iso(NOW - TRACE_WINDOW_MS));
    expect(param(calls[0], "end")).toBe(iso(NOW));
  });
});
