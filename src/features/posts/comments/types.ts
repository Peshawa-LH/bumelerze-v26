import type { HubRole } from "@/features/eventhub/types";

/** Mirrors `post_comments` (migration 0063) — change them together. */
export const POST_COMMENT_MAX_LENGTH = 500;

/** What a reader can get back from `post_comments_page()`: visible ones,
 * their own held ones (pending) and removed ones as an empty placeholder.
 * Hidden and deleted comments never reach the app. */
export type PostCommentStatus = "visible" | "pending" | "removed";

/** One comment under a profile post, with its author's public fields. */
export interface PostComment {
  id: string;
  postId: string;
  /** The top comment of the conversation, or null (one level of replies). */
  parentId: string | null;
  /** Null for a removed comment and for a deleted account's blank. */
  userId: string | null;
  username: string | null;
  displayName: string | null;
  avatarPath: string | null;
  roles: HubRole[];
  /** Empty for a removed comment and for a deleted account's blank. */
  body: string;
  status: PostCommentStatus;
  /** UTC ms. */
  createdAt: number;
}

export interface PostCommentThread {
  root: PostComment;
  /** Oldest first. */
  replies: PostComment[];
}

/** Who took a comment down with `delete_post_comment`: its author (shows in
 * "Recently deleted") or the post's author (quiet; Undo only). */
export type DeletedBy = "author" | "owner";

/** One row of `post_comment_queue()` (moderators): held for review, or
 * visible with open reports. */
export interface PostCommentQueueRow {
  commentId: string;
  postId: string;
  postAuthorUsername: string | null;
  authorId: string | null;
  username: string | null;
  displayName: string | null;
  body: string;
  status: "pending" | "visible";
  reportCount: number;
  lastReason: string | null;
  lastNote: string | null;
  /** UTC ms. */
  createdAt: number;
}
