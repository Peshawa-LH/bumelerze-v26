import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAccount } from "@/features/account/use-account";
import { CommunityError } from "@/features/community/types";
import { HUB_REFETCH_INTERVAL_MS, HUB_STALE_TIME_MS } from "@/features/eventhub/queries";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  SupabaseSocialTransport,
  type FeltTimeline,
  type FeltTown,
  type LikeState,
  type ProfileHeaderInfo,
  type SocialTransport,
} from "./transport";

/** Hearts depend on who is looking and are never written to the on-device
 * cache. The aggregates are public and small, so they may be (an offline
 * hub still shows its slides). Hearts on posts live under the `community`
 * prefix, which follows, blocks and mutes already refresh. */
const NOT_PERSISTED = { persist: false } as const;

export const socialKeys = {
  hubLikes: (eventUuid: string, viewer: string) =>
    ["eventhub", "likes", eventUuid, viewer] as const,
  feltTowns: (eventUuid: string) => ["eventhub", "feltTowns", eventUuid] as const,
  timeline: (eventUuid: string) => ["eventhub", "timeline", eventUuid] as const,
  postCommentLikes: (postId: string, viewer: string) =>
    ["community", "postCommentLikes", postId, viewer] as const,
  profileHeader: (username: string, viewer: string) =>
    ["community", "profileHeader", username, viewer] as const,
};

/** No retry when the server simply lacks the function (migration not
 * applied): the slide or count just stays away. */
function retryOnce(failureCount: number, error: unknown): boolean {
  if (error instanceof CommunityError && error.code === "unavailable") {
    return false;
  }
  return failureCount < 1;
}

/** The hub's heart: count and mine, refreshed with the hub while it is in
 * front. */
export function useHubLikes(
  eventUuid: string | null,
  options: { polling?: boolean; transport?: SocialTransport } = {},
) {
  const transport = options.transport ?? SupabaseSocialTransport;
  const account = useAccount();
  const viewer = account.userId ?? "none";
  const queryClient = useQueryClient();
  const key = socialKeys.hubLikes(eventUuid ?? "", viewer);
  const query = useQuery({
    queryKey: key,
    queryFn: () => transport.fetchHubLikes(eventUuid as string),
    enabled: isSupabaseConfigured() && eventUuid !== null,
    staleTime: HUB_STALE_TIME_MS,
    refetchInterval: options.polling ? HUB_REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    retry: retryOnce,
    meta: NOT_PERSISTED,
  });
  const mutation = useMutation({
    mutationFn: (like: boolean) => transport.setHubLike(eventUuid as string, like),
    // The heart answers at once; the server's answer then replaces it.
    onMutate: (like) => {
      const before = queryClient.getQueryData<LikeState>(key);
      if (before) {
        queryClient.setQueryData<LikeState>(key, {
          liked: like,
          count: Math.max(0, before.count + (like === before.liked ? 0 : like ? 1 : -1)),
        });
      }
      return { before };
    },
    onError: (_error, _like, context) => {
      if (context?.before) {
        queryClient.setQueryData(key, context.before);
      }
    },
    onSuccess: (state) => {
      queryClient.setQueryData(key, state);
    },
  });
  return {
    state: query.data ?? null,
    isUnavailable:
      query.error instanceof CommunityError && query.error.code === "unavailable",
    setLiked: (like: boolean) => mutation.mutateAsync(like),
    refetch: query.refetch,
  };
}

export function useFeltTowns(
  eventUuid: string | null,
  enabled: boolean,
  transport: SocialTransport = SupabaseSocialTransport,
) {
  const query = useQuery<FeltTown[]>({
    queryKey: socialKeys.feltTowns(eventUuid ?? ""),
    queryFn: () => transport.fetchFeltTowns(eventUuid as string),
    enabled: enabled && isSupabaseConfigured() && eventUuid !== null,
    staleTime: 60_000,
    retry: retryOnce,
  });
  return { towns: query.data ?? [], refetch: query.refetch };
}

export function useFeltTimeline(
  eventUuid: string | null,
  enabled: boolean,
  transport: SocialTransport = SupabaseSocialTransport,
) {
  const query = useQuery<FeltTimeline | null>({
    queryKey: socialKeys.timeline(eventUuid ?? ""),
    queryFn: () => transport.fetchFeltTimeline(eventUuid as string),
    enabled: enabled && isSupabaseConfigured() && eventUuid !== null,
    staleTime: 60_000,
    retry: retryOnce,
  });
  return { timeline: query.data ?? null, refetch: query.refetch };
}

/** Hearts on the comments of one post, loaded with the comments. */
export function usePostCommentLikes(
  postId: string,
  enabled: boolean,
  transport: SocialTransport = SupabaseSocialTransport,
) {
  const account = useAccount();
  const viewer = account.userId ?? "none";
  const queryClient = useQueryClient();
  const key = socialKeys.postCommentLikes(postId, viewer);
  const query = useQuery({
    queryKey: key,
    queryFn: () => transport.fetchPostCommentLikes(postId),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 30_000,
    retry: retryOnce,
    meta: NOT_PERSISTED,
  });
  const mutation = useMutation({
    mutationFn: (input: { commentId: string; like: boolean }) =>
      transport.setPostCommentLike(input.commentId, input.like),
    onSuccess: (state, input) => {
      queryClient.setQueryData<Record<string, LikeState>>(key, (old) => ({
        ...(old ?? {}),
        [input.commentId]: state,
      }));
    },
  });
  return {
    likes: query.data ?? {},
    setLiked: (commentId: string, like: boolean) =>
      mutation.mutateAsync({ commentId, like }),
  };
}

/** Counts and "Followed by" of a profile (also a private one: counts only). */
export function useProfileHeader(
  username: string | undefined,
  transport: SocialTransport = SupabaseSocialTransport,
) {
  const account = useAccount();
  const viewer = account.userId ?? "none";
  const name = (username ?? "").toLowerCase();
  const query = useQuery<ProfileHeaderInfo | null>({
    queryKey: socialKeys.profileHeader(name, viewer),
    queryFn: () => transport.fetchProfileHeader(name),
    enabled: isSupabaseConfigured() && name !== "",
    staleTime: 30_000,
    retry: retryOnce,
    meta: NOT_PERSISTED,
  });
  return { header: query.data ?? null };
}
