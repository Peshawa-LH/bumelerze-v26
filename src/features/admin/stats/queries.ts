import { useQuery } from "@tanstack/react-query";

import { isSupabaseConfigured } from "@/lib/supabase";
import { SupabaseStatsTransport, type StatsTransport } from "./transport";
import type { StatsRange } from "./types";

export function useAdminStats(
  range: StatsRange,
  enabled: boolean,
  transport: StatsTransport = SupabaseStatsTransport,
) {
  return useQuery({
    queryKey: ["admin", "stats", range] as const,
    queryFn: () => transport.fetchStats(range),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 60_000,
    retry: 0,
    meta: { persist: false },
  });
}
