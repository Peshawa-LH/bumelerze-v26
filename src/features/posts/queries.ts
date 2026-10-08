import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";

import { useAccount } from "@/features/account/use-account";
import { communityKeys } from "@/features/community/queries";
import { CommunityError } from "@/features/community/types";
import { useMyPermissions } from "@/features/eventhub/queries";
import { RECENTLY_DELETED_KEY } from "@/features/undo/keys";
import type { EventHubTransport } from "@/features/eventhub/transport";
import type { ReportReason } from "@/features/reporting/reasons";
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
  one: (profileUserId: string, postId: string, viewer: string) =>
    ["community", "post", profileUserId, postId, viewer] as const,
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

/** The pinned post of a profile (migration 0058), or null. Fetched on its
 * own because it may be older than the first page. */
export function usePinnedPost(
  profileUserId: string,
  postId: string | null,
  transport: PostsTransport = SupabasePostsTransport,
): { post: ProfilePost | null; updatedAt: number } {
  const account = useAccount();
  const viewer = account.userId ?? "none";
  const query = useQuery({
    queryKey: postsKeys.one(profileUserId, postId ?? "", viewer),
    queryFn: () => transport.fetchPost(profileUserId, postId as string),
    enabled: isSupabaseConfigured() && postId !== null,
    staleTime: 30_000,
    retry: retryOnce,
    meta: NOT_PERSISTED,
  });
  return { post: postId ? (query.data ?? null) : null, updatedAt: query.dataUpdatedAt };
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
  /** The author's own edit; rejects with `edit_locked` while reported. */
  edit: (postId: string, body: string) => Promise<void>;
  /** Marks or unmarks "Helpful"; resolves with the count the viewer may see. */
  setHelpful: (
    postId: string,
    helpful: boolean,
  ) => Promise<{ helpful: boolean; count: number }>;
  /** Pins a post of mine to the top of my profile; null unpins. */
  setPinned: (postId: string | null) => Promise<void>;
  /** Shares an earthquake to my profile (an event card with optional text). */
  shareEvent: (eventRef: string, text: string) => Promise<string>;
  remove: (postId: string) => Promise<void>;
  /** The Undo of my own delete (24 hours). */
  restore: (postId: string) => Promise<void>;
  report: (postId: string, reason: ReportReason, note?: string | null) => Promise<void>;
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
  const edit = useMutation({
    mutationFn: (input: { postId: string; body: string }) =>
      transport.editPost(input.postId, input.body),
    onSuccess: refresh,
  });
  const helpful = useMutation({
    mutationFn: (input: { postId: string; helpful: boolean }) =>
      transport.setHelpful(input.postId, input.helpful),
    onSuccess: refresh,
  });
  const pin = useMutation({
    mutationFn: (postId: string | null) => transport.setPinned(postId),
    onSuccess: refresh,
  });
  const share = useMutation({
    mutationFn: (input: { eventRef: string; text: string }) =>
      transport.shareEvent(input.eventRef, input.text),
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
    mutationFn: (input: {
      postId: string;
      reason: ReportReason;
      note?: string | null | undefined;
    }) => transport.reportPost(input.postId, input.reason, input.note),
  });
  const adminRemove = useMutation({
    mutationFn: (input: { postId: string; reason: string }) =>
      transport.adminRemovePost(input.postId, input.reason),
    onSuccess: refresh,
  });

  return {
    create: (userId, body) => create.mutateAsync({ userId, body }),
    edit: (postId, body) => edit.mutateAsync({ postId, body }),
    setHelpful: (postId, value) => helpful.mutateAsync({ postId, helpful: value }),
    setPinned: (postId) => pin.mutateAsync(postId),
    shareEvent: (eventRef, text) => share.mutateAsync({ eventRef, text }),
    remove: (postId) => remove.mutateAsync(postId),
    restore: (postId) => restore.mutateAsync(postId),
    adminRestore: (postId) => adminRestore.mutateAsync(postId),
    report: (postId, reason, note) => report.mutateAsync({ postId, reason, note }),
    adminRemove: (postId, reason) => adminRemove.mutateAsync({ postId, reason }),
  };
}
