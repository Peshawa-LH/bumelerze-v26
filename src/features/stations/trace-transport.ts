import { Platform } from "react-native";

import { FDSN_SERVICE_BASE } from "./catalog";
import { appendSegment } from "./datalink";
import { liveMaxAgeMs } from "./freshness";
import type { DecodedSegment } from "./miniseed";
import { decodeMiniSeedNative } from "./native-decoders";
import type { LiveStation, StationTrace } from "./types";

/** Window fetched per refresh. Ten minutes at 100 sps is ~40 KB of
 * miniSEED — cheap enough to poll every half minute on the one station a
 * person is looking at. */
export const TRACE_WINDOW_MS = 10 * 60 * 1000;

/** The map probe of a delayed-archive service (`probeRecent`) asks for this
 * slice at the far edge of the station's live allowance, not for the whole
 * hour: ~60 KB instead of ~360 KB for a Raspberry Shake every two minutes. */
export const DELAYED_PROBE_SLICE_MS = 5 * 60 * 1000;

export interface StationTraceTransport {
  /** The station's newest `TRACE_WINDOW_MS`. `previous` is the last answer
   * for the same station: a delayed-archive service (Raspberry Shake) then
   * asks only for what came after it. */
  fetchTrace(
    station: LiveStation,
    now?: number,
    previous?: StationTrace | null,
  ): Promise<StationTrace | null>;
  /** True when the station has any data within its live allowance — the
   * map's "live" test, one small request per station, no decoding. */
  probeRecent(station: LiveStation, now?: number): Promise<boolean>;
}

/**
 * How far back a trace request reaches: the ten minutes on screen, or the
 * station's whole live allowance when that is longer. Raspberry Shake's
 * archive is ~30 min behind, so the last ten minutes of the clock are
 * empty; asking for the last hour finds its newest data, of which the
 * newest ten minutes are shown, like every other station.
 */
export function traceLookbackMs(service: LiveStation["service"]): number {
  return Math.max(TRACE_WINDOW_MS, liveMaxAgeMs(service));
}

/** Services that serve only the long FDSN parameter names. Raspberry
 * Shake's server answers `net=…&sta=…` with 404 and `network=…&station=…`
 * with data (checked 2026-10-21); the others keep the short form they were
 * built and checked with. */
const LONG_PARAMETER_SERVICES: ReadonlySet<LiveStation["service"]> = new Set([
  "raspberryshake",
]);

function fdsnTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19);
}

export function buildDataselectUrl(
  station: LiveStation,
  startMs: number,
  endMs: number,
): string {
  const base = FDSN_SERVICE_BASE[station.service];
  const long = LONG_PARAMETER_SERVICES.has(station.service);
  const q = new URLSearchParams();
  q.set(long ? "network" : "net", station.net);
  q.set(long ? "station" : "sta", station.sta);
  if (station.loc !== undefined) q.set(long ? "location" : "loc", station.loc);
  q.set(long ? "channel" : "cha", station.channel);
  q.set(long ? "starttime" : "start", fdsnTime(startMs));
  q.set(long ? "endtime" : "end", fdsnTime(endMs));
  return `${base}/dataselect/1/query?${q.toString()}`;
}

/** The newest `windowMs` of a trace (whole samples). Pure. */
export function trimTraceToWindow(trace: StationTrace, windowMs: number): StationTrace {
  const stepMs = 1000 / trace.sps;
  const keep = Math.floor(windowMs / stepMs) + 1;
  const dropped = Math.max(0, trace.samples.length - keep);
  if (dropped === 0) return trace;
  return {
    ...trace,
    samples: trace.samples.slice(dropped),
    startMs: trace.startMs + dropped * stepMs,
  };
}

/**
 * miniSEED → segments. On the web via `seisplotjs`, loaded lazily (it is
 * large, and the Sensor tab must not pay for it until a station is
 * opened). On iOS and Android via `./miniseed`: seisplotjs registers a
 * custom element the moment it is imported, which Hermes has no DOM for;
 * that decoder is a port of the parts used here, tested against
 * seisplotjs's own output.
 */
async function decodeMiniSeed(buffer: ArrayBuffer): Promise<DecodedSegment[]> {
  if (Platform.OS !== "web") {
    return decodeMiniSeedNative(buffer);
  }
  const sp = await import("seisplotjs");
  const records = sp.miniseed.parseDataRecords(buffer);
  const seismograms = sp.miniseed.seismogramPerChannel(records);
  const segments: DecodedSegment[] = [];
  for (const seis of seismograms) {
    for (const seg of seis.segments) {
      segments.push({
        sampleRate: seg.sampleRate,
        startMs: seg.startTime.toMillis(),
        y: seg.y,
      });
    }
  }
  return segments;
}

/**
 * Merges decoded segments into one evenly sampled series, bridging gaps
 * with the last value so the plot's time axis stays honest (a gap shows as
 * a flat line, not as a jump in time). Pure; unit-tested.
 */
export function mergeSegments(
  segments: DecodedSegment[],
): Omit<StationTrace, "stationId" | "channel"> | null {
  const ordered = [...segments]
    .filter((s) => s.y.length > 0)
    .sort((a, b) => a.startMs - b.startMs);
  const first = ordered[0];
  if (!first) return null;
  const sps = first.sampleRate;
  const stepMs = 1000 / sps;
  const samples: number[] = [];
  let cursorMs = first.startMs;
  let last = 0;
  for (const seg of ordered) {
    if (seg.sampleRate !== sps) continue;
    const missing = Math.round((seg.startMs - cursorMs) / stepMs) - samples.length;
    for (let i = 0; i < missing; i += 1) samples.push(last);
    for (let i = 0; i < seg.y.length; i += 1) {
      last = Number(seg.y[i]);
      samples.push(last);
    }
    cursorMs = first.startMs;
  }
  return {
    sps,
    startMs: first.startMs,
    endMs: first.startMs + (samples.length - 1) * stepMs,
    samples,
  };
}

export const FdsnStationTraceTransport: StationTraceTransport = {
  async probeRecent(station, now = Date.now()) {
    const lookback = traceLookbackMs(station.service);
    // A delayed archive: data at the far edge of the allowance means the
    // newest sample is younger than the allowance (for a station that ran
    // the whole hour), without downloading the hour.
    const [startMs, endMs] =
      lookback > TRACE_WINDOW_MS
        ? [now - lookback, now - lookback + DELAYED_PROBE_SLICE_MS]
        : [now - TRACE_WINDOW_MS, now];
    const response = await fetch(buildDataselectUrl(station, startMs, endMs));
    if (response.status === 204 || !response.ok) return false;
    const buffer = await response.arrayBuffer();
    return buffer.byteLength > 0;
  },
  async fetchTrace(station, now = Date.now(), previous = null) {
    const lookback = traceLookbackMs(station.service);
    const delayed = lookback > TRACE_WINDOW_MS;
    // Delayed archive, already showing a recent answer: ask only from its
    // last sample on (a few KB per poll instead of the hour).
    const resume =
      delayed &&
      previous &&
      previous.stationId === station.id &&
      previous.endMs >= now - lookback
        ? previous
        : null;
    const url = buildDataselectUrl(station, resume ? resume.endMs : now - lookback, now);
    const response = await fetch(url);
    if (response.status === 204) return resume;
    if (!response.ok) throw new Error(`dataselect ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) return resume;
    const segments = await decodeMiniSeed(buffer);
    if (resume) {
      let trace = resume;
      for (const segment of [...segments].sort((a, b) => a.startMs - b.startMs)) {
        trace = appendSegment(trace, segment, TRACE_WINDOW_MS);
      }
      return trace;
    }
    const merged = mergeSegments(segments);
    if (!merged) return null;
    const trace = { stationId: station.id, channel: station.channel, ...merged };
    return delayed ? trimTraceToWindow(trace, TRACE_WINDOW_MS) : trace;
  },
};
