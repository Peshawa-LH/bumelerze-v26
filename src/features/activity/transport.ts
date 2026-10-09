import { z } from "zod";

import { toCommunityError } from "@/features/community/transport";
import { CommunityError } from "@/features/community/types";
import { getSupabaseClient } from "@/lib/supabase";
import { ACTIVITY_KINDS, type ActivityItem } from "./types";

/**
 * Activity data access (migration 0061). Screens never call Supabase
 * directly; tests inject a fake `ActivityTransport`. Every read goes through a
 * SECURITY DEFINER function that already applies blocks, mutes and the home
 * rules; this file keeps only the fields it knows.
 */
export interface ActivityTransport {
  /** Newest first; `before` (UTC ms) pages back. Throws `unavailable` before
   * the migration is applied. */
  fetchActivity(before?: number | null): Promise<ActivityItem[]>;
  /** The bell's number (at most 99). */
  fetchUnread(): Promise<number>;
  /** Marks these rows read, or every row when `ids` is left out. */
  markRead(ids?: readonly string[]): Promise<void>;
  /** "Ask for review" on a removed comment or post (files an appeal). */
  requestReview(itemId: string, message: string): Promise<void>;
}

/** Rows per page. */
export const ACTIVITY_PAGE = 50;

const rowSchema = z.object({
  item_id: z.string(),
  kind: z.enum(ACTIVITY_KINDS),
  created_at: z.string(),
  read_at: z.string().nullable().optional(),
  actor_id: z.string().nullable().optional(),
  actor_username: z.string().nullable().optional(),
  actor_name: z.string().nullable().optional(),
  actor_avatar: z.string().nullable().optional(),
  item_count: z.coerce.number().int().nonnegative().catch(1).optional(),
  role: z.string().nullable().optional(),
  org_name: z.string().nullable().optional(),
  target: z
    .enum(["comment", "post", "post_comment", "profile"])
    .nullable()
    .catch(null)
    .optional(),
  action: z.enum(["hide", "remove"]).nullable().catch(null).optional(),
  reason: z.string().nullable().optional(),
  appealed: z.boolean().catch(false).optional(),
  hub_id: z.string().nullable().optional(),
  place: z.string().nullable().optional(),
  magnitude: z.coerce.number().nullable().catch(null).optional(),
  snippet: z.string().nullable().optional(),
  comment_id: z.string().nullable().optional(),
  post_id: z.string().nullable().optional(),
  tag_id: z.string().nullable().optional(),
  home_label: z.string().nullable().optional(),
  home_code: z.string().nullable().optional(),
  // migration 0063
  post_comment_id: z.string().nullable().optional(),
  post_author_username: z.string().nullable().optional(),
  source: z.enum(["comment", "post", "post_comment"]).nullable().catch(null).optional(),
});

/** `my_activity()` rows -> items. A row of a kind this app does not know (a
 * newer server) or with a bad date is dropped, never thrown on. */
export function parseActivityRows(data: unknown): ActivityItem[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const items: ActivityItem[] = [];
  for (const row of data) {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) {
      continue;
    }
    const r = parsed.data;
    const createdAt = Date.parse(r.created_at);
    if (Number.isNaN(createdAt)) {
      continue;
    }
    items.push({
      id: r.item_id,
      kind: r.kind,
      createdAt,
      read: Boolean(r.read_at),
      actor: r.actor_id
        ? {
            userId: r.actor_id,
            username: r.actor_username ?? null,
            displayName: r.actor_name ?? null,
            avatarPath: r.actor_avatar ?? null,
          }
        : null,
      count: Math.max(r.item_count ?? 1, 1),
      role: r.role ?? null,
      orgName: r.org_name ?? null,
      target: r.target ?? null,
      action: r.action ?? null,
      reason: r.reason ?? null,
      appealed: r.appealed ?? false,
      hubId: r.hub_id ?? null,
      place: r.place ?? null,
      magnitude: r.magnitude ?? null,
      snippet: r.snippet ?? null,
      commentId: r.comment_id ?? null,
      postId: r.post_id ?? null,
      tagId: r.tag_id ?? null,
      homeLabel: r.home_label ?? null,
      homeCode: r.home_code ?? null,
      postCommentId: r.post_comment_id ?? null,
      postAuthorUsername: r.post_author_username ?? null,
      source: r.source ?? null,
    });
  }
  return items;
}

async function call(name: string, args?: Record<string, unknown>): Promise<unknown> {
  const client = getSupabaseClient();
  if (!client) {
    throw new CommunityError("unavailable", "Supabase is not configured");
  }
  const { data, error } = await client.rpc(name, args);
  if (error) {
    throw toCommunityError(error);
  }
  return data;
}

export const SupabaseActivityTransport: ActivityTransport = {
  async fetchActivity(before) {
    return parseActivityRows(
      await call("my_activity", {
        p_limit: ACTIVITY_PAGE,
        p_before: before ? new Date(before).toISOString() : null,
      }),
    );
  },

  async fetchUnread() {
    const n = Number(await call("my_activity_unread"));
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 99) : 0;
  },

  async markRead(ids) {
    await call("mark_activity_read", ids ? { p_ids: ids } : {});
  },

  async requestReview(itemId, message) {
    const text = message.trim();
    try {
      await call("request_content_review", {
        p_item: itemId,
        ...(text ? { p_message: text } : {}),
      });
    } catch (error) {
      // Asked before (another device, a retry after a lost answer): done.
      if (
        error instanceof CommunityError &&
        error.message.includes("already_requested")
      ) {
        return;
      }
      throw error;
    }
  },
};
