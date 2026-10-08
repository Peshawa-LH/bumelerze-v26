import type { TFunction } from "i18next";

import { localizeDigits } from "@/lib/format-numbers";
import type { PersonKind } from "./types";

/** First 8 characters of a user id: how a guest is named ("Guest a1b2c3d4"). */
export function shortId(userId: string): string {
  return userId.replace(/-/g, "").slice(0, 8);
}

/** 12345 -> "12,345" in the reader's digits (٢٤٦ in Sorani and Arabic). */
export function formatCount(value: number, language: string): string {
  const grouped = String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return localizeDigits(grouped, language);
}

/** The person's name for lists and headers: display name, else the @username,
 * else "Guest a1b2c3d4" / "Account a1b2c3d4". */
export function personName(
  t: TFunction,
  person: {
    userId: string;
    kind: PersonKind;
    displayName: string | null;
    username: string | null;
  },
): string {
  if (person.displayName) {
    return person.displayName;
  }
  if (person.username) {
    return `@${person.username}`;
  }
  return t(person.kind === "guest" ? "admin.people.guestName" : "admin.people.accountName", {
    id: shortId(person.userId),
  });
}
