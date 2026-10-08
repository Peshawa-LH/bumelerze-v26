import i18n from "i18next";

import { GRANTABLE_RANKS, type GrantableRank } from "../types";

/** The four app languages (kept here so this helper does not load the i18n
 * set-up module). */
const LOCALES = ["en", "ckb", "kmr", "ar"] as const;

/**
 * Which rank a badge request asks for. The request form prefills "Badge
 * request: <rank>" in the sender's language (app/feedback.tsx), so the rank
 * name in any of the four languages is looked for in the message; the one
 * that appears first wins. Only a suggestion: the admin picks the rank before
 * granting. Null when no rank name is found.
 */
export function guessRequestedRank(message: string): GrantableRank | null {
  const text = message.toLocaleLowerCase();
  let best: { rank: GrantableRank; at: number; length: number } | null = null;
  for (const rank of GRANTABLE_RANKS) {
    for (const lng of LOCALES) {
      const name = i18n.getResource(lng, "translation", `eventHub.roles.${rank}`);
      if (typeof name !== "string" || name.trim() === "") {
        continue;
      }
      const at = text.indexOf(name.toLocaleLowerCase());
      if (at < 0) {
        continue;
      }
      if (
        best === null ||
        at < best.at ||
        (at === best.at && name.length > best.length)
      ) {
        best = { rank, at, length: name.length };
      }
    }
  }
  return best?.rank ?? null;
}
