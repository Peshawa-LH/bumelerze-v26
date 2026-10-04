import type { HubComment, HubThread } from "./types";

/**
 * Who may see a comment. RLS already limits the rows a reader gets; this
 * repeats the rule for the client's own view so a moderator (who is allowed
 * to read hidden rows too) never sees a hidden comment in the thread:
 *  - visible: everyone
 *  - pending: its author, and moderators (to approve or hide it)
 *  - hidden: nobody
 */
export function isCommentShown(
  comment: HubComment,
  viewer: { userId: string | null; isModerator: boolean },
): boolean {
  if (comment.status === "visible") {
    return true;
  }
  if (comment.status === "pending") {
    return (
      viewer.isModerator || (viewer.userId !== null && comment.userId === viewer.userId)
    );
  }
  return false;
}

/**
 * Flat rows -> threads. Top-level comments newest first; each one's replies
 * oldest first (a conversation reads top to bottom). Replies are one level
 * deep by construction (the server re-parents deeper ones), and a reply whose
 * parent is not shown (hidden, or not yet loaded) is dropped rather than
 * shown without its context.
 */
export function buildThreads(
  comments: readonly HubComment[],
  viewer: { userId: string | null; isModerator: boolean },
): HubThread[] {
  const shown = comments.filter((comment) => isCommentShown(comment, viewer));
  const roots = shown
    .filter((comment) => comment.parentId === null)
    .sort((a, b) => b.createdAt - a.createdAt);

  const repliesByParent = new Map<string, HubComment[]>();
  for (const comment of shown) {
    if (comment.parentId === null) {
      continue;
    }
    const siblings = repliesByParent.get(comment.parentId) ?? [];
    siblings.push(comment);
    repliesByParent.set(comment.parentId, siblings);
  }

  return roots.map((root) => ({
    root,
    replies: (repliesByParent.get(root.id) ?? []).sort(
      (a, b) => a.createdAt - b.createdAt,
    ),
  }));
}
