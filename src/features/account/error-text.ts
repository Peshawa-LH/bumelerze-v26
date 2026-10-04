import type { TFunction } from "i18next";

import { AccountError } from "./types";

/** Localized one-line message for any error thrown by the account service. */
export function accountErrorText(t: TFunction, error: unknown): string {
  const code = error instanceof AccountError ? error.code : "unknown";
  return t(`account.errors.${code}`);
}
