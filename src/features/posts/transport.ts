import { z } from "zod";

import { toCommunityError } from "@/features/community/transport";
import { CommunityError } from "@/features/community/types";
import type { FlagReason } from "@/features/eventhub/types";
import { getSupabaseClient } from "@/lib/supabase";
import { POSTS_PAGE_SIZE } from "./constants";
import type { PostsPage, ProfilePost } from "./types";

/**
 * Profile posts data access (migration 0050). Reads go through row level
 * security (the server decides who may see which post: public accounts to
 * everyone, private accounts to accepted followers, nothing between blocked
 * people); writes go through column-limited grants and SECURITY DEFINER
 * functions. Screens never call Supabase directly; tests inject a fake.
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
  createPost(userId: string, body: string): Promise<void>;
  /** The author's own delete: a real delete. */
  deletePost(postId: string): Promise<void>;
  reportPost(postId: string, reason: FlagReason): Promise<void>;
  /** Admin soft remove (`posts.delete`); `reason` is a short code. */
  adminRemovePost(postId: string, reason: string): Promise<void>;
}

const rowSchema = z.object({
  post_id: z.string(),
  user_id: z.string(),
  body: z.string(),
  status: z.enum(["visible", "removed"]),
  created_at: z.string(),
});

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
    const createdAt = Date.parse(parsed.data.created_at);
    if (Number.isNaN(createdAt)) {
      continue;
    }
    posts.push({
      id: parsed.data.post_id,
      userId: parsed.data.user_id,
      body: parsed.data.body,
      status: parsed.data.status,
      createdAt,
      cursor: parsed.data.created_at,
    });
  }
  return posts;
}

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new CommunityError("unavailable", "Supabase is not configured");
  }
  return client;
}

async function rpc(name: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await requireClient().rpc(name, args);
  if (error) {
    throw toCommunityError(error);
  }
}

export const SupabasePostsTransport: PostsTransport = {
  async fetchPosts({ userId, before, includeRemoved, limit = POSTS_PAGE_SIZE }) {
    let query = requireClient()
      .from("profile_posts")
      .select("post_id,user_id,body,status,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      // one extra row tells whether another page exists
      .limit(limit + 1);
    if (!includeRemoved) {
      query = query.eq("status", "visible");
    }
    if (before) {
      query = query.lt("created_at", before);
    }
    const { data, error } = await query;
    if (error) {
      throw toCommunityError(error);
    }
    const rows = parsePosts(data);
    const posts = rows.slice(0, limit);
    const last = posts[posts.length - 1];
    return {
      posts,
      nextCursor: rows.length > limit && last ? last.cursor : null,
    };
  },

  async createPost(userId, body) {
    const { error } = await requireClient()
      .from("profile_posts")
      .insert({ user_id: userId, body: body.trim() });
    if (error) {
      throw toCommunityError(error);
    }
  },

  async deletePost(postId) {
    const { error } = await requireClient()
      .from("profile_posts")
      .delete()
      .eq("post_id", postId);
    if (error) {
      throw toCommunityError(error);
    }
  },

  async reportPost(postId, reason) {
    await rpc("report_post", { p_post: postId, p_reason: reason });
  },

  async adminRemovePost(postId, reason) {
    await rpc("admin_remove_post", { p_post_id: postId, p_reason: reason });
  },
};
