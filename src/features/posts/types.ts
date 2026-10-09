/** `profile_posts.status` (migration 0050). A removed post has no text: only
 * its author still sees it, as "Removed by moderators". A pending post
 * (migration 0059: the word filter or busy-time review held it) is seen only
 * by its author, as "Waiting for review", until a moderator approves it. */
export type PostStatus = "visible" | "pending" | "removed";

/** `profile_posts.kind` (migration 0058): a text post, or an earthquake shared
 * to the profile (an event card with optional text). */
export type PostKind = "text" | "event";

/** The earthquake an event post points at, as the server resolved it (a
 * merged event resolves to the surviving one). Public EVENT data only (the
 * epicentre, so the app writes the place line in the reader's language); the
 * person's own location is never part of a post. */
export interface PostEvent {
  /** The `bml` id the event page opens, or null when the event is no longer
   * listed (deleted upstream): the card then shows a plain note. */
  ref: string | null;
  magnitude: number | null;
  /** Epicentre of the earthquake (not the person). */
  lat: number | null;
  lon: number | null;
  /** Origin time, UTC ms, or null. */
  time: number | null;
}

export interface ProfilePost {
  id: string;
  userId: string;
  /** Empty for a removed post, and possibly for an event post. */
  body: string;
  status: PostStatus;
  kind: PostKind;
  /** Only for `kind === "event"`. */
  event: PostEvent | null;
  /** UTC ms. */
  createdAt: number;
  /** When the author last changed the text (UTC ms), or null: "Edited". */
  editedAt: number | null;
  /** "Helpful" marks the viewer may count (migration 0058). */
  helpfulCount: number;
  /** The viewer marked it helpful. */
  myHelpful: boolean;
  /** Only ever true for the author: the post has open reports, so its text
   * cannot be edited until a moderator has looked at it. */
  editLocked: boolean;
  /** The raw `created_at` text, used unchanged as the next page's cursor so
   * microseconds are never lost. */
  cursor: string;
  /** Visible comments this viewer may see (migration 0063; 0 before it). */
  commentCount: number;
  /** The author switched comments off for this post (0063). */
  commentsOff: boolean;
}

export interface PostsPage {
  posts: ProfilePost[];
  /** Cursor of the next (older) page, or null when this was the last. */
  nextCursor: string | null;
}
