import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import type { Event } from "@/features/events";
import { useEventUuid } from "@/features/feltmap/use-event-uuid";
import { isSupabaseConfigured } from "@/lib/supabase";
import { hasModeratorRole, loadHubThread } from "./service";
import { SupabaseEventHubTransport, type EventHubTransport } from "./transport";
import type { FlagReason, HubSummary, HubThreadData, ModerationAction } from "./types";

/** The hub re-reads this often while its screen is in front. Not a
 * background poll: it stops when the screen loses focus or the app leaves the
 * foreground (React Query's `refetchIntervalInBackground: false`). */
export const HUB_REFETCH_INTERVAL_MS = 30_000;
export const HUB_STALE_TIME_MS = 15_000;

export const eventHubKeys = {
  all: ["eventhub"] as const,
  summary: (eventUuid: string) => ["eventhub", "summary", eventUuid] as const,
  thread: (eventUuid: string, viewer: string) =>
    ["eventhub", "thread", eventUuid, viewer] as const,
  threadsOf: (eventUuid: string) => ["eventhub", "thread", eventUuid] as const,
  roles: (userId: string) => ["eventhub", "roles", userId] as const,
};

export interface UseEventHubSummaryResult {
  eventUuid: string | null;
  summary: HubSummary | null;
  isLoading: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => Promise<unknown>;
}

/**
 * The felt summary for an event (aggregates only). Resolves the registry uuid
 * the same way the felt map does; idle (null summary) when there is no
 * Supabase project, no registry entry, or the read failed.
 */
export function useEventHubSummary(
  event: Event,
  options: { polling?: boolean; transport?: EventHubTransport } = {},
): UseEventHubSummaryResult {
  const transport = options.transport ?? SupabaseEventHubTransport;
  const eventUuid = useEventUuid(event);
  const query = useQuery({
    queryKey: eventHubKeys.summary(eventUuid ?? ""),
    queryFn: () => transport.fetchSummary(eventUuid as string),
    enabled: isSupabaseConfigured() && eventUuid !== null,
    staleTime: HUB_STALE_TIME_MS,
    refetchInterval: options.polling ? HUB_REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });
  return {
    eventUuid,
    summary: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    dataUpdatedAt: query.dataUpdatedAt,
    refetch: query.refetch,
  };
}

export interface UseHubThreadResult {
  data: HubThreadData | null;
  isLoading: boolean;
  isError: boolean;
  isRefetching: boolean;
  /** Query clock (UTC ms) for relative times; 0 before the first load. */
  dataUpdatedAt: number;
  refetch: () => Promise<unknown>;
}

/**
 * The comment thread of one event. Refetches every 30 s while `focused`;
 * keyed by viewer so a sign-in or sign-out never shows the other identity's
 * own-pending comments or helpful marks.
 */
export function useHubThread(
  eventUuid: string | null,
  options: {
    viewerId: string | null;
    isAccount: boolean;
    focused: boolean;
    transport?: EventHubTransport;
  },
): UseHubThreadResult {
  const transport = options.transport ?? SupabaseEventHubTransport;
  const viewerKey = `${options.viewerId ?? "none"}:${options.isAccount ? "a" : "x"}`;
  const query = useQuery({
    queryKey: eventHubKeys.thread(eventUuid ?? "", viewerKey),
    queryFn: () =>
      loadHubThread(transport, eventUuid as string, { isAccount: options.isAccount }),
    enabled: isSupabaseConfigured() && eventUuid !== null,
    staleTime: HUB_STALE_TIME_MS,
    refetchInterval: options.focused ? HUB_REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });
  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    isRefetching: query.isRefetching,
    dataUpdatedAt: query.dataUpdatedAt,
    refetch: query.refetch,
  };
}

/** Whether the signed-in user holds a moderator-level role (official or
 * moderator). Anonymous/unknown viewers are never moderators. */
export function useIsModerator(
  userId: string | null,
  transport: EventHubTransport = SupabaseEventHubTransport,
): boolean {
  const query = useQuery({
    queryKey: eventHubKeys.roles(userId ?? ""),
    queryFn: async () => {
      const roles = await transport.fetchRoles([userId as string]);
      return hasModeratorRole(roles[userId as string]);
    },
    enabled: isSupabaseConfigured() && userId !== null,
    staleTime: 10 * 60_000,
  });
  return query.data === true;
}

function refresh(queryClient: QueryClient, eventUuid: string): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: eventHubKeys.threadsOf(eventUuid) }),
    queryClient.invalidateQueries({ queryKey: eventHubKeys.summary(eventUuid) }),
  ]);
}

export interface HubActions {
  post: (input: { parentId: string | null; body: string }) => Promise<void>;
  setHelpful: (commentId: string, helpful: boolean) => Promise<void>;
  flag: (commentId: string, reason: FlagReason) => Promise<void>;
  remove: (commentId: string) => Promise<void>;
  moderate: (commentId: string, action: ModerationAction) => Promise<void>;
}

/** Write actions for one event's hub. Each refreshes the thread (and the
 * summary's comment count) on success; failures reject with a `HubError` for
 * the caller to word. */
export function useHubActions(
  eventUuid: string,
  transport: EventHubTransport = SupabaseEventHubTransport,
): HubActions {
  const queryClient = useQueryClient();

  const post = useMutation({
    mutationFn: (input: { parentId: string | null; body: string }) =>
      transport.postComment({ eventUuid, parentId: input.parentId, body: input.body }),
    onSuccess: () => refresh(queryClient, eventUuid),
  });
  const helpful = useMutation({
    mutationFn: (input: { commentId: string; helpful: boolean }) =>
      transport.setHelpful(input.commentId, input.helpful),
    onSuccess: () => refresh(queryClient, eventUuid),
  });
  const flag = useMutation({
    mutationFn: (input: { commentId: string; reason: FlagReason }) =>
      transport.flagComment(input.commentId, input.reason),
    onSuccess: () => refresh(queryClient, eventUuid),
  });
  const remove = useMutation({
    mutationFn: (commentId: string) => transport.deleteComment(commentId),
    onSuccess: () => refresh(queryClient, eventUuid),
  });
  const moderate = useMutation({
    mutationFn: (input: { commentId: string; action: ModerationAction }) =>
      transport.moderateComment(input.commentId, input.action),
    onSuccess: () => refresh(queryClient, eventUuid),
  });

  return {
    post: (input) => post.mutateAsync(input),
    setHelpful: (commentId, value) => helpful.mutateAsync({ commentId, helpful: value }),
    flag: (commentId, reason) => flag.mutateAsync({ commentId, reason }),
    remove: (commentId) => remove.mutateAsync(commentId),
    moderate: (commentId, action) => moderate.mutateAsync({ commentId, action }),
  };
}
