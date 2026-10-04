import type { TFunction } from "i18next";

import { HomeError } from "./types";

/** Localized one-line message for any error thrown by the home transport. */
export function homeErrorText(t: TFunction, error: unknown): string {
  const code = error instanceof HomeError ? error.code : "unknown";
  return t(`building.errors.${code}`);
}
