import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAccount } from "@/features/account/use-account";
import { communityKeys } from "@/features/community/queries";
import { CommunityError } from "@/features/community/types";
import { eventHubKeys } from "@/features/eventhub/queries";
import { isSupabaseConfigured } from "@/lib/supabase";
import { SupabaseRestrictionsTransport, type RestrictionsTransport } from "./transport";
import {
  isInForce,
  limitsWriting,
  type AdminRestriction,
  type MyRestriction,
  type RestrictInput,
} from "./types";

/** Personal and short-lived: never written to the on-device cache. */
const NOT_PERSISTED = { persist: false } as const;

export const restrictionKeys = {
  all: ["restrictions"] as const,
  mine: (viewer: string) => ["restrictions", "mine", viewer] as const,
  /** Under "admin" so every admin action that refreshes the admin lists also
   * refreshes this one. */
  adminList: ["admin", "restrictions"] as const,
};

export interface MyRestrictionState {
  /** The limit in force, or null (also while loading, offline, or before the
   * migration is applied: the server enforces it either way). */
  restriction: MyRestriction | null;
  /** A restrict or a suspend: the person cannot write. */
  isLimited: boolean;
  isSuspended: boolean;
  /** Re-reads the limit (after a write the server refused). */
  refresh: () => Promise<unknown>;
}

/** The signed-in identity's own limit, for the banner and the disabled
 * composers. Guests are included (a guest identity can be limited too). */
export function useMyRestriction(
  transport: RestrictionsTransport = SupabaseRestrictionsTransport,
): MyRestrictionState {
  const account = useAccount();
  const viewer = account.userId;
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: restrictionKeys.mine(viewer ?? "none"),
    queryFn: async () => {
      try {
        return await transport.fetchMine();
      } catch (error) {
        if (error instanceof CommunityError && error.code === "unavailable") {
          return null;
        }
        throw error;
      }
    },
    // a limit that has ended since the last read must not keep showing
    select: (found) => (found && isInForce(found, Date.now()) ? found : null),
    enabled: isSupabaseConfigured() && viewer !== null,
    staleTime: 60_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
  const restriction = query.data ?? null;
  return {
    restriction,
    isLimited: restriction !== null && limitsWriting(restriction.level),
    isSuspended: restriction?.level === "suspend",
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: restrictionKeys.mine(viewer ?? "none") }),
  };
}

/** "Ask for review": sends the message, then re-reads the limit so the banner
 * shows "Review requested". */
export function useRequestReview(
  transport: RestrictionsTransport = SupabaseRestrictionsTransport,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { restrictionId: string; message: string }) =>
      transport.requestReview(input.restrictionId, input.message),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: restrictionKeys.all }),
  });
}

export function useAdminRestrictions(
  enabled: boolean,
  transport: RestrictionsTransport = SupabaseRestrictionsTransport,
) {
  return useQuery<AdminRestriction[]>({
    queryKey: restrictionKeys.adminList,
    queryFn: () => transport.fetchAdminList(null),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

export interface RestrictionActions {
  /** Applies a limit; resolves with the id the Undo lifts. */
  restrict: (input: RestrictInput) => Promise<string>;
  lift: (restrictionId: string) => Promise<void>;
}

/** Admin writes. Each refreshes the admin lists, the Activity log, the Event
 * hub threads (a suspension hides comments) and the community data. */
export function useRestrictionActions(
  transport: RestrictionsTransport = SupabaseRestrictionsTransport,
): RestrictionActions {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin"] }),
      queryClient.invalidateQueries({ queryKey: restrictionKeys.all }),
      queryClient.invalidateQueries({ queryKey: eventHubKeys.all }),
      queryClient.invalidateQueries({ queryKey: communityKeys.all }),
    ]);
  const restrict = useMutation({
    mutationFn: (input: RestrictInput) => transport.restrict(input),
    onSuccess: refresh,
  });
  const lift = useMutation({
    mutationFn: (restrictionId: string) => transport.lift(restrictionId),
    onSuccess: refresh,
  });
  return {
    restrict: (input) => restrict.mutateAsync(input),
    lift: (restrictionId) => lift.mutateAsync(restrictionId),
  };
}
