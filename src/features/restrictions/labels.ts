import type { TFunction } from "i18next";

import { formatAbsoluteDual } from "@/features/events/format";
import { isReasonPreset, type MyRestriction, type RestrictionLevel } from "./types";

/** The reason in the reader's language when it is one of the presets, else the
 * words the admin typed. */
export function reasonText(t: TFunction, reason: string): string {
  return isReasonPreset(reason) ? t(`restrictions.reasons.${reason}`) : reason;
}

export function levelText(t: TFunction, level: RestrictionLevel): string {
  return t(`restrictions.levels.${level}`);
}

/** Local date and time of a limit's end, in the reader's digits. */
export function untilText(t: TFunction, language: string, endsAt: number): string {
  return formatAbsoluteDual(endsAt, language, t).local;
}

/** The calm sentence of the banner: what happened, until when, and why. */
export function bannerMessage(
  t: TFunction,
  language: string,
  restriction: Pick<MyRestriction, "level" | "reason" | "endsAt">,
): string {
  const reason = reasonText(t, restriction.reason);
  if (restriction.level === "warning") {
    return t("restrictions.banner.warning", { reason });
  }
  const base = restriction.level === "suspend" ? "suspended" : "limited";
  if (restriction.endsAt === null) {
    return t(`restrictions.banner.${base}Open`, { reason });
  }
  return t(`restrictions.banner.${base}`, {
    date: untilText(t, language, restriction.endsAt),
    reason,
  });
}
