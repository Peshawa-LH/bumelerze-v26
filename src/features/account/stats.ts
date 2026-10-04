import { useQuery } from "@tanstack/react-query";

import type { HubRole } from "@/features/eventhub/types";
import { SupabaseEventHubTransport } from "@/features/eventhub/transport";
import type { QueueItem } from "@/features/felt";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import { useAccount } from "./use-account";

/**
 * The numbers on the My account page. One server call (`my_stats()`,
 * migration 0040) instead of four counts; everything degrades to the local
 * queue when the call is missing, offline or failing: the page never waits
 * on it and never errors because of it.
 */

export interface MyStats {
  /** UTC ms the profile was created, or null (no profile). */
  memberSince: number | null;
  reports: number;
  detailedReports: number;
  photoReports: number;
  comments: number;
  helpfulReceived: number;
  familyLinked: boolean;
}

export const accountKeys = {
  stats: (userId: string) => ["account", "stats", userId] as const,
  roles: (userId: string) => ["account", "roles", userId] as const,
};

function toCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Reads the `my_stats()` result (one row, or a bare object) defensively. */
export function parseMyStats(data: unknown): MyStats | null {
  const row: unknown = Array.isArray(data) ? data[0] : data;
  if (row === null || typeof row !== "object") {
    return null;
  }
  const r = row as Record<string, unknown>;
  const since = typeof r.member_since === "string" ? Date.parse(r.member_since) : NaN;
  return {
    memberSince: Number.isFinite(since) ? since : null,
    reports: toCount(r.reports),
    detailedReports: toCount(r.detailed_reports),
    photoReports: toCount(r.photo_reports),
    comments: toCount(r.comments),
    helpfulReceived: toCount(r.helpful_received),
    familyLinked: r.family_linked === true,
  };
}

/** Calls `my_stats()`. Throws when it cannot (callers treat that as "no
 * server numbers", never as an error to show). */
export async function fetchMyStats(): Promise<MyStats> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("my_stats: Supabase is not configured");
  }
  const { data, error } = await client.rpc("my_stats");
  if (error) {
    throw error;
  }
  const stats = parseMyStats(data);
  if (!stats) {
    throw new Error("my_stats: unexpected response");
  }
  return stats;
}

export interface UseMyStatsResult {
  stats: MyStats | null;
  /** First load in flight with nothing cached. */
  isLoading: boolean;
  /** Failed and nothing cached: show "–" for server-only numbers. */
  isUnavailable: boolean;
}

export function useMyStats(): UseMyStatsResult {
  const account = useAccount();
  const userId = account.userId;
  const enabled =
    isSupabaseConfigured() &&
    userId !== null &&
    (account.status === "account" || account.status === "anonymous");
  const query = useQuery({
    queryKey: accountKeys.stats(userId ?? ""),
    queryFn: fetchMyStats,
    enabled,
    staleTime: 60_000,
    retry: 1,
  });
  const stats = query.data ?? null;
  return {
    stats,
    isLoading: enabled && query.isLoading,
    isUnavailable: stats === null && (!enabled || query.isError),
  };
}

/** Roles of the signed-in account (`user_roles` is publicly readable). Cached
 * like the stats, so a held role does not vanish offline. */
export function useMyRoles(): HubRole[] {
  const account = useAccount();
  const userId = account.status === "account" ? account.userId : null;
  const query = useQuery({
    queryKey: accountKeys.roles(userId ?? ""),
    queryFn: async () => {
      const roles = await SupabaseEventHubTransport.fetchRoles([userId as string]);
      return roles[userId as string] ?? [];
    },
    enabled: isSupabaseConfigured() && userId !== null,
    staleTime: 10 * 60_000,
    retry: 1,
  });
  return query.data ?? EMPTY_ROLES;
}

const EMPTY_ROLES: HubRole[] = [];

/** What this phone knows by itself: the felt-report queue. */
export interface LocalCounts {
  reports: number;
  detailedReports: number;
  photoReports: number;
}

export function localCounts(items: readonly QueueItem[]): LocalCounts {
  return {
    reports: items.length,
    detailedReports: items.filter((item) => item.tier2 !== null).length,
    photoReports: items.filter(
      (item) => item.photoState === "uploaded" || item.photoState === "pending-upload",
    ).length,
  };
}

export interface MergedCounts extends LocalCounts {
  /** Server-only numbers: null when the server has not answered. */
  comments: number | null;
  helpfulReceived: number | null;
  familyLinked: boolean;
}

/** `max(local, server)` for the numbers both sides know, so a count never
 * drops after signing in or while offline. */
export function mergeWithLocal(local: LocalCounts, server: MyStats | null): MergedCounts {
  return {
    reports: Math.max(local.reports, server?.reports ?? 0),
    detailedReports: Math.max(local.detailedReports, server?.detailedReports ?? 0),
    photoReports: Math.max(local.photoReports, server?.photoReports ?? 0),
    comments: server ? server.comments : null,
    helpfulReceived: server ? server.helpfulReceived : null,
    familyLinked: server?.familyLinked === true,
  };
}
