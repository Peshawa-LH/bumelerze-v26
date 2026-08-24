import { useQuery } from "@tanstack/react-query";

import { isSupabaseConfigured } from "@/lib/supabase";
import { selectFeltMapCells } from "./cell-selection";
import { FELTMAP_REFETCH_INTERVAL_MS, FELTMAP_STALE_TIME_MS } from "./config";
import { SupabaseFeltMapTransport, type FeltMapTransport } from "./transport";
import type { FeltCellRow } from "./types";

export const feltMapQueryKeys = {
  event: (eventId: string) => ["feltmap", "cells", eventId] as const,
};

export type FeltMapStatus = "hidden" | "ready" | "offline";

export interface UseFeltMapResult {
  /**
   * "hidden": no Supabase project configured yet, OR the fetch succeeded
   *   but produced zero displayable cells (an event with no felt reports
   *   yet, or none that have cleared the >=3-report display threshold) —
   *   spec-v1.md §4.5's "never blank/error" rule applies to the OFFLINE
   *   case, not to the ordinary "nothing to show yet" case, which the wave
   *   brief calls out explicitly: "hidden entirely when no data (no
   *   empty-state noise on old events)". The initial in-flight fetch (no
   *   cached data yet) also reports "hidden" — the section simply pops in
   *   once ready rather than showing its own loading skeleton, the same
   *   "never blocks the header" philosophy `ShakeMapSection` already
   *   follows for its own (synchronous) lookup.
   * "ready": at least one cell to draw.
   * "offline": configured, but the query is in an error state — spec-v1.md
   *   §4.5's offline state ("shakemap/felt-map/comments show 'unavailable
   *   offline' rather than blank/error"). Deliberately a single state
   *   regardless of whether stale cached cells exist underneath the failed
   *   fetch: a live-updating "how many people felt this" aggregate reads as
   *   actively misleading if shown next to a silent "as of some unknown
   *   earlier time" - unlike the main event feed, which does show stale
   *   data with an explicit banner (`events/queries.ts`'s `isOfflineIsh`).
   */
  status: FeltMapStatus;
  cells: FeltCellRow[];
  /** Sum of `n_reports` across the displayed (post-precision-dedup) cells —
   * a lower bound on this event's total felt-report count, not a global
   * total (areas below the >=3-report display threshold, or reports still
   * offline-queued on other devices, are invisible to this view by design
   * — same "the threshold lives in the DB" principle as the migration's own
   * comment). */
  totalReports: number;
  dataUpdatedAt: number;
  refetch: () => void;
}

/**
 * Event Detail's felt-map data hook (spec-v1.md §4.5 "Felt map tab: our own
 * CDI-aggregated grid cells"). Reads `felt_cells_public` for one event via
 * the injectable `transport` (defaults to the real Supabase-backed one);
 * resolves to `"hidden"` with an empty cell list whenever no Supabase
 * project is configured yet (`isSupabaseConfigured()` — same graceful
 * env-gating every other Supabase-backed read/write in this app follows,
 * `lib/supabase.ts`), so the section simply doesn't exist for today's
 * backend-less build.
 */
export function useFeltMap(
  eventId: string,
  transport: FeltMapTransport = SupabaseFeltMapTransport,
): UseFeltMapResult {
  const configured = isSupabaseConfigured();

  const query = useQuery({
    queryKey: feltMapQueryKeys.event(eventId),
    queryFn: () => transport.fetchFeltCells(eventId),
    enabled: configured && Boolean(eventId),
    staleTime: FELTMAP_STALE_TIME_MS,
    refetchInterval: FELTMAP_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  if (!configured) {
    return {
      status: "hidden",
      cells: [],
      totalReports: 0,
      dataUpdatedAt: 0,
      refetch: query.refetch,
    };
  }

  if (query.isError) {
    return {
      status: "offline",
      cells: [],
      totalReports: 0,
      dataUpdatedAt: query.dataUpdatedAt,
      refetch: query.refetch,
    };
  }

  const cells = selectFeltMapCells(query.data ?? []);
  const totalReports = cells.reduce((sum, cell) => sum + cell.n_reports, 0);

  return {
    status: cells.length > 0 ? "ready" : "hidden",
    cells,
    totalReports,
    dataUpdatedAt: query.dataUpdatedAt,
    refetch: query.refetch,
  };
}
