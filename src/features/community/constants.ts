/** Mirrors `supabase/migrations/0045_usernames.sql` — change them together. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;
export const USERNAME_PATTERN = /^[a-z0-9_.]{3,24}$/;

/** `profile_reports.reason` (migration 0047). */
export const PROFILE_REPORT_REASONS = [
  "spam",
  "abuse",
  "impersonation",
  "private",
  "other",
] as const;
export type ProfileReportReason = (typeof PROFILE_REPORT_REASONS)[number];

/** Milestone badges that stay off a public profile: they say something about
 * a person's household (a tagged home, a linked family), which is never
 * shown to others. */
export const PRIVATE_MILESTONE_IDS = ["home_tagged", "family_linked"] as const;
