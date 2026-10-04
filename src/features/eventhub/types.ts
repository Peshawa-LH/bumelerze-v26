/** Roles granted by the Bumelerze team (`public.user_roles`, migration 0036). */
export type HubRoleKind = "official" | "moderator" | "engineer" | "partner";

export const HUB_ROLE_KINDS: readonly HubRoleKind[] = [
  "official",
  "moderator",
  "engineer",
  "partner",
];

export interface HubRole {
  role: HubRoleKind;
  /** Organisation name; only partners carry one. */
  orgName: string | null;
}

export type CommentStatus = "visible" | "pending" | "hidden";

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
}

export interface HubThread {
  root: HubComment;
  /** Oldest first. */
  replies: HubComment[];
}

export type HubErrorCode = "rate_limited" | "network" | "not_signed_in" | "unknown";

export class HubError extends Error {
  readonly code: HubErrorCode;
  constructor(code: HubErrorCode, message?: string) {
    super(message ?? code);
    this.name = "HubError";
    this.code = code;
  }
}
