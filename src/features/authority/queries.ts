import { useQuery } from "@tanstack/react-query";

import { isSupabaseConfigured } from "@/lib/supabase";
import { SupabaseAuthorityTransport, type AuthorityTransport } from "./transport";

const NOT_PERSISTED = { persist: false } as const;

export const authorityKeys = {
  all: ["authority"] as const,
  overview: ["authority", "overview"] as const,
  event: (eventId: string) => ["authority", "event", eventId] as const,
  people: ["authority", "people"] as const,
};

// Officials' reads are logged on the server, so they are fetched on purpose
// (no background refetch on focus) and kept for a few minutes.
const OFFICIAL_READ = {
  staleTime: 5 * 60_000,
  retry: 0,
  refetchOnWindowFocus: false,
  meta: NOT_PERSISTED,
} as const;

export function useAuthorityOverview(
  enabled: boolean,
  transport: AuthorityTransport = SupabaseAuthorityTransport,
) {
  return useQuery({
    queryKey: authorityKeys.overview,
    queryFn: () => transport.fetchOverview(),
    enabled: enabled && isSupabaseConfigured(),
    ...OFFICIAL_READ,
  });
}

export function useEventSafety(
  eventId: string | null,
  transport: AuthorityTransport = SupabaseAuthorityTransport,
) {
  return useQuery({
    queryKey: authorityKeys.event(eventId ?? ""),
    queryFn: () => transport.fetchEventSafety(eventId as string),
    enabled: eventId !== null && isSupabaseConfigured(),
    ...OFFICIAL_READ,
  });
}

export function useSharedPeople(
  enabled: boolean,
  transport: AuthorityTransport = SupabaseAuthorityTransport,
) {
  return useQuery({
    queryKey: authorityKeys.people,
    queryFn: () => transport.fetchPeople(),
    enabled: enabled && isSupabaseConfigured(),
    ...OFFICIAL_READ,
  });
}
