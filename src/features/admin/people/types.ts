import type { HubRoleKind } from "@/features/eventhub/types";

/** An account has an email and can sign in anywhere; a guest is an anonymous
 * install (migration 0055 shows it as "Guest" + the first 8 characters of its id). */
export type PersonKind = "account" | "guest";
export type PersonStatus = "active" | "restricted" | "suspended";
/** Directory tabs. Guests and All need `people.view_guests`. */
export type PeopleTab = "accounts" | "guests" | "all";
export type PeopleSort = "last_seen" | "joined" | "open_reports";
export type PeoplePlatform = "ios" | "android" | "web";

export const PEOPLE_PAGE_SIZE = 50;
export const MIN_QUERY_LENGTH = 2;
export const PEOPLE_PLATFORMS: readonly PeoplePlatform[] = ["ios", "android", "web"];
export const PEOPLE_STATUSES: readonly PersonStatus[] = [
  "active",
  "restricted",
  "suspended",
];
export const PEOPLE_SORTS: readonly PeopleSort[] = [
  "last_seen",
  "joined",
  "open_reports",
];

export interface PeopleFilters {
  /** A rank name, "any" (holds some rank), or null. */
  rank: HubRoleKind | "any" | null;
  status: PersonStatus | null;
  /** Only people with open reports against them. */
  reported: boolean;
  /** ISO timestamps. */
  joinedFrom: string | null;
  joinedTo: string | null;
  activeDays: 7 | 30 | null;
  platform: PeoplePlatform | null;
  /** `accounts.reset_password` holders only. */
  hasPassword: boolean | null;
}

export const NO_FILTERS: PeopleFilters = {
  rank: null,
  status: null,
  reported: false,
  joinedFrom: null,
  joinedTo: null,
  activeDays: null,
  platform: null,
  hasPassword: null,
};

export function countFilters(filters: PeopleFilters): number {
  return [
    filters.rank !== null,
    filters.status !== null,
    filters.reported,
    filters.joinedFrom !== null || filters.joinedTo !== null,
    filters.activeDays !== null,
    filters.platform !== null,
    filters.hasPassword !== null,
  ].filter(Boolean).length;
}

export interface PeopleCursor {
  k: string;
  id: string;
}

export interface PeopleQuery {
  query: string;
  tab: PeopleTab;
  filters: PeopleFilters;
  sort: PeopleSort;
}

export interface PersonCounts {
  feltReports: number;
  comments: number;
  posts: number;
  homesOwned: number;
  homesMember: number;
  feedback: number;
}

/** One row of the directory (`admin_people_search`, migration 0055). */
export interface PersonRow {
  userId: string;
  kind: PersonKind;
  username: string | null;
  displayName: string | null;
  avatarPath: string | null;
  ranks: HubRoleKind[];
  status: PersonStatus;
  /** UTC ms. */
  joined: number | null;
  lastSeen: number | null;
  platform: PeoplePlatform | null;
  openReports: number;
  counts: PersonCounts;
  /** Masked (`p***@gmail.com`); only for `people.view_email`. */
  maskedEmail: string | null;
}

export interface PeoplePage {
  rows: PersonRow[];
  nextCursor: PeopleCursor | null;
  /** Guests with no activity at all, counted but not listed. Null when the
   * viewer has no guest access or the tab shows accounts only. */
  idleGuests: number | null;
}

/** `admin_people_stats()`: counts only. Guest numbers are null without
 * `people.view_guests`. */
export interface PeopleStats {
  accountsTotal: number;
  guestsTotal: number | null;
  newAccounts7d: number;
  newAccounts30d: number;
  activeAccounts7d: number;
  activeAccounts30d: number;
  activeGuests7d: number | null;
  activeGuests30d: number | null;
  /** UTC ms of the first presence row: "active" numbers count from here. */
  presenceSince: number | null;
  restricted: number;
  suspended: number;
  platforms: Record<PeoplePlatform, number>;
}

export interface PersonRankMark {
  role: HubRoleKind;
  orgName: string | null;
}

export interface PersonIdentity {
  userId: string;
  kind: PersonKind;
  username: string | null;
  displayName: string | null;
  avatarPath: string | null;
  isPrivate: boolean;
  ranks: PersonRankMark[];
  status: PersonStatus;
  joined: number | null;
  firstSeen: number | null;
  lastSeen: number | null;
  platform: PeoplePlatform | null;
  appVersion: string | null;
  locale: string | null;
  termsVersion: string | null;
  termsAcceptedAt: number | null;
  researchConsentVersion: string | null;
  researchConsentAt: number | null;
  /** Only for `people.view_email`. */
  maskedEmail: string | null;
  /** Only for `accounts.reset_password`; null otherwise. */
  hasPassword: boolean | null;
}

/** A device, by fingerprint only (first 8 hex characters of a hash). */
export interface PersonDevice {
  fingerprint: string;
  firstSeen: number | null;
  lastSeen: number | null;
  feltReports: number;
  feedback: number;
  platform: PeoplePlatform | null;
}

export interface SameDevicePerson {
  userId: string;
  kind: PersonKind;
  username: string | null;
  displayName: string | null;
  fingerprint: string;
}

export interface PersonActivityCounts {
  feltReports: number;
  comments: number;
  commentsVisible: number;
  commentsPending: number;
  commentsHidden: number;
  commentsRemoved: number;
  posts: number;
  feedback: number;
  followers: number;
  following: number;
  blocksMade: number;
  blocksReceived: number;
  reportsFiled: number;
  reportsReceived: number;
  reportsOpen: number;
  homesOwned: number;
  homesMember: number;
  notes: number;
}

export interface RecentFeltReport {
  reportId: string;
  createdAt: number | null;
  /** Event hub id (`bml...`), or null when not yet linked. */
  event: string | null;
  /** The EMS-98 picture picked (1-12). Never a place. */
  intensity: number | null;
}

export interface RecentComment {
  commentId: string;
  createdAt: number | null;
  event: string | null;
  status: string;
  authorDeleted: boolean;
  excerpt: string | null;
}

export interface RecentPost {
  postId: string;
  createdAt: number | null;
  status: string;
  excerpt: string | null;
}

export interface RecentFeedback {
  feedbackId: string;
  createdAt: number | null;
  category: string | null;
  status: string | null;
}

export interface PersonRestriction {
  restrictionId: string;
  level: "warning" | "restrict" | "suspend";
  reason: string;
  note: string | null;
  startsAt: number | null;
  endsAt: number | null;
  createdAt: number | null;
  createdByName: string | null;
  liftedAt: number | null;
  liftedByName: string | null;
  appealRequestedAt: number | null;
  active: boolean;
}

/** `admin_person()`. The history (audit rows) comes from `admin_activity`. */
export interface PersonDetail {
  identity: PersonIdentity;
  devices: PersonDevice[];
  sameDeviceUsers: SameDevicePerson[];
  counts: PersonActivityCounts;
  recent: {
    feltReports: RecentFeltReport[];
    comments: RecentComment[];
    posts: RecentPost[];
    feedback: RecentFeedback[];
  };
  restrictions: PersonRestriction[];
}

export interface PersonNote {
  id: string;
  body: string;
  createdAt: number | null;
  authorId: string | null;
  authorName: string | null;
}

/** What "Reset name / photo" can clear. */
export type ResettableField = "display_name" | "avatar";
export const NOTE_MAX_LENGTH = 1000;
