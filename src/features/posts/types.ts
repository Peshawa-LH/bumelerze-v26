/** `profile_posts.status` (migration 0050). A removed post has no text: only
 * its author still sees it, as "Removed by moderators". */
export type PostStatus = "visible" | "removed";

export interface ProfilePost {
  id: string;
  userId: string;
  /** Empty for a removed post. */
  body: string;
  status: PostStatus;
  /** UTC ms. */
  createdAt: number;
  /** The raw `created_at` text, used unchanged as the next page's cursor so
   * microseconds are never lost. */
  cursor: string;
}

export interface PostsPage {
  posts: ProfilePost[];
  /** Cursor of the next (older) page, or null when this was the last. */
  nextCursor: string | null;
}
