import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { useSnackbar } from "@/components/Snackbar";
import { useAccount } from "@/features/account/use-account";
import { useMyHomes } from "@/features/building/queries";
import type { EventRegistration } from "@/features/felt";
import { isSupabaseConfigured } from "@/lib/supabase";

import { UNDO_MS } from "./constants";
import { enqueueCheckIn, undoCheckIn } from "./queue";
import {
  SupabaseCheckInTransport,
  SupabaseFamilyCheckInTransport,
  type CheckInTransport,
  type FamilyCheckIns,
  type FamilyCheckInTransport,
} from "./transport";

/** `provider:providerId`, the key the phone remembers an event by. */
export function registrationKey(
  event: Pick<EventRegistration, "provider" | "providerId">,
): string {
  return `${event.provider}:${event.providerId}`;
}

/**
 * Who a check-in can reach from this phone:
 * - "family": an account in at least one home. The tap is queued for the
 *   home family (and the share sheet stays available).
 * - "share": a guest, or an account without a home. Nothing is stored on our
 *   server; the tap opens the share sheet (design note Q5).
 * While the homes are still loading an account counts as "family": a row
 * nobody can read is harmless, a lost tap is not.
 */
export type CheckInAudience = "family" | "share";

export interface CheckInAudienceInfo {
  audience: CheckInAudience;
  /** Why it is "share": no account at all, or an account without a home. */
  reason: "guest" | "no_home" | null;
}

export function useCheckInAudience(): CheckInAudienceInfo {
  const account = useAccount();
  const homes = useMyHomes();
  if (account.status !== "account") {
    return { audience: "share", reason: "guest" };
  }
  if (homes.data && !homes.isLoading && homes.data.homes.length === 0) {
    return { audience: "share", reason: "no_home" };
  }
  return { audience: "family", reason: null };
}

/** The family tap: save on the phone, show "Saved" with a 10 s Undo, send in
 * the background. Returns the client id to follow its state. */
export function useFamilyCheckIn(
  transport: CheckInTransport = SupabaseCheckInTransport,
): (event: EventRegistration) => string {
  const { t } = useTranslation();
  const { show } = useSnackbar();
  return useCallback(
    (event: EventRegistration) => {
      const item = enqueueCheckIn({ eventKey: registrationKey(event), event }, transport);
      show({
        message: t("imSafe.status.queued"),
        actionLabel: t("snackbar.undo"),
        onAction: () => undoCheckIn(item.clientId, transport),
        durationMs: UNDO_MS,
      });
      return item.clientId;
    },
    [show, t, transport],
  );
}

export const safeKeys = {
  family: (userId: string, tagId: string) => ["safe", "family", userId, tagId] as const,
};

/** Family status of one home. Never cached on the device (`persist: false`):
 * names and times of a family stay in memory. Missing function (0057 not yet
 * applied) or any error: `isError`, the screens hide the section. */
export function useFamilyCheckIns(
  tagId: string | undefined,
  transport: FamilyCheckInTransport = SupabaseFamilyCheckInTransport,
): { data: FamilyCheckIns | null; isLoading: boolean; isError: boolean } {
  const account = useAccount();
  const enabled =
    isSupabaseConfigured() && account.status === "account" && !!account.userId && !!tagId;
  const query = useQuery({
    queryKey: safeKeys.family(account.userId ?? "", tagId ?? ""),
    queryFn: () => transport.fetchFamily(tagId as string),
    enabled,
    staleTime: 30_000,
    retry: false,
    meta: { persist: false },
  });
  return {
    data: query.data ?? null,
    isLoading: enabled && query.isLoading,
    isError: query.isError,
  };
}

/** My switch "Show my check-ins to this home". */
export function useSetCheckInSharing(
  transport: FamilyCheckInTransport = SupabaseFamilyCheckInTransport,
): (tagId: string, on: boolean) => Promise<void> {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ tagId, on }: { tagId: string; on: boolean }) =>
      transport.setSharing(tagId, on),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["safe"] }),
  });
  return (tagId, on) => mutation.mutateAsync({ tagId, on });
}
