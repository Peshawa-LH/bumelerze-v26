/** One row of `my_recently_deleted()` (migration 0053): something the signed-in
 * person deleted in the last 24 hours and can still bring back. */
export interface RecentlyDeletedItem {
  /** A hub comment, a post, or a comment under a post (migration 0063). */
  kind: "comment" | "post" | "post_comment";
  id: string;
  body: string;
  /** UTC ms. */
  deletedAt: number;
  /** UTC ms: after this Restore stops working. */
  expiresAt: number;
  /** Event hub route id (`bml...`) of a comment, or null. */
  hubId: string | null;
  place: string | null;
  magnitude: number | null;
}
