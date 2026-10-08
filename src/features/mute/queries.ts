import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { useAccount } from "@/features/account/use-account";
import { CommunityError } from "@/features/community/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { SupabaseMuteTransport, type MutedPerson, type MuteTransport } from "./transport";

export const muteKeys = {
  all: ["mutes"] as const,
  of: (viewer: string) => ["mutes", viewer] as const,
};

const EMPTY: ReadonlySet<string> = new Set();

/** The people I muted. Personal: never written to the on-device cache. */
export function useMutedPeople(transport: MuteTransport = SupabaseMuteTransport) {
  const account = useAccount();
  const enabled = isSupabaseConfigured() && account.userId !== null;
  const query = useQuery({
    queryKey: muteKeys.of(account.userId ?? "none"),
    queryFn: () => transport.fetchMuted(),
    enabled,
    staleTime: 60_000,
    retry: (failureCount, error) =>
      !(error instanceof CommunityError && error.code === "unavailable") &&
      failureCount < 1,
    meta: { persist: false },
  });
  return {
    data: query.data as MutedPerson[] | undefined,
    isLoading: enabled && query.isLoading,
    isError: query.isError,
  };
}

/** Ids of the people I muted, for hiding their comments and posts. Empty while
 * loading, offline or before the migration (nothing is hidden then). */
export function useMutedIds(
  transport: MuteTransport = SupabaseMuteTransport,
): ReadonlySet<string> {
  const muted = useMutedPeople(transport);
  return useMemo(
    () => (muted.data ? new Set(muted.data.map((person) => person.userId)) : EMPTY),
    [muted.data],
  );
}

export interface MuteActions {
  mute: (userId: string) => Promise<void>;
  unmute: (userId: string) => Promise<void>;
}

/** Mute and unmute; each refreshes the list (and with it every hidden comment
 * and post, which read the same query) and the activity bell. */
export function useMuteActions(
  transport: MuteTransport = SupabaseMuteTransport,
): MuteActions {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: muteKeys.all }),
      queryClient.invalidateQueries({ queryKey: ["activity"] }),
    ]);
  const mute = useMutation({
    mutationFn: (userId: string) => transport.mute(userId),
    onSuccess: refresh,
  });
  const unmute = useMutation({
    mutationFn: (userId: string) => transport.unmute(userId),
    onSuccess: refresh,
  });
  return {
    mute: async (userId) => {
      await mute.mutateAsync(userId);
    },
    unmute: async (userId) => {
      await unmute.mutateAsync(userId);
    },
  };
}
