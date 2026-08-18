import Constants from "expo-constants";
import { Platform } from "react-native";

import i18n, { SUPPORTED_LOCALES, type SupportedLocale } from "@/i18n";

import type { FeedbackContext, FeedbackPlatform } from "./types";

/** Narrows `Platform.OS` to `feedback.platform`'s CHECK constraint values
 * (migration 0020) — `null` for any platform this app doesn't build for
 * (there is no such build today; this is defensive, not reachable in
 * practice). */
function normalizePlatform(): FeedbackPlatform | null {
  return Platform.OS === "ios" || Platform.OS === "android" || Platform.OS === "web"
    ? Platform.OS
    : null;
}

function normalizeLocale(): SupportedLocale | null {
  const language = i18n.language;
  return (SUPPORTED_LOCALES as readonly string[]).includes(language)
    ? (language as SupportedLocale)
    : null;
}

/**
 * Builds the automatically-captured context for one feedback submission
 * (wave brief: "Capture the context automatically rather than asking" —
 * app version, locale, platform, and where possible which screen the user
 * came from). Called once, at enqueue time (`queue.ts`'s `enqueueFeedback`)
 * — never re-derived later, so the captured context reflects the app state
 * at the moment the user actually submitted, not whenever a queued retry
 * happens to run.
 */
export function buildFeedbackContext(screen: string | null): FeedbackContext {
  return {
    appVersion: Constants.expoConfig?.version ?? null,
    locale: normalizeLocale(),
    platform: normalizePlatform(),
    screen,
  };
}
