import { z } from "zod";

import { toCommunityError } from "@/features/community/transport";
import { CommunityError } from "@/features/community/types";
import { HUB_ROLE_KINDS, type HubRole } from "@/features/eventhub/types";
import { cleanNote, type ReportReason } from "@/features/reporting/reasons";
import { getSupabaseClient } from "@/lib/supabase";
import type {
  DeletedBy,
  PostComment,
  PostCommentQueueRow,
  PostCommentStatus,
} from "./types";

/**
 * Comments on profile posts (migration 0063). Every read and write goes
 * through a SECURITY DEFINER function that applies the post's read rule, the
 * blocks, suspensions, the word filter and the limits; the table itself is
 * closed to the app. Screens never call Supabase directly; tests inject a
 * fake.
 */
export interface PostCommentsTransport {
  /** The comments of one post the viewer may see, newest first. Throws
   * `unavailable` before the migration is applied. */
  fetchComments(postId: string): Promise<PostComment[]>;
  /** `clientId` makes a retry safe: the same id never makes a second
   * comment. Resolves with the status the server gave it (pending = held). */
  addComment(input: {
    postId: string;
    body: string;
    parentId: string | null;
    clientId: string;
  }): Promise<{ id: string; status: "visible" | "pending" }>;
  /** My own comment, or anybody's on my own post. */
  deleteComment(commentId: string): Promise<DeletedBy>;
  /** The Undo of either delete (24 hours). */
  restoreComment(commentId: string): Promise<void>;
  /** The post's author switches comments off (or on again). */
  setCommentsOff(postId: string, off: boolean): Promise<void>;
  reportComment(
    commentId: string,
    reason: ReportReason,
    note?: string | null,
  ): Promise<void>;
  /** Moderators: approve (also closes the reports) or hide. */
  moderate(commentId: string, action: "approve" | "hide", reason?: string): Promise<void>;
  /** The official account: remove (an evidence copy is kept 90 days). */
  adminRemove(commentId: string, reason: string): Promise<void>;
  /** Brings back a hidden (moderators) or removed (official) comment. */
  adminRestore(commentId: string): Promise<void>;
  /** Held and reported comments, for the admin screen. */
  fetchQueue(): Promise<PostCommentQueueRow[]>;
}

const roleSchema = z.object({
  role: z.string(),
  org_name: z.string().nullable().optional(),
});

const rowSchema = z.object({
  comment_id: z.string(),
  post_id: z.string(),
  parent_id: z.string().nullable(),
  user_id: z.string().nullable(),
  username: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  avatar_path: z.string().nullable().optional(),
  roles: z.array(z.unknown()).nullable().catch([]).optional(),
  body: z.string(),
  status: z.enum(["visible", "pending", "removed"]),
  created_at: z.string(),
});

function parseRoles(value: unknown[] | null | undefined): HubRole[] {
  const roles: HubRole[] = [];
  for (const raw of value ?? []) {
    const parsed = roleSchema.safeParse(raw);
    const kind = parsed.success
      ? HUB_ROLE_KINDS.find((candidate) => candidate === parsed.data.role)
      : undefined;
    if (parsed.success && kind) {
      roles.push({ role: kind, orgName: parsed.data.org_name ?? null });
    }
  }
  return roles;
}

/** Rows that fail the contract are dropped, never thrown on. */
export function parsePostComments(data: unknown): PostComment[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const comments: PostComment[] = [];
  for (const row of data) {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) {
      continue;
    }
    const createdAt = Date.parse(parsed.data.created_at);
    if (Number.isNaN(createdAt)) {
      continue;
    }
    const r = parsed.data;
    comments.push({
      id: r.comment_id,
      postId: r.post_id,
      parentId: r.parent_id,
      userId: r.user_id,
      username: r.username ?? null,
      displayName: r.display_name ?? null,
      avatarPath: r.avatar_path ?? null,
      roles: parseRoles(r.roles),
      body: r.body,
      status: r.status satisfies PostCommentStatus,
      createdAt,
    });
  }
  return comments;
}

const queueSchema = z.object({
  comment_id: z.string(),
  post_id: z.string(),
  post_author_username: z.string().nullable().optional(),
  author_id: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  body: z.string(),
  status: z.enum(["pending", "visible"]),
  report_count: z.coerce.number().int().nonnegative().catch(0),
  last_reason: z.string().nullable().optional(),
  last_note: z.string().nullable().optional(),
  created_at: z.string(),
});

export function parsePostCommentQueue(data: unknown): PostCommentQueueRow[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const rows: PostCommentQueueRow[] = [];
  for (const row of data) {
    const parsed = queueSchema.safeParse(row);
    const createdAt = parsed.success ? Date.parse(parsed.data.created_at) : NaN;
    if (!parsed.success || Number.isNaN(createdAt)) {
      continue;
    }
    const d = parsed.data;
    rows.push({
      commentId: d.comment_id,
      postId: d.post_id,
      postAuthorUsername: d.post_author_username ?? null,
      authorId: d.author_id ?? null,
      username: d.username ?? null,
      displayName: d.display_name ?? null,
      body: d.body,
      status: d.status,
      reportCount: d.report_count,
      lastReason: d.last_reason ?? null,
      lastNote: d.last_note ?? null,
      createdAt,
    });
  }
  return rows;
}

const addSchema = z.object({
  comment_id: z.string(),
  status: z.enum(["visible", "pending"]).catch("visible"),
});

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
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

export const SupabasePostCommentsTransport: PostCommentsTransport = {
  async fetchComments(postId) {
    return parsePostComments(await rpc("post_comments_page", { p_post_id: postId }));
  },

  async addComment({ postId, body, parentId, clientId }) {
    const data = await rpc("add_post_comment", {
      p_post_id: postId,
      p_body: body.trim(),
      p_parent_id: parentId,
      p_comment_id: clientId,
    });
    const parsed = addSchema.safeParse(data);
    return parsed.success
      ? { id: parsed.data.comment_id, status: parsed.data.status }
      : { id: clientId, status: "visible" };
  },

  async deleteComment(commentId) {
    const data = await rpc("delete_post_comment", { p_comment_id: commentId });
    return data === "owner" ? "owner" : "author";
  },

  async restoreComment(commentId) {
    await rpc("restore_post_comment", { p_comment_id: commentId });
  },

  async setCommentsOff(postId, off) {
    await rpc("set_post_comments_off", { p_post_id: postId, p_off: off });
  },

  async reportComment(commentId, reason, note) {
    const cleaned = cleanNote(note);
    await rpc("report_post_comment", {
      p_comment_id: commentId,
      p_reason: reason,
      ...(cleaned ? { p_note: cleaned } : {}),
    });
  },

  async moderate(commentId, action, reason) {
    await rpc("moderate_post_comment", {
      p_comment_id: commentId,
      p_action: action,
      p_reason: reason ?? null,
    });
  },

  async adminRemove(commentId, reason) {
    await rpc("admin_remove_post_comment", { p_comment_id: commentId, p_reason: reason });
  },

  async adminRestore(commentId) {
    await rpc("admin_restore_post_comment", { p_comment_id: commentId, p_note: null });
  },

  async fetchQueue() {
    return parsePostCommentQueue(await rpc("post_comment_queue", { p_limit: 100 }));
  },
};
