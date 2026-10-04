import type { HubRole, HubRoleKind } from "@/features/eventhub/types";

import {
  MILESTONE_BADGES,
  ROLE_PRIORITY,
  type BadgeMetric,
  type MilestoneBadge,
} from "./catalog";

/** Everything the milestone rules count. */
export type BadgeInputs = Record<BadgeMetric, number>;

export const EMPTY_BADGE_INPUTS: BadgeInputs = {
  reports: 0,
  detailedReports: 0,
  photoReports: 0,
  homeTagged: 0,
  familyLinked: 0,
  comments: 0,
  helpfulReceived: 0,
};

/** Field-wise maximum: an earned badge never regresses just because the
 * phone is offline (cached server numbers) or a report left the local queue. */
export function mergeBadgeInputs(a: BadgeInputs, b: BadgeInputs): BadgeInputs {
  const merged = { ...EMPTY_BADGE_INPUTS };
  for (const key of Object.keys(merged) as BadgeMetric[]) {
    merged[key] = Math.max(a[key] ?? 0, b[key] ?? 0);
  }
  return merged;
}

export interface RoleBadgeEntry {
  kind: "role";
  /** Stable React key. */
  key: string;
  role: HubRoleKind;
  /** Organisation name; only partners carry one. */
  orgName: string | null;
  earned: true;
}

export interface MilestoneBadgeEntry {
  kind: "milestone";
  key: string;
  badge: MilestoneBadge;
  earned: boolean;
  /** The metric so far, capped at the target. */
  current: number;
  target: number;
}

export type BadgeEntry = RoleBadgeEntry | MilestoneBadgeEntry;

/** Role entries first (official > moderator > engineer > partner), then the
 * milestones in catalogue order. Roles never show as locked placeholders. */
export function evaluateBadges(
  inputs: BadgeInputs,
  roles: readonly HubRole[] | undefined,
): BadgeEntry[] {
  const roleEntries: RoleBadgeEntry[] = [];
  for (const kind of ROLE_PRIORITY) {
    const held = (roles ?? []).find((role) => role.role === kind);
    if (held) {
      roleEntries.push({
        kind: "role",
        key: `role-${kind}`,
        role: kind,
        orgName: held.orgName,
        earned: true,
      });
    }
  }
  const milestoneEntries: MilestoneBadgeEntry[] = MILESTONE_BADGES.map((badge) => {
    const value = Math.max(0, inputs[badge.metric] ?? 0);
    return {
      kind: "milestone",
      key: badge.id,
      badge,
      earned: value >= badge.target,
      current: Math.min(value, badge.target),
      target: badge.target,
    };
  });
  return [...roleEntries, ...milestoneEntries];
}

/** Earned and total milestone badges (roles are extra, never counted). */
export function countMilestones(entries: readonly BadgeEntry[]): {
  earned: number;
  total: number;
} {
  const milestones = entries.filter(
    (entry): entry is MilestoneBadgeEntry => entry.kind === "milestone",
  );
  return {
    earned: milestones.filter((entry) => entry.earned).length,
    total: milestones.length,
  };
}
