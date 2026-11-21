import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useAdminAccess } from "@/features/admin/queries";
import { isSupabaseConfigured } from "@/lib/supabase";
import { accountHasPassword } from "./service";
import { fetchTwoStepEnabled, readTwoStepEnabledOnDevice } from "./two-step";
import { useAccount } from "./use-account";

/** Private account facts: kept in memory only, never in the device cache. */
const NOT_PERSISTED = { persist: false } as const;

export const twoStepKeys = {
  all: ["account", "twoStep"] as const,
  onDevice: (userId: string) => ["account", "twoStep", "onDevice", userId] as const,
  server: (userId: string) => ["account", "twoStep", "fromServer", userId] as const,
  hasPassword: (userId: string) => ["account", "hasPassword", userId] as const,
};

export interface TwoStepOffer {
  /** Show "Two-step sign-in" in My account: accounts with admin tools, and
   * any account that already has it on (so it can always be turned off). */
  offered: boolean;
  /** On, as this device knows it (no network). */
  enabled: boolean;
  /** Still finding out: show nothing yet. */
  isLoading: boolean;
}

/** Whether to offer two-step sign-in to the signed-in account, and whether
 * it is on. Everyone without admin tools sees nothing new. */
export function useTwoStepOffer(): TwoStepOffer {
  const account = useAccount();
  const admin = useAdminAccess();
  const userId = account.status === "account" ? account.userId : null;
  const onDevice = useQuery({
    queryKey: twoStepKeys.onDevice(userId ?? ""),
    queryFn: readTwoStepEnabledOnDevice,
    enabled: isSupabaseConfigured() && userId !== null,
    meta: NOT_PERSISTED,
    staleTime: 0,
  });
  const enabled = onDevice.data === true;
  return {
    offered: userId !== null && (admin.any || enabled),
    enabled,
    isLoading: userId !== null && (admin.isLoading || onDevice.isLoading),
  };
}

/** Two-step sign-in on or off, from the server (the setup screen). */
export function useTwoStepStatus(userId: string | null) {
  return useQuery({
    queryKey: twoStepKeys.server(userId ?? ""),
    queryFn: fetchTwoStepEnabled,
    enabled: isSupabaseConfigured() && userId !== null,
    meta: NOT_PERSISTED,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });
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

/** Re-reads every two-step answer after a change (on, off, a code given). */
export function useRefreshTwoStep(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: twoStepKeys.all });
  }, [queryClient]);
}
