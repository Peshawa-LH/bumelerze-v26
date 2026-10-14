import { useQuery } from "@tanstack/react-query";

import { isSupabaseConfigured } from "@/lib/supabase";
import { SupabaseToolCountsTransport, type ToolCountsTransport } from "./transport";

export const toolCountKeys = { all: ["admin", "tool-counts"] as const };

/** The launcher's status lines. Never persisted; a failure (an old server)
 * just leaves the tiles without a number. */
export function useToolCounts(
  enabled: boolean,
  transport: ToolCountsTransport = SupabaseToolCountsTransport,
) {
  return useQuery({
    queryKey: toolCountKeys.all,
    queryFn: () => transport.fetchToolCounts(),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 30_000,
    retry: 0,
    meta: { persist: false },
  });
}
