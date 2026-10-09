import type { TFunction } from "i18next";

import { profileHref } from "@/features/community/routes";
import { localizeDigits } from "@/lib/format-numbers";
import { normalizeReason, reasonLabel } from "@/features/reporting/reasons";
import type { ActivityItem } from "./types";

/** Rank codes that have words in `eventHub.roles`. */
const KNOWN_RANKS = [
  "official",
  "moderator",
  "engineer",
  "partner",
  "seismologist",
  "professor",
  "researcher",
] as const;

/** The person's name as shown: display name, else "A guest" (no profile), else "Someone". */
export function actorName(t: TFunction, item: ActivityItem): string {
  if (item.actor?.displayName) {
    return item.actor.displayName;
  }
  return item.actor ? t("activity.guest") : t("activity.someone");
}

function homeName(t: TFunction, item: ActivityItem): string {
  return item.homeLabel || item.homeCode || t("activity.home");
}

/** The main line of a row, in calm plain words. */
export function activityMessage(
  t: TFunction,
  item: ActivityItem,
  locale: string,
): string {
  const name = actorName(t, item);
  switch (item.kind) {
    case "comment_helpful":
    case "post_helpful":
      return t(`activity.kinds.${item.kind}`, {
        value: localizeDigits(String(item.count), locale),
      });
    case "badge_granted": {
      const known = KNOWN_RANKS.find((rank) => rank === item.role);
      return t("activity.kinds.badge_granted", {
        rank: known ? t(`eventHub.roles.${known}`) : (item.role ?? ""),
      });
    }
    case "home_join_request":
    case "home_join_approved":
      return t(`activity.kinds.${item.kind}`, { name, home: homeName(t, item) });
    case "content_removed":
      if (item.target === "post") {
        return t("activity.removed.post_remove");
      }
      if (item.target === "post_comment") {
        return item.action === "hide"
          ? t("activity.removed.post_comment_hide")
          : t("activity.removed.post_comment_remove");
      }
      return item.action === "hide"
        ? t("activity.removed.comment_hide")
        : t("activity.removed.comment_remove");
    case "report_reviewed":
      return t(`activity.reviewed.${item.target ?? "comment"}`);
    case "mention":
      return t(`activity.mention.${item.source ?? "comment"}`, { name });
    default:
      return t(`activity.kinds.${item.kind}`, { name });
  }
}

/** The smaller second line: what was said, which earthquake, or why. */
export function activityDetail(t: TFunction, item: ActivityItem): string | null {
  switch (item.kind) {
    case "comment_reply":
    case "post_comment":
    case "post_comment_reply":
    case "mention":
      return item.snippet ? t("activity.quote", { text: item.snippet }) : null;
    case "content_removed":
      return t("activity.removed.reason", {
        reason: normalizeReason(item.reason)
          ? reasonLabel(t, item.reason)
          : t("activity.removed.reasonGuidelines"),
      });
    case "family_safe":
    case "comment_helpful":
      return item.place ? t("activity.event.near", { place: item.place }) : null;
    default:
      return null;
  }
}

/** Where tapping the row goes; null when it opens nothing. */
export function activityHref(item: ActivityItem): string | null {
  switch (item.kind) {
    case "new_follower":
    case "follow_accepted":
      return item.actor?.username ? profileHref(item.actor.username) : null;
    case "follow_request":
      return "/account/people";
    case "comment_reply":
    case "comment_helpful":
      return item.hubId ? `/event-hub/${encodeURIComponent(item.hubId)}` : null;
    case "post_comment":
    case "post_comment_reply":
      return item.postAuthorUsername ? profileHref(item.postAuthorUsername) : null;
    case "mention":
      if (item.source === "comment") {
        return item.hubId ? `/event-hub/${encodeURIComponent(item.hubId)}` : null;
      }
      return item.postAuthorUsername ? profileHref(item.postAuthorUsername) : null;
    case "badge_granted":
      return "/badges";
    case "home_join_request":
    case "family_safe":
      return item.tagId ? `/home/${encodeURIComponent(item.tagId)}/family` : null;
    case "home_join_approved":
      return item.tagId ? `/home/${encodeURIComponent(item.tagId)}/report` : null;
    default:
      return null;
  }
}
