import { useQuery } from "@tanstack/react-query";

import { classifyFreshness } from "./freshness";
import { FdsnStationTraceTransport, type StationTraceTransport } from "./trace-transport";
import type { LiveStation, StationFreshness, StationTrace } from "./types";

/** Refresh cadence for the one station on screen: data arrive minutes
 * behind real time, so half a minute is as often as anything changes. */
export const STATION_TRACE_REFETCH_MS = 30_000;

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
    refetchInterval: STATION_TRACE_REFETCH_MS,
    refetchIntervalInBackground: false,
    staleTime: STATION_TRACE_REFETCH_MS,
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
