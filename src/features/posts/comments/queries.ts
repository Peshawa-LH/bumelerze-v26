import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAccount } from "@/features/account/use-account";
import { communityKeys } from "@/features/community/queries";
import { CommunityError } from "@/features/community/types";
import type { ReportReason } from "@/features/reporting/reasons";
import { RECENTLY_DELETED_KEY } from "@/features/undo/keys";
import { isSupabaseConfigured } from "@/lib/supabase";
import { SupabasePostCommentsTransport, type PostCommentsTransport } from "./transport";
import type { DeletedBy } from "./types";

/** Under the `community` prefix: following, blocking and muting already
 * refresh everything there, which is exactly what changes who sees which
 * comment. Never written to the on-device cache (it depends on the viewer). */
export const postCommentKeys = {
  of: (postId: string, viewer: string) =>
    ["community", "postComments", postId, viewer] as const,
  queue: ["admin", "postComments"] as const,
};

const NOT_PERSISTED = { persist: false } as const;

export function usePostComments(
  postId: string,
  enabled: boolean,
  transport: PostCommentsTransport = SupabasePostCommentsTransport,
) {
  const account = useAccount();
  const query = useQuery({
    queryKey: postCommentKeys.of(postId, account.userId ?? "none"),
    queryFn: () => transport.fetchComments(postId),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 30_000,
    retry: (failureCount, error) =>
      !(error instanceof CommunityError && error.code === "unavailable") &&
      failureCount < 1,
    meta: NOT_PERSISTED,
  });
  return {
    comments: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    updatedAt: query.dataUpdatedAt,
    refetch: query.refetch,
  };
}

export interface PostCommentActions {
  add: (input: {
    postId: string;
    body: string;
    parentId: string | null;
    clientId: string;
  }) => Promise<{ id: string; status: "visible" | "pending" }>;
  remove: (commentId: string) => Promise<DeletedBy>;
  restore: (commentId: string) => Promise<void>;
  setCommentsOff: (postId: string, off: boolean) => Promise<void>;
  report: (
    commentId: string,
    reason: ReportReason,
    note?: string | null,
  ) => Promise<void>;
  moderate: (
    commentId: string,
    action: "approve" | "hide",
    reason?: string,
  ) => Promise<void>;
  adminRemove: (commentId: string, reason: string) => Promise<void>;
  adminRestore: (commentId: string) => Promise<void>;
}

/** Every write refreshes the comments, the posts lists (the count), the
 * "Recently deleted" list and the admin queues. */
export function usePostCommentActions(
  transport: PostCommentsTransport = SupabasePostCommentsTransport,
): PostCommentActions {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: communityKeys.all }),
      queryClient.invalidateQueries({ queryKey: RECENTLY_DELETED_KEY }),
      queryClient.invalidateQueries({ queryKey: ["admin"] }),
    ]);
  const add = useMutation({
    mutationFn: (input: Parameters<PostCommentActions["add"]>[0]) =>
      transport.addComment(input),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => transport.deleteComment(id),
    onSuccess: refresh,
  });
  const restore = useMutation({
    mutationFn: (id: string) => transport.restoreComment(id),
    onSuccess: refresh,
  });
  const off = useMutation({
    mutationFn: (input: { postId: string; off: boolean }) =>
      transport.setCommentsOff(input.postId, input.off),
    onSuccess: refresh,
  });
  const report = useMutation({
    mutationFn: (input: {
      id: string;
      reason: ReportReason;
      note?: string | null | undefined;
    }) => transport.reportComment(input.id, input.reason, input.note),
  });
  const moderate = useMutation({
    mutationFn: (input: {
      id: string;
      action: "approve" | "hide";
      reason?: string | undefined;
    }) => transport.moderate(input.id, input.action, input.reason),
    onSuccess: refresh,
  });
  const adminRemove = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      transport.adminRemove(input.id, input.reason),
    onSuccess: refresh,
  });
  const adminRestore = useMutation({
    mutationFn: (id: string) => transport.adminRestore(id),
    onSuccess: refresh,
  });
  return {
    add: (input) => add.mutateAsync(input),
    remove: (id) => remove.mutateAsync(id),
    restore: (id) => restore.mutateAsync(id),
    setCommentsOff: (postId, value) => off.mutateAsync({ postId, off: value }),
    report: (id, reason, note) => report.mutateAsync({ id, reason, note }),
    moderate: (id, action, reason) => moderate.mutateAsync({ id, action, reason }),
    adminRemove: (id, reason) => adminRemove.mutateAsync({ id, reason }),
    adminRestore: (id) => adminRestore.mutateAsync(id),
  };
}

/** Held and reported post comments, for moderators (Admin). */
export function usePostCommentQueue(
  enabled: boolean,
  transport: PostCommentsTransport = SupabasePostCommentsTransport,
) {
  return useQuery({
    queryKey: postCommentKeys.queue,
    queryFn: () => transport.fetchQueue(),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: (failureCount, error) =>
      !(error instanceof CommunityError && error.code === "unavailable") &&
      failureCount < 1,
    meta: NOT_PERSISTED,
  });
}
