import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { appendSegment, canStream, openStationStream } from "./datalink";

import { classifyFreshness, freshnessFromCatalog } from "./freshness";
import {
  FdsnStationTraceTransport,
  TRACE_WINDOW_MS,
  type StationTraceTransport,
} from "./trace-transport";
import type { LiveStation, StationFreshness, StationTrace } from "./types";

/** Refresh cadence for the one station on screen: half a minute for a
 * station that publishes in blocks (KOERI: five-minute blocks, measured
 * 2026-09-27), fifteen seconds for one within a minute of real time
 * (EarthScope's ring: Kirkuk 4 s behind) so the trace visibly moves. */
export const STATION_TRACE_REFETCH_MS = 30_000;
export const STATION_TRACE_REFETCH_LIVE_MS = 15_000;
const NEAR_REAL_TIME_MS = 60_000;

export interface UseStationTraceResult {
  status: "idle" | "loading" | "ready" | "empty" | "error";
  trace: StationTrace | null;
  freshness: StationFreshness;
  /** Milliseconds between now and the last sample, when known. */
  lagMs: number | null;
  /** True while a DataLink stream is feeding the trace (EarthScope ring
   * on web); polling stays underneath as the fallback. */
  streaming: boolean;
}

export function useStationTrace(
  station: LiveStation | null,
  transport: StationTraceTransport = FdsnStationTraceTransport,
): UseStationTraceResult {
  const query = useQuery({
    queryKey: ["station-trace", station?.id ?? null],
    queryFn: () => (station ? transport.fetchTrace(station) : Promise.resolve(null)),
    enabled: station !== null,
    refetchInterval: (q) => {
      const data = q.state.data;
      const lag = data ? q.state.dataUpdatedAt - data.endMs : Infinity;
      return lag < NEAR_REAL_TIME_MS
        ? STATION_TRACE_REFETCH_LIVE_MS
        : STATION_TRACE_REFETCH_MS;
    },
    refetchIntervalInBackground: false,
    staleTime: STATION_TRACE_REFETCH_LIVE_MS,
    retry: 1,
  });
  // Live stream on top of the poll (datalink.ts): packets append to the
  // polled trace; the poll's next answer replaces the whole thing, which
  // is fine — both describe the same seconds. `polledRef` carries the
  // poll's latest answer without restarting the stream on every refetch.
  const polled = query.data ?? null;
  const polledRef = useRef<StationTrace | null>(null);
  useEffect(() => {
    polledRef.current = polled;
  }, [polled]);
  const [live, setLive] = useState<{ trace: StationTrace; at: number } | null>(null);
  const streamable = station !== null && canStream(station);
  const stationId = station?.id ?? null;
  useEffect(() => {
    if (!station || !streamable) return undefined;
    let current: StationTrace | null = null;
    const close = openStationStream(
      station,
      (segment) => {
        const base = current ?? polledRef.current;
        if (!base) return;
        current = appendSegment(base, segment, TRACE_WINDOW_MS);
        setLive({ trace: current, at: Date.now() });
      },
      () => setLive(null),
    );
    return () => {
      close();
      // The next station starts from its own poll, never from this one.
      setLive(null);
    };
    // The station object is re-created by every catalogue render; its id
    // is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId, streamable]);

  if (!station)
    return {
      status: "idle",
      trace: null,
      freshness: "unknown",
      lagMs: null,
      streaming: false,
    };
  if (query.isPending)
    return {
      status: "loading",
      trace: null,
      freshness: "unknown",
      lagMs: null,
      streaming: false,
    };
  if (query.isError && !live)
    return {
      status: "error",
      trace: null,
      freshness: "unknown",
      lagMs: null,
      streaming: false,
    };
  const useLive = live !== null && (!polled || live.trace.endMs >= polled.endMs);
  const trace = useLive ? live.trace : polled;
  if (!trace)
    return {
      status: "empty",
      trace: null,
      freshness: "silent",
      lagMs: null,
      streaming: false,
    };
  const fetchedAt = useLive ? live.at : query.dataUpdatedAt;
  return {
    status: "ready",
    trace,
    freshness: classifyFreshness(trace.endMs, fetchedAt),
    lagMs: fetchedAt - trace.endMs,
    streaming: useLive,
  };
}

/** How often the whole catalogue is re-probed while the screen is open. */
export const STATION_PROBE_REFETCH_MS = 120_000;
const PROBE_CONCURRENCY = 4;

/**
 * Freshness of every station: probed live (a ten-minute request each, a
 * few at a time) on top of the catalogue's day-old sighting. Until the
 * probe answers, the catalogue tier stands, so the map never shows a
 * station as live on a guess.
 */
export function useStationFreshness(
  stations: LiveStation[],
  transport: StationTraceTransport = FdsnStationTraceTransport,
): Record<string, StationFreshness> {
  const ids = stations.map((s) => s.id).join(",");
  const query = useQuery({
    queryKey: ["station-probe", ids],
    queryFn: async () => {
      const live: Record<string, boolean> = {};
      const queue = [...stations];
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          try {
            live[next.id] = await transport.probeRecent(next);
          } catch {
            live[next.id] = false;
          }
        }
      };
      await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker));
      return { live, at: Date.now() };
    },
    enabled: stations.length > 0,
    refetchInterval: STATION_PROBE_REFETCH_MS,
    refetchIntervalInBackground: false,
    staleTime: STATION_PROBE_REFETCH_MS,
    retry: 0,
  });
  const probe = query.data;
  const out: Record<string, StationFreshness> = {};
  for (const station of stations) {
    if (probe?.live[station.id]) out[station.id] = "live";
    else
      out[station.id] = freshnessFromCatalog(
        station.lastSeenAt,
        (probe?.at ?? Date.parse(station.lastSeenAt ?? "")) || 0,
      );
  }
  return out;
}
