import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { eventHubKeys } from "@/features/eventhub/queries";
import { isSupabaseConfigured } from "@/lib/supabase";
import { toolCountKeys } from "../tools/queries";
import { SupabaseHubAdminTransport, type HubAdminTransport } from "./transport";

export const hubAdminKeys = {
  all: ["admin", "hubs"] as const,
  list: (query: string) => ["admin", "hubs", query] as const,
};

export function useHubEvents(
  query: string,
  enabled: boolean,
  transport: HubAdminTransport = SupabaseHubAdminTransport,
) {
  return useQuery({
    queryKey: hubAdminKeys.list(query.trim().toLowerCase()),
    queryFn: () => transport.fetchEvents(query),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: { persist: false },
  });
}

export function useHubAdminActions(
  transport: HubAdminTransport = SupabaseHubAdminTransport,
) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: hubAdminKeys.all }),
      queryClient.invalidateQueries({ queryKey: toolCountKeys.all }),
      queryClient.invalidateQueries({ queryKey: eventHubKeys.all }),
    ]);
  const setOpen = useMutation({
    mutationFn: (input: { eventId: string; open: boolean }) =>
      transport.setOpen(input.eventId, input.open),
    onSuccess: refresh,
  });
  const postNote = useMutation({
    mutationFn: (input: { eventId: string; body: string }) =>
      transport.postNote(input.eventId, input.body),
    onSuccess: refresh,
  });
  return {
    setOpen: (eventId: string, open: boolean) => setOpen.mutateAsync({ eventId, open }),
    postNote: (eventId: string, body: string) => postNote.mutateAsync({ eventId, body }),
  };
}
