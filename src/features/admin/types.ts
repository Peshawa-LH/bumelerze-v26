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
