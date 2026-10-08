import type { Hazard } from "./assessment";
import type { ImsTypeProbs, VcProbs, VulnerabilityClass } from "./ims25";
import type { StoredPhotoSlot } from "./photos";

export type HomeKind = "house" | "apartment";
/** How exact the tag's point is: the device fix, a pin the user placed on the
 * map, or a town centre standing in for it. */
export type LocationQuality = "gps" | "pin" | "town";
export type MemberRole = "owner" | "member";
export type MemberStatus = "pending" | "approved";

/** Row of `public.home_tags`, camel-cased. Readable by approved members only;
 * lat/lon are the exact point and never leave the household. */
export interface HomeTag {
  tagId: string;
  code: string;
  ownerUserId: string | null;
  kind: HomeKind;
  label: string | null;
  unitLabel: string | null;
  lat: number;
  lon: number;
  complexId: string | null;
  status: "active" | "archived";
  createdAt: string;
}

export interface HomeMember {
  tagId: string;
  userId: string;
  role: MemberRole;
  status: MemberStatus;
  requestedAt: string;
}

/** What the family screen shows of a member: name, photo and the @username
 * that opens their public profile (null when they have not picked one). */
export interface MemberProfile {
  displayName: string;
  username: string | null;
  avatarPath: string | null;
}

/** One stored photo of a home, with a short-lived signed link. */
export interface HomePhoto {
  url: string;
  /** Which suggested photo it is, or "more" for an extra. */
  slot: StoredPhotoSlot;
  caption: string | null;
  fileName: string;
}

export interface StoredSurvey {
  surveyId: string;
  tagId: string;
  version: string;
  answers: unknown;
  createdAt: string;
}

/** Row of `public.home_assessments`, camel-cased. */
export interface StoredAssessment {
  assessmentId: string;
  tagId: string;
  surveyId: string | null;
  method: string;
  imsTypeProbs: ImsTypeProbs;
  vcProbs: VcProbs;
  vcMostLikely: VulnerabilityClass;
  vcRange: string | null;
  confidence: number | null;
  hazard: Hazard | null;
  reviewStatus: "automatic" | "engineer_reviewed";
  createdAt: string;
}

export interface CreatedHome {
  tagId: string;
  code: string;
  joinKey: string;
}

/** What `deleteHome` reports once the home is gone. */
export interface DeleteHomeResult {
  /** True when some photo files could not be removed from storage. They sit
   * in a folder nobody can read any more (membership is gone with the home). */
  photosLeftBehind: boolean;
}

/** A home in its owner's 14-day trash (migration 0061): no coordinates, no answers. */
export interface TrashedHome {
  tagId: string;
  code: string;
  kind: HomeKind;
  label: string | null;
  unitLabel: string | null;
  /** UTC ms. */
  trashedAt: number;
  /** UTC ms: the nightly job deletes it for good after this. */
  purgeAt: number;
}

export interface JoinResult {
  tagId: string;
  status: MemberStatus;
}

export type HomeErrorCode =
  | "unconfigured"
  | "need_account"
  | "homes_limit"
  | "join_limit"
  | "wrong_code"
  | "network"
  | "photo_too_large"
  | "restore_limit"
  | "restore_expired"
  | "unknown";

export class HomeError extends Error {
  readonly code: HomeErrorCode;
  constructor(code: HomeErrorCode, message?: string) {
    super(message ?? code);
    this.name = "HomeError";
    this.code = code;
  }
}
