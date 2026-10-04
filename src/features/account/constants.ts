/** Accounts phase 1 constants. Values here mirror
 * `supabase/migrations/0035_accounts_profiles.sql` exactly — change them
 * together or the database check constraints will reject the write. */

/** `profile_private.profession` check list. `null` = "prefer not to say". */
export const PROFESSIONS = [
  "engineer",
  "architect",
  "construction",
  "teacher",
  "health",
  "student",
  "public_service",
  "business",
  "agriculture",
  "other",
] as const;
export type Profession = (typeof PROFESSIONS)[number];

export function isProfession(value: unknown): value is Profession {
  return typeof value === "string" && (PROFESSIONS as readonly string[]).includes(value);
}

/** `profiles.display_name` check: 2..40 characters after trimming. */
export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 40;

/** Versions of the texts the user agreed to. Bump when the wording changes;
 * the profile screen then asks again (stored on `profile_private`). */
export const TERMS_VERSION = "2026-10-04";
export const RESEARCH_CONSENT_VERSION = "2026-10-04";

export const PRIVACY_URL = "https://bumelerze.com/privacy";

export const AVATARS_BUCKET = "avatars";
/** Bucket limit (migration 0035): 1 MB. */
export const AVATAR_MAX_BYTES = 1_048_576;
export const AVATAR_MAX_EDGE_PX = 256;

/** Email one-time code length (Supabase default: 6 digits). */
export const EMAIL_CODE_LENGTH = 6;
/** Seconds before the code can be requested again. */
export const RESEND_COOLDOWN_SECONDS = 60;

/** Social sign-in buttons stay hidden until the provider is configured in
 * Supabase and the owner flips the matching flag. Static `process.env`
 * access so Metro can inline it. */
export function isGoogleAuthEnabled(): boolean {
  return process.env.EXPO_PUBLIC_AUTH_GOOGLE === "1";
}
export function isAppleAuthEnabled(): boolean {
  return process.env.EXPO_PUBLIC_AUTH_APPLE === "1";
}
