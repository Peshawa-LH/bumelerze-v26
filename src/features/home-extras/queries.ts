import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { isSupabaseConfigured } from "@/lib/supabase";
import { indexHidden, type HiddenIndex } from "./hidden";
import {
  EMPTY_HOME_EXTRAS,
  SupabaseHomeExtrasTransport,
  type HomeExtras,
  type HomeExtrasTransport,
} from "./transport";

export const homeExtrasKeys = { all: ["home", "extras"] as const };

/** Asked every minute while Home is open, so a change reaches phones within
 * about 2 minutes (wording 1.3). Kept on the device like the feed, so the
 * message, the chosen earthquakes and the hidden ones also apply offline;
 * the first two still end at their own time by the phone's clock
 * (`select.ts`). */
export const HOME_EXTRAS_REFETCH_MS = 60_000;

/** A copy saved on the device by 26.5.0-26.5.1 has no `hidden` list. Module
 * level, so React Query runs it only when the data changes. */
function withHiddenList(data: HomeExtras): HomeExtras {
  return Array.isArray(data.hidden) ? data : { ...data, hidden: [] };
}

export function useHomeExtras(
  transport: HomeExtrasTransport = SupabaseHomeExtrasTransport,
  {
    poll = true,
  }: {
    /** Home asks every minute (Home stays mounted behind the other tabs).
     * Other screens read the same copy and ask only when it is stale, so the
     * phone does not ask once per open screen. */
    poll?: boolean;
  } = {},
): HomeExtras {
  const configured = isSupabaseConfigured();
  const query = useQuery({
    queryKey: homeExtrasKeys.all,
    queryFn: () => transport.fetchHomeExtras(),
    select: withHiddenList,
    enabled: configured,
    staleTime: HOME_EXTRAS_REFETCH_MS / 2,
    refetchInterval: poll ? HOME_EXTRAS_REFETCH_MS : false,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  return query.data ?? EMPTY_HOME_EXTRAS;
}

/** The earthquakes hidden for everyone (migration 0085), for a screen other
 * than Home (Significant, World, Map, an event page). */
export function useHiddenEarthquakes(
  transport: HomeExtrasTransport = SupabaseHomeExtrasTransport,
): HiddenIndex {
  const extras = useHomeExtras(transport, { poll: false });
  return useHiddenIndex(extras);
}

/** `extras.hidden` ready to look up, rebuilt only when it changes. */
export function useHiddenIndex(extras: HomeExtras): HiddenIndex {
  // A test double or an old saved copy may lack the list.
  const list = extras.hidden as HomeExtras["hidden"] | undefined;
  return useMemo(() => indexHidden(list), [list]);
}

/**
 * The hidden earthquakes from the copy already on the device, never asking
 * for it (Home asks every minute): for the region feed, which mounts on many
 * screens and must not add a read per screen. Nothing yet (a first visit
 * before Home's read answers): nothing hidden, the feed merges as before.
 */
export function useCachedHiddenEarthquakes(): HiddenIndex {
  const query = useQuery({
    queryKey: homeExtrasKeys.all,
    queryFn: () => SupabaseHomeExtrasTransport.fetchHomeExtras(),
    select: withHiddenList,
    enabled: false,
  });
  return useHiddenIndex(query.data ?? EMPTY_HOME_EXTRAS);
}
