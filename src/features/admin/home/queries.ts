import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { homeExtrasKeys } from "@/features/home-extras/queries";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  SupabaseHomeAdminTransport,
  type HomeAdminTransport,
  type PinDays,
  type PostNoticeInput,
} from "./transport";

export const homeAdminKeys = {
  all: ["admin", "home"] as const,
  state: ["admin", "home", "state"] as const,
  find: (query: string) => ["admin", "home", "find", query] as const,
};

/** What is on Home now; also the launcher tile's status line. */
export function useAdminHomeState(
  enabled: boolean,
  transport: HomeAdminTransport = SupabaseHomeAdminTransport,
) {
  return useQuery({
    queryKey: homeAdminKeys.state,
    queryFn: () => transport.fetchState(),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: { persist: false },
  });
}

export function useAdminHomeFind(
  query: string,
  enabled: boolean,
  transport: HomeAdminTransport = SupabaseHomeAdminTransport,
) {
  return useQuery({
    queryKey: homeAdminKeys.find(query.trim().toLowerCase()),
    queryFn: () => transport.findEvents(query),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: { persist: false },
  });
}

/** Each change refreshes this page and the admin's own Home at once; other
 * phones pick it up on their next minute's read. */
export function useAdminHomeActions(
  transport: HomeAdminTransport = SupabaseHomeAdminTransport,
) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: homeAdminKeys.all }),
      queryClient.invalidateQueries({ queryKey: homeExtrasKeys.all }),
    ]);
  const post = useMutation({
    mutationFn: (input: PostNoticeInput) => transport.postNotice(input),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => transport.removeNotice(),
    onSuccess: refresh,
  });
  const pin = useMutation({
    mutationFn: (input: { eventId: string; days: PinDays }) =>
      transport.pin(input.eventId, input.days),
    onSuccess: refresh,
  });
  const unpin = useMutation({
    mutationFn: (eventId: string) => transport.unpin(eventId),
    onSuccess: refresh,
  });
  return {
    postNotice: (input: PostNoticeInput) => post.mutateAsync(input),
    removeNotice: () => remove.mutateAsync(),
    pin: (eventId: string, days: PinDays) => pin.mutateAsync({ eventId, days }),
    unpin: (eventId: string) => unpin.mutateAsync(eventId),
  };
}
