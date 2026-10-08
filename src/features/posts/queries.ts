import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";

import { useAccount } from "@/features/account/use-account";
import { communityKeys } from "@/features/community/queries";
import { CommunityError } from "@/features/community/types";
import { useMyPermissions } from "@/features/eventhub/queries";
import { RECENTLY_DELETED_KEY } from "@/features/undo/keys";
import type { EventHubTransport } from "@/features/eventhub/transport";
import type { FlagReason } from "@/features/eventhub/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { SupabasePostsTransport, type PostsTransport } from "./transport";
import type { PostsPage, ProfilePost } from "./types";

/** Posts depend on who is looking (privacy, blocks), so they are never
 * written to the on-device cache. */
const NOT_PERSISTED = { persist: false } as const;

/** Under the `community` prefix on purpose: following, unfollowing, blocking
 * and going private already invalidate `communityKeys.all`, which refreshes
 * every posts list that depends on them. */
export const postsKeys = {
  of: (profileUserId: string, viewer: string, includeRemoved: boolean) =>
    ["community", "posts", profileUserId, viewer, includeRemoved] as const,
};

function retryOnce(failureCount: number, error: unknown): boolean {
  if (error instanceof CommunityError && error.code === "unavailable") {
    return false;
  }
  return failureCount < 1;
}

export interface PostsList {
  posts: ProfilePost[];
  isLoading: boolean;
  isError: boolean;
  /** The server has no posts yet (migration 0050 not applied): hide the UI. */
  isUnavailable: boolean;
  hasMore: boolean;
  isFetchingMore: boolean;
  loadMore: () => void;
  /** When the data last arrived (UTC ms): the clock for relative times. */
  updatedAt: number;
  refetch: () => Promise<unknown>;
}

export function usePosts(
  profileUserId: string,
  options: { includeRemoved: boolean; enabled?: boolean },
  transport: PostsTransport = SupabasePostsTransport,
): PostsList {
  const account = useAccount();
  const viewer = account.userId ?? "none";
  const query = useInfiniteQuery<
    PostsPage,
    Error,
    InfiniteData<PostsPage, string | null>,
    ReturnType<typeof postsKeys.of>,
    string | null
  >({
    queryKey: postsKeys.of(profileUserId, viewer, options.includeRemoved),
    queryFn: ({ pageParam }) =>
      transport.fetchPosts({
        userId: profileUserId,
        before: pageParam,
        includeRemoved: options.includeRemoved,
      }),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: isSupabaseConfigured() && (options.enabled ?? true),
    staleTime: 30_000,
    retry: retryOnce,
    meta: NOT_PERSISTED,
  });
  return {
    posts: query.data?.pages.flatMap((page) => page.posts) ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    isUnavailable:
      query.error instanceof CommunityError && query.error.code === "unavailable",
    hasMore: query.hasNextPage,
    isFetchingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
    updatedAt: query.dataUpdatedAt,
    refetch: query.refetch,
  };
}

/** Whether the viewer may remove anyone's post (`posts.delete`, official). */
export function useCanRemovePosts(hubTransport?: EventHubTransport): boolean {
  const account = useAccount();
  const userId = account.status === "account" ? account.userId : null;
  const perms = useMyPermissions(userId, hubTransport);
  // Same rule as the admin tools: only a real answer from the server counts.
  return !perms.legacy && perms.has("posts.delete");
}

export interface PostActions {
  create: (userId: string, body: string) => Promise<void>;
  remove: (postId: string) => Promise<void>;
  /** The Undo of my own delete (24 hours). */
  restore: (postId: string) => Promise<void>;
  report: (postId: string, reason: FlagReason) => Promise<void>;
  adminRemove: (postId: string, reason: string) => Promise<void>;
  /** The Undo of an admin removal (`content.restore`, 30 days). */
  adminRestore: (postId: string) => Promise<void>;
}

/** Write actions. Each refreshes the community data (posts lists and the
 * profile's post count) and the admin queue; failures reject with a
 * `CommunityError` for the caller to word. */
export function usePostActions(
  transport: PostsTransport = SupabasePostsTransport,
): PostActions {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: communityKeys.all }),
      // the admin screen's reported-posts list (key prefix of the admin feature)
      queryClient.invalidateQueries({ queryKey: ["admin"] }),
      queryClient.invalidateQueries({ queryKey: RECENTLY_DELETED_KEY }),
    ]);

  const create = useMutation({
    mutationFn: (input: { userId: string; body: string }) =>
      transport.createPost(input.userId, input.body),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (postId: string) => transport.deletePost(postId),
    onSuccess: refresh,
  });
  const restore = useMutation({
    mutationFn: (postId: string) => transport.restorePost(postId),
    onSuccess: refresh,
  });
  const adminRestore = useMutation({
    mutationFn: (postId: string) => transport.adminRestorePost(postId),
    onSuccess: refresh,
  });
  const report = useMutation({
    mutationFn: (input: { postId: string; reason: FlagReason }) =>
      transport.reportPost(input.postId, input.reason),
  });
  const adminRemove = useMutation({
    mutationFn: (input: { postId: string; reason: string }) =>
      transport.adminRemovePost(input.postId, input.reason),
    onSuccess: refresh,
  });

  return {
    create: (userId, body) => create.mutateAsync({ userId, body }),
    remove: (postId) => remove.mutateAsync(postId),
    restore: (postId) => restore.mutateAsync(postId),
    adminRestore: (postId) => adminRestore.mutateAsync(postId),
    report: (postId, reason) => report.mutateAsync({ postId, reason }),
    adminRemove: (postId, reason) => adminRemove.mutateAsync({ postId, reason }),
  };
}
