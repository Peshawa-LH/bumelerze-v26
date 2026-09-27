import { Platform } from "react-native";

import { FDSN_SERVICE_BASE } from "./catalog";
import type { LiveStation, StationTrace } from "./types";

/** Window fetched per refresh. Ten minutes at 100 sps is ~40 KB of
 * miniSEED — cheap enough to poll every half minute on the one station a
 * person is looking at. */
export const TRACE_WINDOW_MS = 10 * 60 * 1000;

export interface StationTraceTransport {
  fetchTrace(station: LiveStation, now?: number): Promise<StationTrace | null>;
}

function fdsnTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19);
}

export function buildDataselectUrl(
  station: LiveStation,
  startMs: number,
  endMs: number,
): string {
  const base = FDSN_SERVICE_BASE[station.service];
  const q = new URLSearchParams({
    net: station.net,
    sta: station.sta,
    cha: station.channel,
    start: fdsnTime(startMs),
    end: fdsnTime(endMs),
  });
  return `${base}/dataselect/1/query?${q.toString()}`;
}

interface DecodedSegment {
  sampleRate: number;
  startMs: number;
  y: ArrayLike<number>;
}

/**
 * miniSEED → segments, via `seisplotjs` loaded lazily and on web only:
 * the library registers a custom element at import, which native has no
 * DOM for, and it is large — the Sensor tab must not pay for it until a
 * station is opened.
 */
async function decodeMiniSeed(buffer: ArrayBuffer): Promise<DecodedSegment[]> {
  if (Platform.OS !== "web") {
    return [];
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
  async fetchTrace(station, now = Date.now()) {
    const url = buildDataselectUrl(station, now - TRACE_WINDOW_MS, now);
    const response = await fetch(url);
    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`dataselect ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) return null;
    const merged = mergeSegments(await decodeMiniSeed(buffer));
    if (!merged) return null;
    return { stationId: station.id, channel: station.channel, ...merged };
  },
};
