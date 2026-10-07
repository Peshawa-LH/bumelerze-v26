import type { TFunction } from "i18next";

import { CommunityError } from "./types";

/** One-line localized message for any failure of a community action. */
export function communityErrorText(t: TFunction, error: unknown): string {
  const code = error instanceof CommunityError ? error.code : "unknown";
  return t(`community.errors.${code}`);
}
