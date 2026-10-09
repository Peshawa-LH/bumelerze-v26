import { z } from "zod";

import { toCommunityError } from "@/features/community/transport";
import { CommunityError } from "@/features/community/types";
import { cleanNote, type ReportReason } from "@/features/reporting/reasons";
import { getSupabaseClient } from "@/lib/supabase";
import { POSTS_PAGE_SIZE } from "./constants";
import type { PostEvent, PostsPage, ProfilePost } from "./types";

/**
 * Profile posts data access (migrations 0050 and 0058). Reads go through
 * `profile_posts_page()`, which applies the same read rule as the table's
 * policy (`can_read_post`: public accounts to everyone, private accounts to
 * accepted followers, nothing between blocked people, nothing of a suspended
 * account) and adds the event card, the "Helpful" count and the author's edit
 * lock in the same round trip. Before migration 0058 it falls back to the
 * plain table read. Writes go through column-limited grants and SECURITY
 * DEFINER functions. Screens never call Supabase directly; tests inject a fake.
 */
export interface PostsTransport {
  /** Newest first. `before` is the previous page's `nextCursor`. The author
   * passes `includeRemoved` to also get their own removed posts. Throws
   * `unavailable` before the migration is applied. */
  fetchPosts(input: {
    userId: string;
    before: string | null;
    includeRemoved: boolean;
    limit?: number;
  }): Promise<PostsPage>;
  /** One post by id (the pinned one), or null when the viewer may not read
   * it (or it is gone). */
  fetchPost(userId: string, postId: string): Promise<ProfilePost | null>;
  createPost(userId: string, body: string): Promise<void>;
  /** The author's own edit (`edit_my_post`, 0058): refused with
   * `edit_locked` while the post has open reports. */
  editPost(postId: string, body: string): Promise<void>;
  /** Marks or unmarks a post as helpful (`set_post_helpful`, 0058); returns
   * the mark and the count the viewer may see. Repeating it is harmless. */
  setHelpful(
    postId: string,
    helpful: boolean,
  ): Promise<{ helpful: boolean; count: number }>;
  /** Pins one of my visible posts to the top of my profile; null unpins. */
  setPinned(postId: string | null): Promise<void>;
  /** Shares an earthquake to my profile (`share_event_to_profile`, 0058).
   * `eventRef` is the `bml` id (or the internal event id); `text` is optional.
   * Returns the post id. Never carries the person's location. */
  shareEvent(eventRef: string, text: string): Promise<string>;
  /** The author's own delete: a soft delete the author can undo for 24
   * hours (`delete_my_post`, 0053). */
  deletePost(postId: string): Promise<void>;
  /** Takes my deleted post back (`restore_my_post`, 0053). */
  restorePost(postId: string): Promise<void>;
  /** Reports a post (`report_post`); `note` is the optional 200-character
   * explanation (migration 0056). */
  reportPost(postId: string, reason: ReportReason, note?: string | null): Promise<void>;
  /** Admin soft remove (`posts.delete`); `reason` is a short code. */
  adminRemovePost(postId: string, reason: string): Promise<void>;
  /** Brings back a removed post (`admin_restore_post`, 0053; `content.restore`). */
  adminRestorePost(postId: string): Promise<void>;
}

const count = z.coerce.number().int().nonnegative().catch(0);

const rowSchema = z.object({
  post_id: z.string(),
  user_id: z.string(),
  body: z.string(),
  status: z.enum(["visible", "pending", "removed"]),
  created_at: z.string(),
  // migration 0058; absent from the plain table read before it
  kind: z.enum(["text", "event"]).catch("text").optional(),
  edited_at: z.string().nullable().optional(),
  event_ref: z.string().nullable().optional(),
  event_magnitude: z.coerce.number().nullable().catch(null).optional(),
  event_lat: z.coerce.number().nullable().catch(null).optional(),
  event_lon: z.coerce.number().nullable().catch(null).optional(),
  event_time: z.string().nullable().optional(),
  helpful_count: count.optional(),
  my_helpful: z.boolean().catch(false).optional(),
  edit_locked: z.boolean().catch(false).optional(),
});

function parseTime(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function parsePosts(data: unknown): ProfilePost[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const posts: ProfilePost[] = [];
  for (const row of data) {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) {
      continue;
    }
    const p = parsed.data;
    const createdAt = Date.parse(p.created_at);
    if (Number.isNaN(createdAt)) {
      continue;
    }
    const kind = p.kind ?? "text";
    const event: PostEvent | null =
      kind === "event"
        ? {
            ref: p.event_ref ?? null,
            magnitude: p.event_magnitude ?? null,
            lat: p.event_lat ?? null,
            lon: p.event_lon ?? null,
            time: parseTime(p.event_time),
          }
        : null;
    posts.push({
      id: p.post_id,
      userId: p.user_id,
      body: p.body,
      status: p.status,
      kind,
      event,
      createdAt,
      editedAt: parseTime(p.edited_at),
      helpfulCount: p.helpful_count ?? 0,
      myHelpful: p.my_helpful ?? false,
      editLocked: p.edit_locked ?? false,
      cursor: p.created_at,
    });
  }
  return posts;
}

const helpfulSchema = z.object({ helpful: z.boolean(), count });

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new CommunityError("unavailable", "Supabase is not configured");
  }
  return client;
}

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await requireClient().rpc(name, args);
  if (error) {
    throw toCommunityError(error);
  }
  return data;
}

function toPage(rows: ProfilePost[], limit: number): PostsPage {
  const posts = rows.slice(0, limit);
  const last = posts[posts.length - 1];
  return {
    posts,
    nextCursor: rows.length > limit && last ? last.cursor : null,
  };
}

/** The plain table read of migration 0050, used until 0058 is applied. */
async function fetchPostsFromTable(input: {
  userId: string;
  before: string | null;
  includeRemoved: boolean;
  limit: number;
}): Promise<PostsPage> {
  let query = requireClient()
    .from("profile_posts")
    .select("post_id,user_id,body,status,created_at")
    .eq("user_id", input.userId)
    .order("created_at", { ascending: false })
    // one extra row tells whether another page exists
    .limit(input.limit + 1);
  if (!input.includeRemoved) {
    query = query.eq("status", "visible");
  }
  if (input.before) {
    query = query.lt("created_at", input.before);
  }
  const { data, error } = await query;
  if (error) {
    throw toCommunityError(error);
  }
  return toPage(parsePosts(data), input.limit);
}

function isUnavailable(error: unknown): boolean {
  return error instanceof CommunityError && error.code === "unavailable";
}

export const SupabasePostsTransport: PostsTransport = {
  async fetchPosts({ userId, before, includeRemoved, limit = POSTS_PAGE_SIZE }) {
    try {
      const data = await rpc("profile_posts_page", {
        p_user: userId,
        p_before: before,
        // one extra row tells whether another page exists
        p_limit: limit + 1,
        p_include_removed: includeRemoved,
      });
      return toPage(parsePosts(data), limit);
    } catch (error) {
      if (isUnavailable(error)) {
        return fetchPostsFromTable({ userId, before, includeRemoved, limit });
      }
      throw error;
    }
  },

  async fetchPost(userId, postId) {
    try {
      const data = await rpc("profile_posts_page", {
        p_user: userId,
        p_limit: 1,
        p_post_id: postId,
      });
      return parsePosts(data)[0] ?? null;
    } catch (error) {
      // before 0058 there is no pinned post to show
      if (isUnavailable(error)) {
        return null;
      }
      throw error;
    }
  },

  async createPost(userId, body) {
    const { error } = await requireClient()
      .from("profile_posts")
      .insert({ user_id: userId, body: body.trim() });
    if (error) {
      throw toCommunityError(error);
    }
  },

  async editPost(postId, body) {
    await rpc("edit_my_post", { p_post_id: postId, p_body: body.trim() });
  },

  async setHelpful(postId, helpful) {
    const data = await rpc("set_post_helpful", { p_post_id: postId, p_helpful: helpful });
    const parsed = helpfulSchema.safeParse(data);
    return parsed.success ? parsed.data : { helpful, count: 0 };
  },

  async setPinned(postId) {
    await rpc("set_pinned_post", { p_post_id: postId });
  },

  async shareEvent(eventRef, text) {
    const data = await rpc("share_event_to_profile", {
      p_event: eventRef,
      p_body: text.trim(),
    });
    return typeof data === "string" ? data : "";
  },

  async deletePost(postId) {
    await rpc("delete_my_post", { p_post_id: postId });
  },

  async restorePost(postId) {
    await rpc("restore_my_post", { p_post_id: postId });
  },

  async reportPost(postId, reason, note) {
    const cleaned = cleanNote(note);
    await rpc("report_post", {
      p_post: postId,
      p_reason: reason,
      ...(cleaned ? { p_note: cleaned } : {}),
    });
  },

  async adminRemovePost(postId, reason) {
    await rpc("admin_remove_post", { p_post_id: postId, p_reason: reason });
  },

  async adminRestorePost(postId) {
    await rpc("admin_restore_post", { p_post_id: postId, p_note: null });
  },
};
