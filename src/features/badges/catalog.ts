import type { Ionicons } from "@expo/vector-icons";

import type { HubRoleKind } from "@/features/eventhub/types";

/**
 * The single source of truth for badges (account page redesign, 2026-10-04).
 * Milestone badges are a private collection shown only to their owner on the
 * My account page; role badges are granted by the Bumelerze team and the top
 * one is the public mark next to a name (`RoleMark`, which reads from here so
 * the two cannot drift). Order is fixed so positions are learnable. No hex
 * colours here: a tone names a theme token, resolved in `tones.ts`.
 */

export type IconName = keyof typeof Ionicons.glyphMap;

/** Which theme token tints a badge. Never the felt-action red or the
 * intensity ramp: those colours are reserved for shaking. */
export type BadgeTone = "info" | "success" | "brand" | "link" | "warning";

export type BadgeMetric =
  | "reports"
  | "detailedReports"
  | "photoReports"
  | "homeTagged"
  | "familyLinked"
  | "comments"
  | "helpfulReceived";

export type MilestoneId =
  | "first_report"
  | "reports_10"
  | "detailed"
  | "photo"
  | "home_tagged"
  | "family_linked"
  | "first_comment"
  | "helpful_5"
  | "helpful_25";

export interface MilestoneBadge {
  id: MilestoneId;
  /** Solid glyph (earned). */
  icon: IconName;
  /** Outline glyph (locked). */
  iconOutline: IconName;
  tone: BadgeTone;
  /** The number the rule counts. */
  metric: BadgeMetric;
  /** Earned once the metric reaches this. */
  target: number;
  /** i18n key of the name; `{{count}}` is `target` when `nameUsesCount`. */
  nameKey: string;
  nameUsesCount: boolean;
  /** i18n key of the one-line rule; `{{count}}` is `target`. */
  ruleKey: string;
}

export const MILESTONE_BADGES: readonly MilestoneBadge[] = [
  {
    id: "first_report",
    icon: "pulse",
    iconOutline: "pulse-outline",
    tone: "info",
    metric: "reports",
    target: 1,
    nameKey: "myData.badges.first_report.name",
    nameUsesCount: false,
    ruleKey: "myData.badges.first_report.rule",
  },
  {
    id: "reports_10",
    icon: "stats-chart",
    iconOutline: "stats-chart-outline",
    tone: "info",
    metric: "reports",
    target: 10,
    nameKey: "myData.badges.reports_10.name",
    nameUsesCount: true,
    ruleKey: "myData.badges.reports_10.rule",
  },
  {
    id: "detailed",
    icon: "clipboard",
    iconOutline: "clipboard-outline",
    tone: "info",
    metric: "detailedReports",
    target: 1,
    nameKey: "myData.badges.detailed.name",
    nameUsesCount: false,
    ruleKey: "myData.badges.detailed.rule",
  },
  {
    id: "photo",
    icon: "camera",
    iconOutline: "camera-outline",
    tone: "info",
    metric: "photoReports",
    target: 1,
    nameKey: "myData.badges.photo.name",
    nameUsesCount: false,
    ruleKey: "myData.badges.photo.rule",
  },
  {
    id: "home_tagged",
    icon: "home",
    iconOutline: "home-outline",
    tone: "brand",
    metric: "homeTagged",
    target: 1,
    nameKey: "myData.badges.home_tagged.name",
    nameUsesCount: false,
    ruleKey: "myData.badges.home_tagged.rule",
  },
  {
    id: "family_linked",
    icon: "people",
    iconOutline: "people-outline",
    tone: "brand",
    metric: "familyLinked",
    target: 1,
    nameKey: "myData.badges.family_linked.name",
    nameUsesCount: false,
    ruleKey: "myData.badges.family_linked.rule",
  },
  {
    id: "first_comment",
    icon: "chatbubble",
    iconOutline: "chatbubble-outline",
    tone: "success",
    metric: "comments",
    target: 1,
    nameKey: "myData.badges.first_comment.name",
    nameUsesCount: false,
    ruleKey: "myData.badges.first_comment.rule",
  },
  {
    id: "helpful_5",
    icon: "thumbs-up",
    iconOutline: "thumbs-up-outline",
    tone: "success",
    metric: "helpfulReceived",
    target: 5,
    nameKey: "myData.badges.helpful_5.name",
    nameUsesCount: false,
    ruleKey: "myData.badges.helpfulRule",
  },
  {
    id: "helpful_25",
    icon: "heart",
    iconOutline: "heart-outline",
    tone: "success",
    metric: "helpfulReceived",
    target: 25,
    nameKey: "myData.badges.helpful_25.name",
    nameUsesCount: false,
    ruleKey: "myData.badges.helpfulRule",
  },
];

export interface RoleBadge {
  icon: IconName;
  tone: BadgeTone;
  /** Round app icon drawn instead of the glyph (the official account). */
  image: number | null;
}

/** Same order as the public mark's priority: official > moderator >
 * engineer > partner. */
export const ROLE_PRIORITY: readonly HubRoleKind[] = [
  "official",
  "moderator",
  "engineer",
  "partner",
];

export const ROLE_BADGES: Record<HubRoleKind, RoleBadge> = {
  official: {
    icon: "checkmark-circle",
    tone: "brand",
    image: require("../../../assets/brand/logo/bumelerze-app-icon-round.svg"),
  },
  moderator: { icon: "shield-checkmark", tone: "link", image: null },
  engineer: { icon: "construct", tone: "warning", image: null },
  partner: { icon: "ribbon", tone: "success", image: null },
};
