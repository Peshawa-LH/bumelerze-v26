import type { Profession } from "./constants";

/** Row of `public.profiles` (readable by anyone). */
export interface Profile {
  userId: string;
  displayName: string;
  /** Path inside the public `avatars` bucket, or null. */
  avatarPath: string | null;
  /** Public @handle, lowercase; null until chosen (migration 0045). */
  username: string | null;
  /** Private account: people must ask to follow (migration 0045). */
  isPrivate: boolean;
  /** False when the server has no username / private columns yet, so the
   * profile form hides those fields instead of failing to save. */
  communityReady: boolean;
}

/** Row of `public.profile_private` (owner only). Never shown publicly. */
export interface PrivateProfile {
  profession: Profession | null;
  locale: string | null;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  researchConsentVersion: string | null;
  researchConsentAt: string | null;
  /** Hide my milestone badges on my public profile (migration 0045). */
  hideBadges: boolean;
}

export type AccountStatus = "unconfigured" | "loading" | "anonymous" | "account";

export interface AccountState {
  status: AccountStatus;
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  privateProfile: PrivateProfile | null;
  /** True once the profile rows were fetched (so "no profile yet" can be
   * told apart from "not loaded yet"). */
  profileLoaded: boolean;
}

export type AccountErrorCode =
  | "unconfigured"
  | "invalid_email"
  | "email_taken"
  | "weak_password"
  | "same_password"
  | "invalid_credentials"
  | "reauth_needed"
  | "setup_incomplete"
  | "email_mismatch"
  | "password_mismatch"
  | "rate_limited"
  | "network"
  | "no_session"
  | "name_length"
  | "terms_required"
  | "avatar_too_large"
  | "username_invalid"
  | "username_taken"
  | "username_reserved"
  | "name_reserved"
  | "oauth_unavailable"
  | "unknown";

export class AccountError extends Error {
  readonly code: AccountErrorCode;
  constructor(code: AccountErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AccountError";
    this.code = code;
  }
}

export type AvatarChange =
  { kind: "keep" } | { kind: "remove" } | { kind: "new"; uri: string };
