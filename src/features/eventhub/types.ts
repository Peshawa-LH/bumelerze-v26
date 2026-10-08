/** Ranks granted by the Bumelerze team (`public.user_roles`, migrations 0036
 * and 0043). Highest first. Only official and moderator carry powers (see
 * `role_permissions`); the rest are credential marks. */
export type HubRoleKind =
  | "official"
  | "moderator"
  | "seismologist"
  | "professor"
  | "researcher"
  | "engineer"
  | "partner";

export const HUB_ROLE_KINDS: readonly HubRoleKind[] = [
  "official",
  "moderator",
  "seismologist",
  "professor",
  "researcher",
  "engineer",
  "partner",
];

/** Permissions a rank can hold (`public.role_permissions`, migration 0043). */
export const PERMISSIONS = [
  "comments.moderate",
  "comments.delete",
  "badges.grant",
  "hubs.feature",
  "posts.delete",
  "accounts.reset_password",
  // Migration 0052: the activity log. `audit.read` shows content actions
  // (moderators); `audit.read_all` shows everything (official).
  "audit.read",
  "audit.read_all",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface HubRole {
  role: HubRoleKind;
  /** Organisation name; only partners carry one. */
  orgName: string | null;
}

/** `removed` (migration 0044): an admin took the text down; the thread keeps
 * an empty "Comment removed" placeholder so replies stay readable. */
export type CommentStatus = "visible" | "pending" | "hidden" | "removed";

/** Reasons a reader can give when reporting a comment (`comment_flags.reason`). */
export type FlagReason = "spam" | "abuse" | "false" | "private" | "other";

export const FLAG_REASONS: readonly FlagReason[] = [
  "spam",
  "abuse",
  "false",
  "private",
  "other",
];

export type ModerationAction = "approve" | "hide";

/** One `event_comments` row, camel-cased. */
export interface HubComment {
  id: string;
  eventId: string;
  parentId: string | null;
  userId: string | null;
  body: string;
  /** Geohash-5 cell (~5 km) of the commenter's own felt report, or null. */
  areaGeohash: string | null;
  status: CommentStatus;
  helpfulCount: number;
  replyCount: number;
  /** UTC ms. */
  createdAt: number;
}

export interface HubAuthor {
  userId: string;
  displayName: string;
  avatarPath: string | null;
  /** Public @handle (migration 0045), lowercase; null until they pick one or
   * before that migration is applied. */
  username: string | null;
}

/** `event_hub_summary` result: aggregates only, never a person or a place. */
export interface HubSummary {
  reports: number;
  people: number;
  /** Reported shaking level (1..12 cartoon level) to number of reports. */
  levels: Record<number, number>;
  /** UTC ms of the earliest report, or null when there is none. */
  firstReportAt: number | null;
  /** Visible comments only. */
  comments: number;
  /** A featured hub (migration 0038) is always open — e.g. the 2017
   * Halabja–Sarpol-e Zahab earthquake, where people share memories. */
  featured?: boolean;
}

/** Everything one thread read returns, ready for `buildThreads`. */
export interface HubThreadData {
  comments: HubComment[];
  authors: Record<string, HubAuthor>;
  roles: Record<string, HubRole[]>;
  /** Comment ids the signed-in account has marked helpful. */
  helpedIds: string[];
  /** Ids of the people the signed-in account follows (accepted only). */
  followingIds: string[];
  /** Comment ids the signed-in identity reported and has not withdrawn
   * (migration 0052; empty before it is applied). */
  flaggedIds: string[];
}

export interface HubThread {
  root: HubComment;
  /** Oldest first. */
  replies: HubComment[];
}

export type HubErrorCode =
  | "rate_limited"
  /** 30 reports in 24 hours (migration 0052). */
  | "flag_limit"
  | "network"
  | "not_signed_in"
  | "unknown";

export class HubError extends Error {
  readonly code: HubErrorCode;
  constructor(code: HubErrorCode, message?: string) {
    super(message ?? code);
    this.name = "HubError";
    this.code = code;
  }
}
