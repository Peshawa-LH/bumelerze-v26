import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { homeExtrasKeys } from "@/features/home-extras/queries";
import { isSupabaseConfigured } from "@/lib/supabase";
import { homeAdminKeys } from "../home/queries";
import { toolCountKeys } from "../tools/queries";
import {
  SupabaseHiddenEventsAdminTransport,
  type HiddenEventsAdminTransport,
  type HideInput,
} from "./transport";

const NOT_PERSISTED = { persist: false } as const;

export const hiddenEventsKeys = {
  all: ["admin", "hidden-events"] as const,
  list: ["admin", "hidden-events", "list"] as const,
  find: (query: string) => ["admin", "hidden-events", "find", query] as const,
  candidates: (eventId: string) =>
    ["admin", "hidden-events", "candidates", eventId] as const,
  impact: (eventId: string) => ["admin", "hidden-events", "impact", eventId] as const,
};

/** "Hidden now"; also the admin banner on a hidden earthquake's page, for
 * the reason and the note. */
export function useAdminHiddenEvents(
  enabled: boolean,
  transport: HiddenEventsAdminTransport = SupabaseHiddenEventsAdminTransport,
) {
  return useQuery({
    queryKey: hiddenEventsKeys.list,
    queryFn: () => transport.fetchHidden(),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

export function useHideFind(
  query: string,
  enabled: boolean,
  transport: HiddenEventsAdminTransport = SupabaseHiddenEventsAdminTransport,
) {
  return useQuery({
    queryKey: hiddenEventsKeys.find(query.trim().toLowerCase()),
    queryFn: () => transport.findEvents(query),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

export function useHideCandidates(
  eventId: string,
  enabled: boolean,
  transport: HiddenEventsAdminTransport = SupabaseHiddenEventsAdminTransport,
) {
  return useQuery({
    queryKey: hiddenEventsKeys.candidates(eventId),
    queryFn: () => transport.fetchCandidates(eventId),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

export function useHideImpact(
  eventId: string,
  enabled: boolean,
  transport: HiddenEventsAdminTransport = SupabaseHiddenEventsAdminTransport,
) {
  return useQuery({
    queryKey: hiddenEventsKeys.impact(eventId),
    queryFn: () => transport.fetchImpact(eventId),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 0,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

/** Each change refreshes this page, the launcher's count, the Home screen
 * tool (hiding takes a chosen earthquake off Home) and the admin's own Home
 * at once; other phones pick it up on their next minute's read. */
export function useHiddenEventActions(
  transport: HiddenEventsAdminTransport = SupabaseHiddenEventsAdminTransport,
) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: hiddenEventsKeys.all }),
      queryClient.invalidateQueries({ queryKey: toolCountKeys.all }),
      queryClient.invalidateQueries({ queryKey: homeAdminKeys.all }),
      queryClient.invalidateQueries({ queryKey: homeExtrasKeys.all }),
    ]);
  const hide = useMutation({
    mutationFn: (input: HideInput) => transport.hide(input),
    onSuccess: refresh,
  });
  const showAgain = useMutation({
    mutationFn: (eventId: string) => transport.showAgain(eventId),
    onSuccess: refresh,
  });
  return {
    hide: (input: HideInput) => hide.mutateAsync(input),
    showAgain: (eventId: string) => showAgain.mutateAsync(eventId),
    /** After a refusal that means another admin acted first. */
    refresh: () => void refresh(),
  };
}
