/** The kinds of row in the Activity list (migration 0061). */
export const ACTIVITY_KINDS = [
  "new_follower",
  "follow_request",
  "follow_accepted",
  "comment_reply",
  "comment_helpful",
  "post_helpful",
  "content_removed",
  "badge_granted",
  "report_reviewed",
  "home_join_request",
  "home_join_approved",
  "family_safe",
  // migration 0063
  "post_comment",
  "post_comment_reply",
  "mention",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** Who did it: public fields only. Null for moderation, ranks and reviews
 * (nobody is named for those), or when the person is a guest (no profile). */
export interface ActivityActor {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarPath: string | null;
}

/** One row of `my_activity()`. Never a place: no coordinates exist in it. */
export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  /** UTC ms. */
  createdAt: number;
  read: boolean;
  actor: ActivityActor | null;
  /** Helpful marks counted on that day (1 for every other kind). */
  count: number;
  /** badge_granted: the rank and, for a partner, the organisation. */
  role: string | null;
  orgName: string | null;
  /** content_removed / report_reviewed: comment, post, post comment
   * (migration 0063) or profile. */
  target: "comment" | "post" | "post_comment" | "profile" | null;
  /** content_removed: hide (a moderator hid it) or remove. */
  action: "hide" | "remove" | null;
  /** content_removed: the reason code (a report reason) or free text. */
  reason: string | null;
  /** content_removed: "Ask for review" was already sent. */
  appealed: boolean;
  /** Event hub route id (`bml…`) of the comment's or check-in's earthquake. */
  hubId: string | null;
  place: string | null;
  magnitude: number | null;
  /** comment_reply: the first 140 characters of the (still visible) reply. */
  snippet: string | null;
  commentId: string | null;
  postId: string | null;
  /** Home rows: the home's id, label and code (the reader is a member). */
  tagId: string | null;
  homeLabel: string | null;
  homeCode: string | null;
  /** Migration 0063: the comment under a post, the @username of the post's
   * author (the app opens that profile), and for a mention where the text
   * is: a hub comment, a post or a post comment. */
  postCommentId: string | null;
  postAuthorUsername: string | null;
  source: "comment" | "post" | "post_comment" | null;
}
