/** The version people accept. Mirrors `current_guidelines_version()` in
 * `supabase/migrations/0056_social_p1_deletion_reports_guidelines.sql`;
 * change them together (and the wording in the four locale files) and
 * everybody is asked again before their next comment or post. */
export const GUIDELINES_VERSION = "g1";

/** The rules, in the order they are shown. Each has `guidelines.rules.<id>.title`
 * and `.body` in the locale files. */
export const GUIDELINE_RULES = [
  "predictions",
  "privateInfo",
  "graphic",
  "respect",
  "feltReports",
] as const;
export type GuidelineRule = (typeof GUIDELINE_RULES)[number];

/** Where the acceptance came from (stored with it). */
export type GuidelinesSource = "prompt" | "signup" | "settings";
