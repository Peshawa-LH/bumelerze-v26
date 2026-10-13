import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { useSnackbar } from "@/components/Snackbar";
import { useAccount } from "@/features/account/use-account";
import type { EventRegistration } from "@/features/felt";
import { isSupabaseConfigured } from "@/lib/supabase";

import { UNDO_MS } from "./constants";
import { enqueueCheckIn, reportKey, undoCheckIn } from "./queue";
import {
  SupabaseCheckInTransport,
  SupabaseFamilyCheckInTransport,
  SupabaseSafeAudienceTransport,
  type CheckInTransport,
  type FamilyCheckIns,
  type FamilyCheckInTransport,
  type SafeAudience,
  type SafeAudienceChoice,
  type SafeAudienceTransport,
} from "./transport";

/** `provider:providerId`, the key the phone remembers an event by. */
export function registrationKey(
  event: Pick<EventRegistration, "provider" | "providerId">,
): string {
  return `${event.provider}:${event.providerId}`;
}

/**
 * How a check-in leaves this phone (review note 3.3, migration 0064):
 * - "inapp": an account. The tap is queued and the server tells the people
 *   the person chose (family, mutual follows or followers) in their Activity
 *   list. A message outside the app stays an optional extra.
 * - "share": a guest. Nothing is stored on our server; the tap opens the
 *   share sheet (design note Q5).
 */
export type CheckInAudience = "inapp" | "share";

export interface CheckInAudienceInfo {
  audience: CheckInAudience;
  /** Why it is "share": no account. */
  reason: "guest" | null;
}

export function useCheckInAudience(): CheckInAudienceInfo {
  const account = useAccount();
  if (account.status !== "account") {
    return { audience: "share", reason: "guest" };
  }
  return { audience: "inapp", reason: null };
}

export interface InAppCheckInTarget {
  /** The earthquake, when there is one. */
  event: EventRegistration | null;
  /** The person's own felt report it comes from (makes it real without a
   * regional M4.0). */
  feltReportId?: string | null;
}

/** The key the phone remembers a check-in by: the earthquake's, else the
 * felt report's. Null when there is neither. */
export function checkInKey(target: InAppCheckInTarget): string | null {
  if (target.event) return registrationKey(target.event);
  return target.feltReportId ? reportKey(target.feltReportId) : null;
}

/** The in-app tap: save on the phone, show "Saved" with a 10 s Undo, send in
 * the background. Returns the client id to follow its state. */
export function useInAppCheckIn(
  transport: CheckInTransport = SupabaseCheckInTransport,
): (target: InAppCheckInTarget) => string | null {
  const { t } = useTranslation();
  const { show } = useSnackbar();
  return useCallback(
    (target: InAppCheckInTarget) => {
      const eventKey = checkInKey(target);
      if (!eventKey) return null;
      const item = enqueueCheckIn(
        { eventKey, event: target.event, feltReportId: target.feltReportId ?? null },
        transport,
      );
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
  audience: (userId: string) => ["safe", "audience", userId] as const,
};

/** Who my check-ins reach and how many people that is today (accounts only;
 * null for guests, while loading, or before migration 0064). Not kept on the
 * phone between sessions: the numbers change as people follow. */
export function useSafeAudience(
  transport: SafeAudienceTransport = SupabaseSafeAudienceTransport,
): { data: SafeAudience | null; isLoading: boolean; isError: boolean } {
  const account = useAccount();
  const enabled =
    isSupabaseConfigured() && account.status === "account" && !!account.userId;
  const query = useQuery({
    queryKey: safeKeys.audience(account.userId ?? ""),
    queryFn: () => transport.fetchAudience(),
    enabled,
    staleTime: 60_000,
    retry: false,
    meta: { persist: false },
  });
  return {
    data: query.data ?? null,
    isLoading: enabled && query.isLoading,
    isError: query.isError,
  };
}

/** Changes who my check-ins reach (Settings > Notifications). */
export function useSetSafeAudience(
  transport: SafeAudienceTransport = SupabaseSafeAudienceTransport,
): (audience: SafeAudienceChoice) => Promise<SafeAudience> {
  const queryClient = useQueryClient();
  const account = useAccount();
  const mutation = useMutation({
    mutationFn: (audience: SafeAudienceChoice) => transport.setAudience(audience),
    onSuccess: (data) =>
      queryClient.setQueryData(safeKeys.audience(account.userId ?? ""), data),
  });
  return (audience) => mutation.mutateAsync(audience);
}

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
