import type { TFunction } from "i18next";

import { localizeDigits } from "@/lib/format-numbers";

import type { BadgeEntry } from "./evaluate";

/** The spoken/visible name and one-line rule of a badge, in the reader's
 * language. Counts go through `localizeDigits` like every other numeral. */
export function badgeLabels(
  entry: BadgeEntry,
  t: TFunction,
  locale: string,
): { name: string; rule: string } {
  if (entry.kind === "role") {
    const name =
      entry.role === "partner" && entry.orgName
        ? entry.orgName
        : t(`eventHub.roles.${entry.role}`);
    return { name, rule: t("myData.badges.roleRule") };
  }
  const { badge } = entry;
  const count = localizeDigits(String(badge.target), locale);
  return {
    name: t(badge.nameKey, { count }),
    rule: t(badge.ruleKey, { count }),
  };
}
