import {
  useIsRestoring,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";

import { useAdminAccess } from "@/features/admin/queries";
import { eventHubKeys } from "@/features/eventhub/queries";
import { isSupabaseConfigured } from "@/lib/supabase";
import { accountHasPassword } from "./service";
import { adminNeedsTwoStep, readTwoStepEnabledOnDevice } from "./two-step";
import { useAccount } from "./use-account";

/** Private account facts: kept in memory only, never in the device cache. */
const NOT_PERSISTED = { persist: false } as const;

/** As long as the permissions it goes with (`useMyPermissions`): both
 * change only at sign-in, sign-out and a two-step code, and each of those
 * re-reads both at once (`useRefreshTwoStep`). */
const ADMIN_NEEDS_STALE_MS = 10 * 60_000;

export const twoStepKeys = {
  all: ["account", "twoStep"] as const,
  onDevice: (userId: string) => ["account", "twoStep", "onDevice", userId] as const,
  adminNeeds: (userId: string) => ["account", "twoStep", "adminNeeds", userId] as const,
  hasPassword: (userId: string) => ["account", "hasPassword", userId] as const,
};

/** The signed-in account's id; null for a guest and before sign-in. */
function useAccountUserId(): string | null {
  const account = useAccount();
  return account.status === "account" ? account.userId : null;
}

/** Known only once the permissions query has an answer (or failed): its
 * `isLoading` is false while the device cache is still being restored, and
 * deciding then would turn an admin away. The callers also call
 * `useAdminAccess`, which keeps them subscribed to that query, so the state
 * read here is current. */
function permissionsKnown(queryClient: QueryClient, userId: string | null): boolean {
  if (!userId) {
    return false;
  }
  const state = queryClient.getQueryState(eventHubKeys.permissions(userId));
  return state?.status === "success" || state?.status === "error";
}

function useTwoStepOnDevice(userId: string | null) {
  return useQuery({
    queryKey: twoStepKeys.onDevice(userId ?? ""),
    queryFn: readTwoStepEnabledOnDevice,
    enabled: isSupabaseConfigured() && userId !== null,
    meta: NOT_PERSISTED,
    staleTime: 0,
  });
}

export interface AdminNeedsTwoStep {
  /** The account holds an admin rank, but this session has not given a
   * two-step code (or two-step sign-in is off): the admin tools stay closed
   * until it does (migration 0076). */
  needed: boolean;
  /** Still asking the server. */
  isLoading: boolean;
}

/**
 * Whether the admin tools are closed only for want of two-step sign-in
 * (`my_admin_needs_two_step()`, security checklist A1.1). Asked only for a
 * signed-in account whose permissions are known and open no admin tool: an
 * account with admin tools has already given its code, and a guest is never
 * asked. The private admin rank cannot be seen from the app (0060), so every
 * other signed-in account asks once (one small request, kept ten minutes in
 * memory, never in the device cache). When it cannot tell (offline, an
 * error, a server before 0076) the answer is no: the admin pages look as
 * they did before.
 */
export function useAdminNeedsTwoStep(): AdminNeedsTwoStep {
  const userId = useAccountUserId();
  const admin = useAdminAccess();
  const queryClient = useQueryClient();
  const enabled =
    isSupabaseConfigured() &&
    userId !== null &&
    permissionsKnown(queryClient, userId) &&
    !admin.any;
  const query = useQuery({
    queryKey: twoStepKeys.adminNeeds(userId ?? ""),
    queryFn: adminNeedsTwoStep,
    enabled,
    meta: NOT_PERSISTED,
    staleTime: ADMIN_NEEDS_STALE_MS,
    retry: 1,
    // Offline it fails at once (answer: no) instead of waiting, paused, for
    // a connection: no page may stay on "Loading..." because of it.
    networkMode: "always",
  });
  return {
    needed: enabled && query.data === true,
    isLoading: enabled && query.isPending,
  };
}

export interface TwoStepOffer {
  /** Show "Two-step sign-in" in My account: accounts with admin tools,
   * admins whose tools wait for it (migration 0076), and any account that
   * already has it on (so it can always be turned off). */
  offered: boolean;
  /** On, as this device knows it (no network). */
  enabled: boolean;
  /** Still finding out: show nothing yet. */
  isLoading: boolean;
}

/** Whether to offer two-step sign-in to the signed-in account, and whether
 * it is on. Everyone without admin tools sees nothing new. */
export function useTwoStepOffer(): TwoStepOffer {
  const admin = useAdminAccess();
  const needs = useAdminNeedsTwoStep();
  const queryClient = useQueryClient();
  const isRestoring = useIsRestoring();
  const userId = useAccountUserId();
  const onDevice = useTwoStepOnDevice(userId);
  const enabled = onDevice.data === true;
  return {
    offered: userId !== null && (admin.any || needs.needed || enabled),
    enabled,
    isLoading:
      userId !== null &&
      isSupabaseConfigured() &&
      (isRestoring ||
        !permissionsKnown(queryClient, userId) ||
        admin.isLoading ||
        needs.isLoading ||
        onDevice.isPending),
  };
}

/** What an admin page shows: its tools ("open"), or, while this session
 * has no two-step code, one card saying what to do: "turnOn" when two-step
 * sign-in is off on the account, "enterCode" when it is on. */
export type AdminTwoStepState = "loading" | "open" | "turnOn" | "enterCode";

export function useAdminTwoStepState(): AdminTwoStepState {
  const needs = useAdminNeedsTwoStep();
  const onDevice = useTwoStepOnDevice(useAccountUserId());
  if (needs.isLoading) {
    return "loading";
  }
  if (!needs.needed) {
    return "open";
  }
  if (onDevice.isPending) {
    return "loading";
  }
  return onDevice.data === true ? "enterCode" : "turnOn";
}

/** Whether the account has a password yet (the Password screen); `null`
 * before migration 0075 is on the server. */
export function useAccountHasPassword(userId: string | null) {
  return useQuery({
    queryKey: twoStepKeys.hasPassword(userId ?? ""),
    queryFn: accountHasPassword,
    enabled: isSupabaseConfigured() && userId !== null,
    meta: NOT_PERSISTED,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });
}

/** Re-reads every two-step answer and the permissions after anything that
 * moves the session between aal1 and aal2 or between accounts: two-step
 * sign-in turned on or off, a code given, a sign-in, a sign-out. From
 * migration 0076 on, admin tools follow the session's level, so this is
 * what makes them appear or go without a restart. */
export function useRefreshTwoStep(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: twoStepKeys.all });
    void queryClient.invalidateQueries({ queryKey: eventHubKeys.permissionsAll });
  }, [queryClient]);
}
