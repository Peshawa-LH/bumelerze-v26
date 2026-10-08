import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type { HubRoleKind } from "@/features/eventhub/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { SupabaseInboxTransport, type InboxTransport } from "./transport";
import { FEEDBACK_PAGE_SIZE, type FeedbackFilters, type FeedbackStatus } from "./types";

/** Private correspondence: never written to the on-device cache. */
const NOT_PERSISTED = { persist: false } as const;

/** Under "admin", so every admin action that refreshes the admin lists
 * refreshes these too. */
export const inboxKeys = {
  all: ["admin", "inbox"] as const,
  counts: ["admin", "inbox", "counts"] as const,
  list: (filters: FeedbackFilters) =>
    ["admin", "inbox", "list", filters.status, filters.category, filters.search] as const,
  detail: (id: string) => ["admin", "inbox", "detail", id] as const,
  screenshots: (id: string) => ["admin", "inbox", "screenshots", id] as const,
};

/** Open feedback, badge requests, appeals and waiting photos, for the Admin
 * page. One cheap call. */
export function useInboxCounts(
  enabled: boolean,
  transport: InboxTransport = SupabaseInboxTransport,
) {
  return useQuery({
    queryKey: inboxKeys.counts,
    queryFn: () => transport.counts(),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 30_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

/** The inbox, 50 a page, newest first; `fetchNextPage` loads the next 50. */
export function useFeedbackList(
  filters: FeedbackFilters,
  enabled: boolean,
  transport: InboxTransport = SupabaseInboxTransport,
) {
  return useInfiniteQuery({
    queryKey: inboxKeys.list(filters),
    queryFn: ({ pageParam }) => transport.list(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.length >= FEEDBACK_PAGE_SIZE
        ? (lastPage[lastPage.length - 1]?.cursor ?? null)
        : null,
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

export function useFeedbackDetail(
  feedbackId: string,
  enabled: boolean,
  transport: InboxTransport = SupabaseInboxTransport,
) {
  return useQuery({
    queryKey: inboxKeys.detail(feedbackId),
    queryFn: () => transport.get(feedbackId),
    enabled: enabled && feedbackId !== "" && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

/** Signed links to the screenshots; they expire after ten minutes, so they
 * are refreshed after five. */
export function useScreenshots(
  feedbackId: string,
  paths: readonly string[],
  transport: InboxTransport = SupabaseInboxTransport,
) {
  return useQuery({
    queryKey: [...inboxKeys.screenshots(feedbackId), paths.join("|")],
    queryFn: () => transport.signScreenshots([...paths]),
    enabled: paths.length > 0 && isSupabaseConfigured(),
    staleTime: 5 * 60_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

export interface InboxActions {
  setStatus: (
    feedbackId: string,
    status: FeedbackStatus,
    note: string | null,
  ) => Promise<void>;
  grantBadge: (
    feedbackId: string,
    role: HubRoleKind,
    orgName: string | null,
  ) => Promise<void>;
}

export function useInboxActions(
  transport: InboxTransport = SupabaseInboxTransport,
): InboxActions {
  const queryClient = useQueryClient();
  // the inbox, the activity log (new audit rows) and the rank holders
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin"] });
  const status = useMutation({
    mutationFn: (input: {
      feedbackId: string;
      status: FeedbackStatus;
      note: string | null;
    }) => transport.setStatus(input.feedbackId, input.status, input.note),
    onSuccess: refresh,
  });
  const grant = useMutation({
    mutationFn: (input: {
      feedbackId: string;
      role: HubRoleKind;
      orgName: string | null;
    }) => transport.grantBadge(input.feedbackId, input.role, input.orgName),
    onSuccess: refresh,
  });
  return {
    setStatus: (feedbackId, s, note) =>
      status.mutateAsync({ feedbackId, status: s, note }),
    grantBadge: (feedbackId, role, orgName) =>
      grant.mutateAsync({ feedbackId, role, orgName }),
  };
}
