import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";

import { useAccount } from "@/features/account/use-account";
import { CommunityError } from "@/features/community/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  ACTIVITY_PAGE,
  SupabaseActivityTransport,
  type ActivityTransport,
} from "./transport";
import type { ActivityItem } from "./types";

/** Personal and short-lived: never written to the on-device cache. */
const NOT_PERSISTED = { persist: false } as const;

function retryOnce(failureCount: number, error: unknown): boolean {
  if (error instanceof CommunityError && error.code === "unavailable") {
    return false;
  }
  return failureCount < 1;
}

export const activityKeys = {
  all: ["activity"] as const,
  list: (viewer: string) => ["activity", "list", viewer] as const,
  unread: (viewer: string) => ["activity", "unread", viewer] as const,
};

export interface ActivityList {
  items: ActivityItem[];
  isLoading: boolean;
  isError: boolean;
  /** Migration 0061 not applied yet: the feature hides itself. */
  isUnavailable: boolean;
  hasMore: boolean;
  isFetchingMore: boolean;
  loadMore: () => void;
  /** When the data last arrived (UTC ms): the clock for relative times. */
  updatedAt: number;
  refetch: () => Promise<unknown>;
}

/** The signed-in person's activity (guests too: replies to a guest's comment,
 * a removed guest comment, a reviewed report all reach them). */
export function useActivity(
  transport: ActivityTransport = SupabaseActivityTransport,
): ActivityList {
  const account = useAccount();
  const viewer = account.userId ?? "none";
  const enabled = isSupabaseConfigured() && account.userId !== null;
  const query = useInfiniteQuery<
    ActivityItem[],
    Error,
    InfiniteData<ActivityItem[], number | null>,
    ReturnType<typeof activityKeys.list>,
    number | null
  >({
    queryKey: activityKeys.list(viewer),
    queryFn: ({ pageParam }) => transport.fetchActivity(pageParam),
    initialPageParam: null,
    getNextPageParam: (last) =>
      last.length >= ACTIVITY_PAGE ? (last[last.length - 1]?.createdAt ?? null) : null,
    enabled,
    staleTime: 15_000,
    retry: retryOnce,
    meta: NOT_PERSISTED,
  });
  return {
    items: query.data?.pages.flat() ?? [],
    isLoading: enabled && query.isLoading,
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

/** The number on the bell; 0 while loading, offline or before the migration. */
export function useActivityUnread(
  transport: ActivityTransport = SupabaseActivityTransport,
): number {
  const account = useAccount();
  const enabled = isSupabaseConfigured() && account.userId !== null;
  const query = useQuery({
    queryKey: activityKeys.unread(account.userId ?? "none"),
    queryFn: () => transport.fetchUnread(),
    enabled,
    staleTime: 30_000,
    retry: retryOnce,
    meta: NOT_PERSISTED,
  });
  return enabled ? (query.data ?? 0) : 0;
}

export interface ActivityActions {
  /** Every row read (opening the screen). */
  markAllRead: () => Promise<void>;
  requestReview: (itemId: string, message: string) => Promise<void>;
}

export function useActivityActions(
  transport: ActivityTransport = SupabaseActivityTransport,
): ActivityActions {
  const queryClient = useQueryClient();
  const markAll = useMutation({
    mutationFn: () => transport.markRead(),
    // Only the bell: the open list keeps its "new" marks until the next visit.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["activity", "unread"] }),
  });
  const review = useMutation({
    mutationFn: (input: { itemId: string; message: string }) =>
      transport.requestReview(input.itemId, input.message),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: activityKeys.all }),
  });
  return {
    markAllRead: () => markAll.mutateAsync(),
    requestReview: (itemId, message) => review.mutateAsync({ itemId, message }),
  };
}
