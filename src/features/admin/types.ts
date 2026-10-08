import type { HubRoleKind } from "@/features/eventhub/types";

/** Ranks an admin can give or take away in the app. The official rank is
 * deliberately missing: it stays a database-only operation. */
export const GRANTABLE_RANKS = [
  "moderator",
  "seismologist",
  "professor",
  "researcher",
  "engineer",
  "partner",
] as const satisfies readonly HubRoleKind[];
export type GrantableRank = (typeof GRANTABLE_RANKS)[number];

export interface QueueComment {
  id: string;
  eventId: string;
  /** Event hub route id (`bml…`), or null. */
  hubId: string | null;
  authorId: string | null;
  authorName: string | null;
  body: string;
  status: "pending" | "visible";
  flagCount: number;
  /** UTC ms. */
  createdAt: number;
}

export interface RoleHolder {
  userId: string;
  username: string | null;
  displayName: string | null;
  role: HubRoleKind;
  orgName: string | null;
  /** UTC ms. */
  grantedAt: number;
  grantedByName: string | null;
  note: string | null;
}

export interface ReportedProfile {
  userId: string;
  username: string | null;
  displayName: string | null;
  reportCount: number;
  lastReason: string | null;
}

/** A visible profile post with open reports (`post_queue()`, migration 0050). */
export interface ReportedPost {
  postId: string;
  authorId: string;
  username: string | null;
  displayName: string | null;
  body: string;
  reportCount: number;
  lastReason: string | null;
}

/** An account found by `admin_find_accounts` (migration 0051). The email is
 * already masked by the server (`p***@gmail.com`). */
export interface FoundAccount {
  userId: string;
  username: string | null;
  displayName: string | null;
  maskedEmail: string | null;
}

/** Every action the activity log (`moderation_log`, migrations 0043-0052) can
 * hold. `content` actions are the ones a moderator may read; the rest are for
 * `audit.read_all` (the official rank). */
export const ACTIVITY_ACTIONS = [
  { action: "comment_approve", content: true },
  { action: "comment_hide", content: true },
  { action: "comment_remove", content: true },
  { action: "comment_restore", content: true },
  { action: "post_remove", content: true },
  { action: "post_restore", content: true },
  { action: "post_reports_dismiss", content: true },
  { action: "profile_reports_resolve", content: true },
  { action: "report_reopen", content: true },
  { action: "role_grant", content: false },
  { action: "role_revoke", content: false },
  { action: "password_reset", content: false },
  { action: "profile_reset", content: false },
  { action: "restrict", content: false },
  { action: "suspend", content: false },
  { action: "lift", content: false },
  { action: "person_view", content: false },
  { action: "email_reveal", content: false },
  { action: "purge", content: false },
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number]["action"];

/** The actions the filter chips offer today: those the app's own tools write. */
export const ACTIVITY_FILTER_ACTIONS: readonly ActivityAction[] = [
  "comment_approve",
  "comment_hide",
  "comment_remove",
  "post_remove",
  "post_reports_dismiss",
  "profile_reports_resolve",
  "role_grant",
  "role_revoke",
  "password_reset",
  "purge",
];

/** One row of `admin_activity()` (migration 0052). */
export interface ActivityEntry {
  id: string;
  /** Raw server timestamp: the cursor for the next page (milliseconds would
   * drop rows that share the same millisecond). */
  cursor: string;
  /** UTC ms. */
  createdAt: number;
  /** One of `ACTIVITY_ACTIONS`, or an action a newer server adds. */
  action: string;
  /** Null for the system (the nightly clean-up). */
  actorId: string | null;
  actorName: string | null;
  actorUsername: string | null;
  actorRank: HubRoleKind | null;
  targetType: string | null;
  targetId: string | null;
  targetUserId: string | null;
  targetName: string | null;
  targetUsername: string | null;
  /** A short, non-private hint: the hub id of a comment, the rank of a grant. */
  targetSummary: string | null;
  reason: string | null;
  note: string | null;
  /** The log row that undid this one, if any (set from the next batch on). */
  revertedBy: string | null;
}

export interface ActivityFilters {
  action: string | null;
  /** The person the action was done to. */
  targetUserId: string | null;
}

export const ACTIVITY_PAGE_SIZE = 50;
