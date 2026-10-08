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
  /** The reason and note of the latest open report (migration 0056), if any. */
  lastReason: string | null;
  lastNote: string | null;
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
  /** The note that came with the latest report (migration 0056). */
  lastNote: string | null;
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
  lastNote: string | null;
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
  // Migration 0055: a moderator may reset a copied name or photo, so these
  // rows are readable with `audit.read` too.
  { action: "profile_reset", content: true },
  { action: "profile_restore", content: true },
  // Migration 0054: a moderator may restrict, so these rows are readable with
  // `audit.read` too.
  { action: "restrict", content: true },
  { action: "suspend", content: true },
  { action: "lift", content: true },
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
  "restrict",
  "suspend",
  "lift",
  "password_reset",
  "profile_reset",
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

/** The actions the Activity screen can undo (migration 0053), and the
 * permission each needs. The server decides in the end (window, state); this
 * only decides whether to offer the button. */
export const UNDOABLE_ACTIONS = {
  comment_hide: "comments.moderate",
  comment_remove: "content.restore",
  post_remove: "content.restore",
  profile_reports_resolve: "comments.moderate",
  post_reports_dismiss: "comments.moderate",
  role_revoke: "badges.grant",
  // Migration 0054: the Undo of a restriction lifts it.
  restrict: "accounts.restrict",
  suspend: "accounts.suspend",
  // Migration 0055: the Undo of a name / photo reset.
  profile_reset: "accounts.restrict",
} as const;
export type UndoableAction = keyof typeof UNDOABLE_ACTIONS;

/** One row of `admin_hidden_removed()` (migration 0053): a comment a moderator
 * hid, or a comment or post an admin removed, in the last 30 days. */
export interface HiddenRemovedItem {
  kind: "comment" | "post";
  id: string;
  status: "hidden" | "removed";
  /** When it was hidden or removed, UTC ms. */
  actedAt: number;
  /** Raw server timestamp: the cursor for the next page. */
  cursor: string;
  actorName: string | null;
  reason: string | null;
  authorId: string | null;
  authorName: string | null;
  authorUsername: string | null;
  /** Event hub route id (`bml...`) of a comment, or null. */
  hubId: string | null;
  place: string | null;
  /** The live text of a hidden comment, or the evidence copy of a removed
   * item (official only). Null when the viewer may not read it. */
  body: string | null;
  /** The server's answer for this viewer: Restore will work. */
  canRestore: boolean;
}

export interface ActivityFilters {
  action: string | null;
  /** The person the action was done to. */
  targetUserId: string | null;
}

export const ACTIVITY_PAGE_SIZE = 50;
export const HIDDEN_PAGE_SIZE = 50;
