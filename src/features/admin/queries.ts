import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useAccount } from "@/features/account/use-account";
import { communityKeys } from "@/features/community/queries";
import { eventHubKeys, useMyPermissions } from "@/features/eventhub/queries";
import {
  SupabaseEventHubTransport,
  type EventHubTransport,
} from "@/features/eventhub/transport";
import type { ModerationAction, Permission } from "@/features/eventhub/types";
import { SupabasePostsTransport, type PostsTransport } from "@/features/posts/transport";
import {
  SupabasePostCommentsTransport,
  type PostCommentsTransport,
} from "@/features/posts/comments/transport";
import { isSupabaseConfigured } from "@/lib/supabase";
import { SupabaseAdminTransport, type AdminTransport } from "./transport";
import type { ActivityFilters, GrantableRank } from "./types";
import { ACTIVITY_PAGE_SIZE, HIDDEN_PAGE_SIZE } from "./types";

const NOT_PERSISTED = { persist: false } as const;

export const adminKeys = {
  all: ["admin"] as const,
  queue: ["admin", "queue"] as const,
  holders: ["admin", "holders"] as const,
  reports: ["admin", "reports"] as const,
  posts: ["admin", "posts"] as const,
  hidden: ["admin", "hidden"] as const,
  activity: (filters: ActivityFilters) =>
    ["admin", "activity", filters.action, filters.targetUserId] as const,
};

export interface AdminAccess {
  /** Which tools to show. All false before the permissions are known, for
   * anonymous installs, and when the server predates migration 0043. */
  canModerate: boolean;
  canDelete: boolean;
  canGrant: boolean;
  /** May remove anyone's profile post (`posts.delete`). */
  canRemovePosts: boolean;
  /** May reset someone's password (`accounts.reset_password`, migration 0051). */
  canResetPasswords: boolean;
  /** May read the activity log (`audit.read`, migration 0052). */
  canAudit: boolean;
  /** Reads every kind of action, not only content actions (`audit.read_all`). */
  canAuditAll: boolean;
  /** May bring back what an admin removed (`content.restore`, migration 0053). */
  canRestore: boolean;
  /** May warn, restrict and lift (`accounts.restrict`, migration 0054). */
  canRestrict: boolean;
  /** May suspend (`accounts.suspend`, official). */
  canSuspend: boolean;
  /** May open the People directory (`people.view`, migration 0055). */
  canViewPeople: boolean;
  /** Sees full emails on request (`people.view_email`, official). */
  canViewEmail: boolean;
  /** Sees the guest installs (`people.view_guests`, official). */
  canViewGuests: boolean;
  /** Reads and triages feedback (`feedback.manage`, migration 0060). */
  canManageFeedback: boolean;
  /** Approves or rejects felt-report photos (`photos.moderate`, 0060). */
  canModeratePhotos: boolean;
  /** Any admin tool at all: the entry in My account shows when true. */
  any: boolean;
  /** Permissions still loading: show nothing yet rather than "not allowed". */
  isLoading: boolean;
  has: (permission: Permission) => boolean;
}

export function useAdminAccess(hubTransport?: EventHubTransport): AdminAccess {
  const account = useAccount();
  const userId = account.status === "account" ? account.userId : null;
  const perms = useMyPermissions(userId, hubTransport);
  // Admin tools need the real server answer; the role-based fallback for an
  // old server only keeps approve/hide in the Event hub.
  const server = !perms.legacy;
  const canModerate = server && perms.has("comments.moderate");
  const canDelete = server && perms.has("comments.delete");
  const canGrant = server && perms.has("badges.grant");
  const canRemovePosts = server && perms.has("posts.delete");
  const canResetPasswords = server && perms.has("accounts.reset_password");
  const canAuditAll = server && perms.has("audit.read_all");
  const canAudit = canAuditAll || (server && perms.has("audit.read"));
  const canRestore = server && perms.has("content.restore");
  const canRestrict = server && perms.has("accounts.restrict");
  const canSuspend = server && perms.has("accounts.suspend");
  const canViewPeople = server && perms.has("people.view");
  const canViewEmail = server && perms.has("people.view_email");
  const canViewGuests = server && perms.has("people.view_guests");
  const canManageFeedback = server && perms.has("feedback.manage");
  const canModeratePhotos = server && perms.has("photos.moderate");
  return {
    canManageFeedback,
    canModeratePhotos,
    canViewPeople,
    canViewEmail,
    canViewGuests,
    canRestore,
    canRestrict,
    canSuspend,
    canModerate,
    canDelete,
    canRemovePosts,
    canGrant,
    canResetPasswords,
    canAudit,
    canAuditAll,
    any:
      canModerate ||
      canGrant ||
      canAudit ||
      canRestrict ||
      canViewPeople ||
      canManageFeedback ||
      canModeratePhotos ||
      (server && perms.has("alerts.test")),
    isLoading: perms.isLoading,
    has: (permission) => server && perms.has(permission),
  };
}

export function useModerationQueue(
  enabled: boolean,
  transport: AdminTransport = SupabaseAdminTransport,
) {
  return useQuery({
    queryKey: adminKeys.queue,
    queryFn: () => transport.fetchQueue(),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

export function useRoleHolders(
  enabled: boolean,
  transport: AdminTransport = SupabaseAdminTransport,
) {
  return useQuery({
    queryKey: adminKeys.holders,
    queryFn: () => transport.fetchRoleHolders(),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

export function useReportedProfiles(
  enabled: boolean,
  transport: AdminTransport = SupabaseAdminTransport,
) {
  return useQuery({
    queryKey: adminKeys.reports,
    queryFn: () => transport.fetchReportedProfiles(),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

export function useReportedPosts(
  enabled: boolean,
  transport: AdminTransport = SupabaseAdminTransport,
) {
  return useQuery({
    queryKey: adminKeys.posts,
    queryFn: () => transport.fetchReportedPosts(),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

/** The activity log, 50 rows a page, newest first. `fetchNextPage` loads the
 * next 50 (keyset on the last row's timestamp). */
export function useAdminActivity(
  filters: ActivityFilters,
  enabled: boolean,
  transport: AdminTransport = SupabaseAdminTransport,
) {
  return useInfiniteQuery({
    queryKey: adminKeys.activity(filters),
    queryFn: ({ pageParam }) => transport.fetchActivity(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.length >= ACTIVITY_PAGE_SIZE
        ? (lastPage[lastPage.length - 1]?.cursor ?? null)
        : null,
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

/** Hidden comments and removed comments and posts of the last 30 days,
 * newest first (migration 0053). */
export function useHiddenRemoved(
  enabled: boolean,
  transport: AdminTransport = SupabaseAdminTransport,
) {
  return useInfiniteQuery({
    queryKey: adminKeys.hidden,
    queryFn: ({ pageParam }) => transport.fetchHiddenRemoved(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.length >= HIDDEN_PAGE_SIZE
        ? (lastPage[lastPage.length - 1]?.cursor ?? null)
        : null,
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

export interface AdminActions {
  moderate: (commentId: string, action: ModerationAction) => Promise<void>;
  remove: (commentId: string, reason: string) => Promise<void>;
  grant: (input: {
    username: string;
    role: GrantableRank;
    orgName?: string | null;
    note?: string | null;
  }) => Promise<void>;
  revoke: (username: string, role: GrantableRank) => Promise<void>;
  resolveReports: (userId: string) => Promise<void>;
  dismissPostReports: (postId: string) => Promise<void>;
  /** Soft remove a reported profile post (`posts.delete`). */
  removePost: (postId: string, reason: string) => Promise<void>;
  /** The Undo of a hide or remove of a comment (migration 0053). */
  restoreComment: (commentId: string) => Promise<void>;
  /** The Undo of a post removal (`content.restore`). */
  restorePost: (postId: string) => Promise<void>;
  /** Undoes the action in one activity row. */
  undoAction: (logId: string) => Promise<void>;
  /** The Undo of a hide or remove of a comment under a post (0063). */
  restorePostComment: (commentId: string) => Promise<void>;
}

export function useAdminActions(
  transport: AdminTransport = SupabaseAdminTransport,
  hubTransport?: EventHubTransport,
  postsTransport: PostsTransport = SupabasePostsTransport,
  postCommentsTransport: PostCommentsTransport = SupabasePostCommentsTransport,
): AdminActions {
  const queryClient = useQueryClient();
  const hub = hubTransport ?? SupabaseEventHubTransport;
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.all }),
      queryClient.invalidateQueries({ queryKey: eventHubKeys.all }),
      queryClient.invalidateQueries({ queryKey: communityKeys.all }),
    ]);

  const moderate = useMutation({
    mutationFn: (input: { commentId: string; action: ModerationAction }) =>
      hub.moderateComment(input.commentId, input.action),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (input: { commentId: string; reason: string }) =>
      hub.adminDeleteComment(input.commentId, input.reason),
    onSuccess: refresh,
  });
  const grant = useMutation({
    mutationFn: (input: Parameters<AdminActions["grant"]>[0]) =>
      transport.grantRole(input),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (input: { username: string; role: GrantableRank }) =>
      transport.revokeRole(input.username, input.role),
    onSuccess: refresh,
  });
  const resolveReports = useMutation({
    mutationFn: (userId: string) => transport.resolveProfileReports(userId),
    onSuccess: refresh,
  });

  const dismissPostReports = useMutation({
    mutationFn: (postId: string) => transport.dismissPostReports(postId),
    onSuccess: refresh,
  });
  const removePost = useMutation({
    mutationFn: (input: { postId: string; reason: string }) =>
      postsTransport.adminRemovePost(input.postId, input.reason),
    onSuccess: refresh,
  });

  const restoreComment = useMutation({
    mutationFn: (commentId: string) => hub.adminRestoreComment(commentId),
    onSuccess: refresh,
  });
  const restorePost = useMutation({
    mutationFn: (postId: string) => postsTransport.adminRestorePost(postId),
    onSuccess: refresh,
  });
  const undoAction = useMutation({
    mutationFn: (logId: string) => transport.undoAction(logId),
    onSuccess: refresh,
  });
  const restorePostComment = useMutation({
    mutationFn: (commentId: string) => postCommentsTransport.adminRestore(commentId),
    onSuccess: refresh,
  });

  return {
    restoreComment: (commentId) => restoreComment.mutateAsync(commentId),
    restorePost: (postId) => restorePost.mutateAsync(postId),
    undoAction: (logId) => undoAction.mutateAsync(logId),
    moderate: (commentId, action) => moderate.mutateAsync({ commentId, action }),
    remove: (commentId, reason) => remove.mutateAsync({ commentId, reason }),
    grant: (input) => grant.mutateAsync(input),
    revoke: (username, role) => revoke.mutateAsync({ username, role }),
    resolveReports: (userId) => resolveReports.mutateAsync(userId),
    dismissPostReports: (postId) => dismissPostReports.mutateAsync(postId),
    removePost: (postId, reason) => removePost.mutateAsync({ postId, reason }),
    restorePostComment: (commentId) => restorePostComment.mutateAsync(commentId),
  };
}
