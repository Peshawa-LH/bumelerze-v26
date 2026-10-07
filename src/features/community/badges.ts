import { EMPTY_BADGE_INPUTS, evaluateBadges, type BadgeEntry } from "@/features/badges";
import { PRIVATE_MILESTONE_IDS } from "./constants";
import type { PublicProfile } from "./types";

/**
 * The badges a public profile shows: the person's ranks, then the milestone
 * badges they have EARNED (no locked placeholders for someone else's page).
 * Milestones disappear when the owner hid them, and the two that describe a
 * household (tagged a home, linked a family) are never public.
 */
export function profileBadgeEntries(profile: PublicProfile): BadgeEntry[] {
  const details = profile.details;
  const milestones = details && !details.badgesHidden ? details.milestones : null;
  const inputs = {
    ...EMPTY_BADGE_INPUTS,
    reports: milestones?.reports ?? 0,
    detailedReports: milestones?.detailedReports ?? 0,
    photoReports: milestones?.photoReports ?? 0,
    comments: details?.comments ?? 0,
    helpfulReceived: details?.helpfulReceived ?? 0,
  };
  const privateIds: readonly string[] = PRIVATE_MILESTONE_IDS;
  return evaluateBadges(inputs, profile.roles).filter((entry) => {
    if (entry.kind === "role") {
      // Never a locked placeholder on someone else's page.
      return entry.earned;
    }
    return milestones !== null && entry.earned && !privateIds.includes(entry.badge.id);
  });
}
