import type { HubRoleKind } from "@/features/eventhub/types";

/** Triage states of a feedback message (`feedback.status`, migration 0022). */
export const FEEDBACK_STATUSES = ["unseen", "in_review", "solved", "wont_do"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** The status filter: one state, "open" (unseen or in review) or all. */
export type FeedbackStatusFilter = FeedbackStatus | "open" | null;
export const FEEDBACK_STATUS_FILTERS: readonly Exclude<FeedbackStatusFilter, null>[] = [
  "open",
  "unseen",
  "in_review",
  "solved",
  "wont_do",
];

/** Categories (0022, 0048, 0054). Ordinary feedback from the app has none. */
export const FEEDBACK_CATEGORIES = [
  "badge_request",
  "appeal",
  "bug",
  "improvement",
  "suggestion",
  "question",
  "other",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

/** The category filter: one category, "none" (ordinary feedback) or all. */
export type FeedbackCategoryFilter = FeedbackCategory | "none" | null;
export const FEEDBACK_CATEGORY_FILTERS: readonly Exclude<FeedbackCategoryFilter, null>[] =
  ["badge_request", "appeal", "none"];

export const FEEDBACK_PAGE_SIZE = 50;
/** The triage note, same cap as the server's `feedback.triage_note`. */
export const TRIAGE_NOTE_MAX = 4000;

export interface FeedbackFilters {
  status: FeedbackStatusFilter;
  category: FeedbackCategoryFilter;
  search: string;
}

/** One row of `admin_feedback_list()` (migration 0060). */
export interface FeedbackRow {
  id: string;
  /** Raw server timestamp: the cursor for the next page. */
  cursor: string;
  /** UTC ms. */
  createdAt: number;
  status: FeedbackStatus;
  category: FeedbackCategory | null;
  /** The first 160 characters of the message. */
  preview: string;
  platform: string | null;
  appVersion: string | null;
  locale: string | null;
  userId: string | null;
  displayName: string | null;
  username: string | null;
  photoCount: number;
  hasNote: boolean;
}

export interface FeedbackPerson {
  userId: string;
  /** False for a guest install (anonymous sign-in). */
  isAccount: boolean;
  displayName: string | null;
  username: string | null;
  /** Public ranks the person already holds. */
  ranks: HubRoleKind[];
}

export interface FeedbackPhoto {
  id: string;
  storagePath: string;
}

/** The restriction an appeal is about (only for `accounts.restrict`). */
export interface FeedbackRestriction {
  id: string;
  level: "warning" | "restrict" | "suspend";
  reason: string;
  /** UTC ms, or null. */
  endsAt: number | null;
  liftedAt: number | null;
  active: boolean;
}

/** `admin_feedback_get()` (migration 0060). Never carries the device id. */
export interface FeedbackDetail {
  id: string;
  createdAt: number;
  updatedAt: number | null;
  status: FeedbackStatus;
  category: FeedbackCategory | null;
  message: string;
  /** What the sender typed to be reached at (email or phone), if anything. */
  contact: string | null;
  platform: string | null;
  appVersion: string | null;
  locale: string | null;
  triageNote: string | null;
  person: FeedbackPerson | null;
  photos: FeedbackPhoto[];
  restriction: FeedbackRestriction | null;
}

/** `admin_inbox_counts()`: null for a part the viewer may not see. */
export interface InboxCounts {
  feedback: {
    unseen: number;
    inReview: number;
    solved: number;
    wontDo: number;
    badgeRequestsOpen: number;
    appealsOpen: number;
  } | null;
  photosPending: number | null;
}
