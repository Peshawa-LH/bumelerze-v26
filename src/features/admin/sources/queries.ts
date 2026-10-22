import { useQuery } from "@tanstack/react-query";

import { isSupabaseConfigured } from "@/lib/supabase";
import { SupabaseSourceStatusTransport, type SourceStatusTransport } from "./transport";

export const sourceStatusKeys = { all: ["admin", "source-status"] as const };

/** The Source status card. Asked again every minute while the admin home is
 * open, so "2m ago" stays true; never persisted (an old status is worse than
 * none). */
export function useSourceStatus(
  enabled: boolean,
  transport: SourceStatusTransport = SupabaseSourceStatusTransport,
) {
  return useQuery({
    queryKey: sourceStatusKeys.all,
    queryFn: () => transport.fetchSourceStatus(),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 0,
    meta: { persist: false },
  });
}
