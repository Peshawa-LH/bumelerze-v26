import type { HubRole } from "@/features/eventhub/types";

export type FollowStatus = "none" | "pending" | "accepted";

/** A person in a list: public fields only. */
export interface Person {
  userId: string;
  /** Null for someone who has not picked a @username (no public page). */
  username: string | null;
  displayName: string;
  avatarPath: string | null;
  roles: HubRole[];
}

export interface FollowRequest extends Person {
  /** UTC ms. */
  requestedAt: number;
}

export interface ProfileComment {
  id: string;
  body: string;
  /** UTC ms. */
  createdAt: number;
  helpfulCount: number;
  /** Event hub route id (`bml…`), or null when the event has none. */
  hubId: string | null;
  place: string | null;
  magnitude: number | null;
}

/** Counts that drive the public milestone badges. */
export interface ProfileMilestones {
  reports: number;
  detailedReports: number;
  photoReports: number;
}

/** What only a viewer who may see the full profile receives. */
export interface ProfileDetails {
  memberSince: number | null;
  followers: number;
  following: number;
  comments: number;
  helpfulReceived: number;
  /** Visible text posts (migration 0050); 0 before it is applied. */
  postsCount: number;
  /** The owner hides their milestone badges; `milestones` is then null. */
  badgesHidden: boolean;
  milestones: ProfileMilestones | null;
  recentComments: ProfileComment[];
}

/** The answer of `public_profile()`: public-safe fields only. */
export interface PublicProfile {
  userId: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
  isPrivate: boolean;
  roles: HubRole[];
  isSelf: boolean;
  followStatus: FollowStatus;
  /** The viewer blocked this person. */
  isBlocked: boolean;
  canViewFull: boolean;
  details: ProfileDetails | null;
}

export type CommunityErrorCode =
  | "not_account"
  | "profile_required"
  | "blocked"
  | "not_found"
  | "forbidden"
  | "rate_limited"
  /** Too late to undo (migration 0053). */
  | "expired"
  /** Nothing to bring back any more (migration 0053). */
  | "not_restorable"
  | "unavailable"
  | "network"
  | "unknown";

export class CommunityError extends Error {
  readonly code: CommunityErrorCode;
  constructor(code: CommunityErrorCode, message?: string) {
    super(message ?? code);
    this.name = "CommunityError";
    this.code = code;
  }
}
