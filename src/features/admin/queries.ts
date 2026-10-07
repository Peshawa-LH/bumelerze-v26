import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAccount } from "@/features/account/use-account";
import { communityKeys } from "@/features/community/queries";
import { eventHubKeys, useMyPermissions } from "@/features/eventhub/queries";
import {
  SupabaseEventHubTransport,
  type EventHubTransport,
} from "@/features/eventhub/transport";
import type { ModerationAction, Permission } from "@/features/eventhub/types";
import { isSupabaseConfigured } from "@/lib/supabase";
import { SupabaseAdminTransport, type AdminTransport } from "./transport";
import type { GrantableRank } from "./types";

const NOT_PERSISTED = { persist: false } as const;

export const adminKeys = {
  all: ["admin"] as const,
  queue: ["admin", "queue"] as const,
  holders: ["admin", "holders"] as const,
  reports: ["admin", "reports"] as const,
};

export interface AdminAccess {
  /** Which tools to show. All false before the permissions are known, for
   * anonymous installs, and when the server predates migration 0043. */
  canModerate: boolean;
  canDelete: boolean;
  canGrant: boolean;
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
  return {
    canModerate,
    canDelete,
    canGrant,
    any: canModerate || canGrant,
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
}

export function useAdminActions(
  transport: AdminTransport = SupabaseAdminTransport,
  hubTransport?: EventHubTransport,
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

  return {
    moderate: (commentId, action) => moderate.mutateAsync({ commentId, action }),
    remove: (commentId, reason) => remove.mutateAsync({ commentId, reason }),
    grant: (input) => grant.mutateAsync(input),
    revoke: (username, role) => revoke.mutateAsync({ username, role }),
    resolveReports: (userId) => resolveReports.mutateAsync(userId),
  };
}
