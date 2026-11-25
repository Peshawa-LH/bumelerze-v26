import { useQuery } from "@tanstack/react-query";

import { isSupabaseConfigured } from "@/lib/supabase";
import {
  EMPTY_HOME_EXTRAS,
  SupabaseHomeExtrasTransport,
  type HomeExtras,
  type HomeExtrasTransport,
} from "./transport";

export const homeExtrasKeys = { all: ["home", "extras"] as const };

/** Asked every minute while Home is open, so a change reaches phones within
 * about 2 minutes (wording 1.3). Kept on the device like the feed, so the
 * message and the chosen earthquakes also show offline; each still ends at
 * its own time by the phone's clock (`select.ts`). */
export const HOME_EXTRAS_REFETCH_MS = 60_000;

export function useHomeExtras(
  transport: HomeExtrasTransport = SupabaseHomeExtrasTransport,
): HomeExtras {
  const configured = isSupabaseConfigured();
  const query = useQuery({
    queryKey: homeExtrasKeys.all,
    queryFn: () => transport.fetchHomeExtras(),
    enabled: configured,
    staleTime: HOME_EXTRAS_REFETCH_MS / 2,
    refetchInterval: HOME_EXTRAS_REFETCH_MS,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  return query.data ?? EMPTY_HOME_EXTRAS;
}
