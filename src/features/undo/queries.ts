import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAccount } from "@/features/account/use-account";
import { CommunityError } from "@/features/community/types";
import { eventHubKeys } from "@/features/eventhub/queries";
import {
  SupabaseEventHubTransport,
  type EventHubTransport,
} from "@/features/eventhub/transport";
import { SupabasePostsTransport, type PostsTransport } from "@/features/posts/transport";
import { isSupabaseConfigured } from "@/lib/supabase";
import { RECENTLY_DELETED_KEY } from "./keys";
import { SupabaseUndoTransport, type UndoTransport } from "./transport";
import type { RecentlyDeletedItem } from "./types";

export const recentlyDeletedKeys = {
  of: (viewer: string) => [...RECENTLY_DELETED_KEY, viewer] as const,
};

/** The person's own deleted comments and posts of the last 24 hours. Private
 * and short-lived, so never written to the on-device cache. Anyone signed in
 * (guests too: they can delete their comments) has a list; it is empty most of
 * the time. */
export function useRecentlyDeleted(transport: UndoTransport = SupabaseUndoTransport) {
  const account = useAccount();
  const enabled = isSupabaseConfigured() && account.userId !== null;
  return useQuery({
    queryKey: recentlyDeletedKeys.of(account.userId ?? "none"),
    queryFn: () => transport.fetchRecentlyDeleted(),
    enabled,
    staleTime: 15_000,
    retry: (failureCount, error) =>
      !(error instanceof CommunityError && error.code === "unavailable") &&
      failureCount < 1,
    meta: { persist: false },
  });
}

/** Restores one item and refreshes everything that shows it. */
export function useRestoreDeleted(
  hubTransport: EventHubTransport = SupabaseEventHubTransport,
  postsTransport: PostsTransport = SupabasePostsTransport,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: Pick<RecentlyDeletedItem, "kind" | "id">) =>
      item.kind === "post"
        ? postsTransport.restorePost(item.id)
        : hubTransport.restoreComment(item.id),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: RECENTLY_DELETED_KEY }),
        queryClient.invalidateQueries({ queryKey: eventHubKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["community"] }),
      ]),
  });
}
