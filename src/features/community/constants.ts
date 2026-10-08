import { reasonsFor, type ReportReason } from "@/features/reporting/reasons";

/** Mirrors `supabase/migrations/0045_usernames.sql` — change them together. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;
export const USERNAME_PATTERN = /^[a-z0-9_.]{3,24}$/;

/** `profile_reports.reason`: the shared list of migration 0056 (the profile
 * list includes impersonation). */
export const PROFILE_REPORT_REASONS = reasonsFor("profile");
export type ProfileReportReason = ReportReason;

/** Milestone badges that stay off a public profile: they say something about
 * a person's household (a tagged home, a linked family), which is never
 * shown to others. */
export const PRIVATE_MILESTONE_IDS = ["home_tagged", "family_linked"] as const;
