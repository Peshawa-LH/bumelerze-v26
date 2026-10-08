import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAccount } from "@/features/account/use-account";
import { eventHubKeys } from "@/features/eventhub/queries";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { ProfileReportReason } from "./constants";
import { SupabaseCommunityTransport, type CommunityTransport } from "./transport";
import {
  CommunityError,
  type FollowRequest,
  type FollowStatus,
  type Person,
  type PublicProfile,
} from "./types";

/** Social-graph data is personal and depends on who is looking, so none of it
 * is written to the on-device cache (`persist: false`). */
const NOT_PERSISTED = { persist: false } as const;

/** One retry for a flaky network; none when the server simply lacks the
 * function (migration not applied) — that answer will not change. */
function retryOnce(failureCount: number, error: unknown): boolean {
  if (error instanceof CommunityError && error.code === "unavailable") {
    return false;
  }
  return failureCount < 1;
}

export const communityKeys = {
  all: ["community"] as const,
  profile: (username: string, viewer: string) =>
    ["community", "profile", username, viewer] as const,
  list: (username: string, kind: string, viewer: string) =>
    ["community", "list", username, kind, viewer] as const,
  requests: (viewer: string) => ["community", "requests", viewer] as const,
  blocks: (viewer: string) => ["community", "blocks", viewer] as const,
};

export interface UseQueryState<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
}

export function usePublicProfile(
  username: string | undefined,
  transport: CommunityTransport = SupabaseCommunityTransport,
): UseQueryState<PublicProfile | null> {
  const account = useAccount();
  const viewer = account.userId ?? "none";
  const name = (username ?? "").toLowerCase();
  const query = useQuery({
    queryKey: communityKeys.profile(name, viewer),
    queryFn: () => transport.fetchPublicProfile(name),
    enabled: isSupabaseConfigured() && name !== "",
    staleTime: 30_000,
    retry: retryOnce,
    meta: NOT_PERSISTED,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useFollowList(
  username: string | undefined,
  kind: "followers" | "following",
  transport: CommunityTransport = SupabaseCommunityTransport,
): UseQueryState<Person[]> {
  const account = useAccount();
  const viewer = account.userId ?? "none";
  const name = (username ?? "").toLowerCase();
  const query = useQuery({
    queryKey: communityKeys.list(name, kind, viewer),
    queryFn: () => transport.fetchFollowList(name, kind),
    enabled: isSupabaseConfigured() && name !== "",
    staleTime: 30_000,
    retry: retryOnce,
    meta: NOT_PERSISTED,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Pending follow requests to the signed-in account (accounts only). */
export function useFollowRequests(
  transport: CommunityTransport = SupabaseCommunityTransport,
): UseQueryState<FollowRequest[]> {
  const account = useAccount();
  const enabled = isSupabaseConfigured() && account.status === "account";
  const query = useQuery({
    queryKey: communityKeys.requests(account.userId ?? "none"),
    queryFn: () => transport.fetchFollowRequests(),
    enabled,
    staleTime: 30_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
  return {
    data: query.data,
    isLoading: enabled && query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useBlockedPeople(
  transport: CommunityTransport = SupabaseCommunityTransport,
): UseQueryState<Person[]> {
  const account = useAccount();
  const enabled = isSupabaseConfigured() && account.userId !== null;
  const query = useQuery({
    queryKey: communityKeys.blocks(account.userId ?? "none"),
    queryFn: () => transport.fetchBlocks(),
    enabled,
    staleTime: 30_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
  return {
    data: query.data,
    isLoading: enabled && query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export interface CommunityActions {
  follow: (userId: string) => Promise<Exclude<FollowStatus, "none">>;
  unfollow: (userId: string) => Promise<void>;
  /** The Undo of an unfollow (60 seconds). */
  undoUnfollow: (userId: string) => Promise<void>;
  accept: (userId: string) => Promise<void>;
  decline: (userId: string) => Promise<void>;
  /** The Undo of a declined request (60 seconds). */
  undoDecline: (userId: string) => Promise<void>;
  block: (userId: string) => Promise<void>;
  unblock: (userId: string) => Promise<void>;
  report: (
    userId: string,
    reason: ProfileReportReason,
    note?: string | null,
  ) => Promise<void>;
}

/** Write actions. Each refreshes the community data and the Event hub
 * threads (a block hides comments, a follow changes the thread order);
 * failures reject with a `CommunityError` for the caller to word. */
export function useCommunityActions(
  transport: CommunityTransport = SupabaseCommunityTransport,
): CommunityActions {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: communityKeys.all }),
      queryClient.invalidateQueries({ queryKey: eventHubKeys.all }),
    ]);

  const follow = useMutation({
    mutationFn: (userId: string) => transport.follow(userId),
    onSuccess: refresh,
  });
  const unfollow = useMutation({
    mutationFn: (userId: string) => transport.unfollow(userId),
    onSuccess: refresh,
  });
  const undoUnfollow = useMutation({
    mutationFn: (userId: string) => transport.undoUnfollow(userId),
    onSuccess: refresh,
  });
  const undoDecline = useMutation({
    mutationFn: (userId: string) => transport.undoDecline(userId),
    onSuccess: refresh,
  });
  const accept = useMutation({
    mutationFn: (userId: string) => transport.acceptRequest(userId),
    onSuccess: refresh,
  });
  const decline = useMutation({
    mutationFn: (userId: string) => transport.declineRequest(userId),
    onSuccess: refresh,
  });
  const block = useMutation({
    mutationFn: (userId: string) => transport.block(userId),
    onSuccess: refresh,
  });
  const unblock = useMutation({
    mutationFn: (userId: string) => transport.unblock(userId),
    onSuccess: refresh,
  });
  const report = useMutation({
    mutationFn: (input: {
      userId: string;
      reason: ProfileReportReason;
      note?: string | null | undefined;
    }) => transport.reportProfile(input.userId, input.reason, input.note),
    onSuccess: refresh,
  });

  return {
    follow: (userId) => follow.mutateAsync(userId),
    unfollow: (userId) => unfollow.mutateAsync(userId),
    undoUnfollow: async (userId) => {
      await undoUnfollow.mutateAsync(userId);
    },
    undoDecline: (userId) => undoDecline.mutateAsync(userId),
    accept: (userId) => accept.mutateAsync(userId),
    decline: (userId) => decline.mutateAsync(userId),
    block: (userId) => block.mutateAsync(userId),
    unblock: (userId) => unblock.mutateAsync(userId),
    report: (userId, reason, note) => report.mutateAsync({ userId, reason, note }),
  };
}
