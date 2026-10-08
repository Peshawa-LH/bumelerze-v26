import type { HubComment, HubThread } from "./types";

/**
 * Who may see a comment. RLS already limits the rows a reader gets; this
 * repeats the rule for the client's own view so a moderator (who is allowed
 * to read hidden rows too) never sees a hidden comment in the thread:
 *  - visible: everyone
 *  - removed: moderators always; readers only as a "Comment removed"
 *    placeholder above replies that are still readable (see buildThreads)
 *  - pending: its author, and moderators (to approve or hide it)
 *  - hidden: nobody
 */
export function isCommentShown(
  comment: HubComment,
  viewer: { userId: string | null; isModerator: boolean },
): boolean {
  if (comment.status === "visible" || comment.status === "removed") {
    return true;
  }
  if (comment.status === "pending") {
    return (
      viewer.isModerator || (viewer.userId !== null && comment.userId === viewer.userId)
    );
  }
  return false;
}

export interface ThreadViewer {
  userId: string | null;
  isModerator: boolean;
  /** People the viewer follows: their threads come first. */
  followingIds?: ReadonlySet<string> | undefined;
}

/**
 * Flat rows -> threads. Top-level comments newest first, except that threads
 * started by people the viewer follows come before the rest (each group still
 * newest first); each one's replies
 * oldest first (a conversation reads top to bottom). Replies are one level
 * deep by construction (the server re-parents deeper ones), and a reply whose
 * parent is not shown (hidden, or not yet loaded) is dropped rather than
 * shown without its context.
 */
export function buildThreads(
  comments: readonly HubComment[],
  viewer: ThreadViewer,
): HubThread[] {
  const following = viewer.followingIds;
  const followed = (comment: HubComment) =>
    following !== undefined && comment.userId !== null && following.has(comment.userId)
      ? 1
      : 0;
  const shown = comments.filter((comment) => isCommentShown(comment, viewer));
  const roots = shown
    .filter((comment) => comment.parentId === null)
    .sort((a, b) => followed(b) - followed(a) || b.createdAt - a.createdAt);

  const repliesByParent = new Map<string, HubComment[]>();
  for (const comment of shown) {
    if (comment.parentId === null) {
      continue;
    }
    const siblings = repliesByParent.get(comment.parentId) ?? [];
    siblings.push(comment);
    repliesByParent.set(comment.parentId, siblings);
  }

  const threads = roots.map((root) => ({
    root,
    replies: (repliesByParent.get(root.id) ?? []).sort(
      (a, b) => a.createdAt - b.createdAt,
    ),
  }));
  if (viewer.isModerator) {
    return threads;
  }
  // Readers see no trace of removed comments (owner, 2026-10-08): a removed
  // reply disappears, and a removed comment stays as a "Comment removed"
  // placeholder only while replies under it are still readable.
  return threads.flatMap((thread) => {
    const replies = thread.replies.filter((reply) => reply.status !== "removed");
    if (thread.root.status === "removed" && replies.length === 0) {
      return [];
    }
    return [{ root: thread.root, replies }];
  });
}
