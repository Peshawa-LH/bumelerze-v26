import type { TFunction } from "i18next";

import { communityErrorText } from "@/features/community/error-text";

/** The inbox and photo queue's own server tokens (migration 0060) first, then
 * the shared community wording. */
export function inboxErrorText(t: TFunction, error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no_username")) {
    return t("admin.feedback.errors.noUsername");
  }
  if (message.includes("not_badge_request")) {
    return t("admin.feedback.errors.notBadgeRequest");
  }
  if (message.includes("already_rejected")) {
    return t("admin.photos.errors.alreadyRejected");
  }
  if (message.includes("not_account")) {
    return t("admin.feedback.errors.guest");
  }
  return communityErrorText(t, error);
}
