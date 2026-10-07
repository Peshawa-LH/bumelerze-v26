import { useMemo } from "react";

import type { HubRole } from "@/features/eventhub/types";
import {
  EMPTY_BADGE_INPUTS,
  countBadges,
  evaluateBadges,
  mergeBadgeInputs,
  type BadgeEntry,
} from "@/features/badges";
import { useMyHomes } from "@/features/building/queries";
import { useFeltQueueItems } from "@/features/felt";
import {
  localCounts,
  mergeWithLocal,
  useMyRoles,
  useMyStats,
  type MergedCounts,
} from "./stats";

export interface MySummary {
  counts: MergedCounts;
  /** Roles the Bumelerze team granted this account. */
  roles: readonly HubRole[];
  /** UTC ms the profile was created, when the server told us. */
  memberSince: number | null;
  /** Server-only numbers still loading for the first time. */
  statsLoading: boolean;
  /** Server-only numbers could not be read and none are cached. */
  statsUnavailable: boolean;
  badges: BadgeEntry[];
  badgesEarned: number;
  badgesTotal: number;
}

/** Stats strip + badge collection for the My account page, from the local
 * queue merged with the cached/fresh server numbers. */
export function useMySummary(): MySummary {
  const items = useFeltQueueItems();
  const { stats, isLoading, isUnavailable } = useMyStats();
  const roles = useMyRoles();
  const homes = useMyHomes().data?.homes ?? null;

  return useMemo(() => {
    const counts = mergeWithLocal(localCounts(items), stats);
    const familyLinked =
      counts.familyLinked || (homes?.some((home) => home.role === "member") ?? false);
    const inputs = mergeBadgeInputs(EMPTY_BADGE_INPUTS, {
      reports: counts.reports,
      detailedReports: counts.detailedReports,
      photoReports: counts.photoReports,
      comments: counts.comments ?? 0,
      helpfulReceived: counts.helpfulReceived ?? 0,
      homeTagged: homes && homes.length > 0 ? 1 : 0,
      familyLinked: familyLinked ? 1 : 0,
    });
    const badges = evaluateBadges(inputs, roles, { includeRequestableRanks: true });
    const { earned, total } = countBadges(badges);
    return {
      counts: { ...counts, familyLinked },
      roles,
      memberSince: stats?.memberSince ?? null,
      statsLoading: isLoading,
      statsUnavailable: isUnavailable,
      badges,
      badgesEarned: earned,
      badgesTotal: total,
    };
  }, [items, stats, roles, homes, isLoading, isUnavailable]);
}
