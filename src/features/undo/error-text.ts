import type { TFunction } from "i18next";

import { communityErrorText } from "@/features/community/error-text";
import { HubError } from "@/features/eventhub/types";

/** One-line localized message for a failed restore, whichever transport
 * (hub comments throw `HubError`, everything else `CommunityError`) it came
 * from. Too late and nothing-left-to-restore get their own words. */
export function restoreErrorText(t: TFunction, error: unknown): string {
  if (error instanceof HubError) {
    return error.code === "expired" || error.code === "not_restorable"
      ? t(`community.errors.${error.code}`)
      : t("eventHub.thread.actionError");
  }
  return communityErrorText(t, error);
}
