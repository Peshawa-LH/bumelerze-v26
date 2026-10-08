import type { HubComment } from "./types";

/**
 * A comment whose author deleted their account (migration 0056): the text and
 * the author link are gone but the row stays visible, so the replies under it
 * still read in order. Shown as "Deleted account", with no photo, name or link.
 * (Nothing else produces a visible comment without an author and without text.)
 */
export function isDeletedAccountComment(
  comment: Pick<HubComment, "userId" | "body" | "status">,
): boolean {
  return comment.status === "visible" && comment.userId === null && comment.body === "";
}
