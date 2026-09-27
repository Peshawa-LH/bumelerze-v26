import { useQuery } from "@tanstack/react-query";

import { classifyFreshness, freshnessFromCatalog } from "./freshness";
import { FdsnStationTraceTransport, type StationTraceTransport } from "./trace-transport";
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
  if (!station) return { status: "idle", trace: null, freshness: "unknown", lagMs: null };
  if (query.isPending)
    return { status: "loading", trace: null, freshness: "unknown", lagMs: null };
  if (query.isError)
    return { status: "error", trace: null, freshness: "unknown", lagMs: null };
  const trace = query.data ?? null;
  if (!trace) return { status: "empty", trace: null, freshness: "silent", lagMs: null };
  // Lag as of the fetch (react-query's own timestamp), not of this render:
  // pure, and the 30 s refetch keeps it current enough for a badge.
  const fetchedAt = query.dataUpdatedAt;
  return {
    status: "ready",
    trace,
    freshness: classifyFreshness(trace.endMs, fetchedAt),
    lagMs: fetchedAt - trace.endMs,
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
