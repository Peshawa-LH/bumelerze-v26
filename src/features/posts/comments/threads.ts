import type { PostComment, PostCommentThread } from "./types";

/** A comment whose author deleted their account (0063, like 0056 for the
 * hub): no author, no text, still visible so the replies keep their place. */
export function isDeletedAccountPostComment(
  comment: Pick<PostComment, "userId" | "body" | "status">,
): boolean {
  return comment.status === "visible" && comment.userId === null && comment.body === "";
}

export interface PostThreadViewer {
  userId: string | null;
  /** People the viewer muted (migration 0061): left out for this viewer. */
  mutedIds?: ReadonlySet<string> | undefined;
}

/**
 * Flat rows -> conversations, the Event hub's way (0036, 0061): top comments
 * newest first, each one's replies oldest first; a reply whose top comment is
 * not shown is dropped rather than shown without its context; a muted
 * person's comments go (with the replies under them); a removed comment or a
 * deleted account's blank stays only as the head of a conversation that still
 * has replies, and never as a reply. The server already left out what the
 * viewer may not see (blocks, suspensions, other people's held comments).
 */
export function buildPostThreads(
  comments: readonly PostComment[],
  viewer: PostThreadViewer,
): PostCommentThread[] {
  const muted = viewer.mutedIds;
  const shown = comments.filter(
    (comment) =>
      !(
        muted !== undefined &&
        comment.userId !== null &&
        comment.userId !== viewer.userId &&
        muted.has(comment.userId)
      ),
  );
  const replies = new Map<string, PostComment[]>();
  for (const comment of shown) {
    if (comment.parentId === null) continue;
    const list = replies.get(comment.parentId) ?? [];
    list.push(comment);
    replies.set(comment.parentId, list);
  }
  const placeholder = (comment: PostComment) =>
    comment.status === "removed" || isDeletedAccountPostComment(comment);
  return shown
    .filter((comment) => comment.parentId === null)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((root) => ({
      root,
      replies: (replies.get(root.id) ?? [])
        .filter((reply) => !placeholder(reply))
        .sort((a, b) => a.createdAt - b.createdAt),
    }))
    .filter((thread) => !placeholder(thread.root) || thread.replies.length > 0);
}

/** How many comments a thread list shows (placeholders do not count). */
export function countShown(threads: readonly PostCommentThread[]): number {
  let n = 0;
  for (const thread of threads) {
    if (thread.root.status !== "removed" && !isDeletedAccountPostComment(thread.root)) {
      n += 1;
    }
    n += thread.replies.length;
  }
  return n;
}
