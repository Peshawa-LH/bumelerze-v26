import { Platform } from "react-native";

import type { LiveStation, StationTrace } from "./types";

/** EarthScope's public DataLink ring, reachable from a browser (verified
 * 2026-09-27). Stations served from `earthscope` are in it; KOERI and
 * GEOFON offer no WebSocket, so they stay on polling. */
export const DATALINK_URL = "wss://rtserve.earthscope.org/datalink";

export interface StreamedSegment {
  sampleRate: number;
  startMs: number;
  y: ArrayLike<number>;
}

export function canStream(station: LiveStation): boolean {
  return Platform.OS === "web" && station.service === "earthscope";
}

/** DataLink stream ids read `NET_STA_LOC_CHAN/MSEED`; the location code
 * varies per station, so it is wildcarded. */
export function streamPattern(station: LiveStation): string {
  return `^${station.net}_${station.sta}_[A-Z0-9]*_${station.channel}/MSEED$`;
}

/**
 * Opens a live stream for one station and hands every decoded packet to
 * `onSegment`. Returns a closer. Errors (network, a station not in the
 * ring) go to `onError`; the caller keeps polling either way.
 */
export function openStationStream(
  station: LiveStation,
  onSegment: (segment: StreamedSegment) => void,
  onError: (error: Error) => void,
): () => void {
  let closed = false;
  let connection: { close(): void } | null = null;
  void (async () => {
    try {
      const sp = await import("seisplotjs");
      if (closed) return;
      const conn = new sp.datalink.DataLinkConnection(
        DATALINK_URL,
        (packet) => {
          if (!packet.isMiniseed()) return;
          const record = packet.asMiniseed();
          if (!record) return;
          for (const seis of sp.miniseed.seismogramPerChannel([record])) {
            for (const seg of seis.segments) {
              onSegment({
                sampleRate: seg.sampleRate,
                startMs: seg.startTime.toMillis(),
                y: seg.y,
              });
            }
          }
        },
        (error) => onError(error instanceof Error ? error : new Error(String(error))),
      );
      connection = conn;
      await conn.connect();
      if (closed) {
        conn.close();
        return;
      }
      await conn.match(streamPattern(station));
      await conn.stream();
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  })();
  return () => {
    closed = true;
    connection?.close();
  };
}

/**
 * Appends a streamed segment to a trace, keeping it evenly sampled and
 * no longer than `windowMs`: a gap is bridged flat (as in the poll
 * merge), an overlap is ignored, a different rate is dropped. Pure.
 */
export function appendSegment(
  trace: StationTrace,
  segment: StreamedSegment,
  windowMs: number,
): StationTrace {
  if (segment.sampleRate !== trace.sps || segment.y.length === 0) return trace;
  const stepMs = 1000 / trace.sps;
  const nextStartMs = trace.endMs + stepMs;
  if (segment.startMs + (segment.y.length - 1) * stepMs <= trace.endMs) return trace;
  const samples = trace.samples.slice();
  const gap = Math.round((segment.startMs - nextStartMs) / stepMs);
  const last = samples[samples.length - 1] ?? 0;
  for (let i = 0; i < gap; i += 1) samples.push(last);
  const skip = gap < 0 ? -gap : 0;
  for (let i = skip; i < segment.y.length; i += 1) samples.push(Number(segment.y[i]));
  const endMs = trace.startMs + (samples.length - 1) * stepMs;
  const keep = Math.floor(windowMs / stepMs) + 1;
  const dropped = Math.max(0, samples.length - keep);
  return {
    ...trace,
    samples: dropped > 0 ? samples.slice(dropped) : samples,
    startMs: trace.startMs + dropped * stepMs,
    endMs,
  };
}
