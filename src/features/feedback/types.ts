import type { SupportedLocale } from "@/i18n";

/**
 * In-app feedback client types (owner directive, see `queue.ts`'s own doc
 * for the full wave brief). Mirrors `supabase/migrations/0020_feedback.sql`
 * field-for-field, the same "one type per DB row" discipline
 * `src/features/felt/types.ts` already established for this repo.
 */

/** The three platforms `feedback.platform`'s CHECK constraint allows
 * (migration 0020) — a narrower set than React Native's own `Platform.OS`
 * union (which also has "windows"/"macos", neither ever built by this
 * app). See `context.ts`'s `normalizePlatform`. */
export type FeedbackPlatform = "ios" | "android" | "web";

/**
 * Automatically captured context (wave brief: "Capture the context
 * automatically rather than asking"). Every field is nullable because a
 * capture failure must never block the message itself — same "never block
 * the user-facing action on a secondary concern" stance
 * `EventRegistration`/`FeltLocation` already take in the felt-report
 * feature.
 */
export interface FeedbackContext {
  /** `Constants.expoConfig?.version` — the real build version string, never
   * hand-typed (wave brief: "not hardcoded"). */
  appVersion: string | null;
  locale: SupportedLocale | null;
  platform: FeedbackPlatform | null;
  /** Free-text route the Feedback screen was opened from, e.g. "settings" —
   * see `supabase/migrations/0020_feedback.sql`'s own comment on why this is
   * a free string, not an enum. */
  screen: string | null;
}

/**
 * A single feedback submission — mirrors `feedback` (+ the optional
 * `feedback_photos` row). One-to-one with a `FeedbackQueueItem`
 * (`queue.ts`), never split across tiers the way felt reports are (there is
 * no tier-2-style follow-up here).
 */
export interface FeedbackSubmission {
  /** Client-generated UUID; becomes `feedback.feedback_id`. Reused as the
   * row's own primary key specifically so a queue retry of an
   * already-landed submission is caught as a duplicate rather than creating
   * a second row — see migration 0020's own "runaway-client guard" comment. */
  feedbackId: string;
  deviceId: string;
  message: string;
  /** Optional "so a tester can be followed up with" (wave brief). */
  contact: string | null;
  context: FeedbackContext;
  /** A LOCAL file path/URI from `expo-image-picker`, never a remote URL at
   * capture time — same contract as `Tier2Report.photoUri`. */
  photoUri: string | null;
  createdAt: number;
}
