import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getSupabaseClient, signInAnonymously } from "@/lib/supabase";
import {
  HUB_ROLE_KINDS,
  HubError,
  type FlagReason,
  type HubAuthor,
  type HubComment,
  type HubRole,
  type HubSummary,
  type ModerationAction,
} from "./types";

/**
 * Event hub data access (migration 0036). Screens and hooks never call
 * Supabase directly; they go through this seam, and tests inject a fake
 * `EventHubTransport` (or mock `@/lib/supabase` for the real one).
 */
export interface EventHubTransport {
  fetchSummary(eventUuid: string): Promise<HubSummary | null>;
  fetchComments(eventUuid: string): Promise<HubComment[]>;
  fetchAuthors(userIds: readonly string[]): Promise<Record<string, HubAuthor>>;
  fetchRoles(userIds: readonly string[]): Promise<Record<string, HubRole[]>>;
  /** Ids (among `commentIds`) the signed-in account marked helpful. */
  fetchMyHelpful(commentIds: readonly string[]): Promise<string[]>;
  postComment(input: {
    eventUuid: string;
    parentId: string | null;
    body: string;
  }): Promise<void>;
  setHelpful(commentId: string, helpful: boolean): Promise<void>;
  flagComment(commentId: string, reason: FlagReason): Promise<void>;
  deleteComment(commentId: string): Promise<void>;
  moderateComment(
    commentId: string,
    action: ModerationAction,
    reason?: string,
  ): Promise<void>;
}

/** Newest comments read per event. Replies to older threads beyond this are
 * not loaded; an event with this much talk is a later pagination problem. */
export const HUB_COMMENT_LIMIT = 300;

/** Ids per `.in()` filter, so a long list never overflows the URL length. */
const ID_CHUNK = 60;

export const COMMENT_COLUMNS = [
  "comment_id",
  "event_id",
  "parent_id",
  "user_id",
  "body",
  "area_geohash",
  "status",
  "helpful_count",
  "reply_count",
  "created_at",
] as const;

const commentRowSchema = z.object({
  comment_id: z.string(),
  event_id: z.string(),
  parent_id: z.string().nullable(),
  user_id: z.string().nullable(),
  body: z.string(),
  area_geohash: z.string().nullable(),
  status: z.enum(["visible", "pending", "hidden"]),
  helpful_count: z.number().int().nonnegative(),
  reply_count: z.number().int().nonnegative(),
  created_at: z.string(),
});

/** Rows that fail the contract are dropped, never thrown on: one odd row
 * must not blank a whole conversation. */
export function parseCommentRows(rows: unknown): HubComment[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  const comments: HubComment[] = [];
  for (const row of rows) {
    const parsed = commentRowSchema.safeParse(row);
    if (!parsed.success) {
      continue;
    }
    const createdAt = Date.parse(parsed.data.created_at);
    if (Number.isNaN(createdAt)) {
      continue;
    }
    comments.push({
      id: parsed.data.comment_id,
      eventId: parsed.data.event_id,
      parentId: parsed.data.parent_id,
      userId: parsed.data.user_id,
      body: parsed.data.body,
      areaGeohash: parsed.data.area_geohash,
      status: parsed.data.status,
      helpfulCount: parsed.data.helpful_count,
      replyCount: parsed.data.reply_count,
      createdAt,
    });
  }
  return comments;
}

const summarySchema = z.object({
  reports: z.coerce.number(),
  people: z.coerce.number(),
  levels: z.record(z.coerce.number()).nullable().optional(),
  first_report_at: z.string().nullable().optional(),
  comments: z.coerce.number(),
});

/** `event_hub_summary` jsonb -> `HubSummary`; null when it is not that shape. */
export function parseSummary(data: unknown): HubSummary | null {
  const parsed = summarySchema.safeParse(data);
  if (!parsed.success) {
    return null;
  }
  const levels: Record<number, number> = {};
  for (const [key, count] of Object.entries(parsed.data.levels ?? {})) {
    const level = Number(key);
    if (Number.isInteger(level) && level >= 1 && level <= 12 && count > 0) {
      levels[level] = count;
    }
  }
  const first = parsed.data.first_report_at ? Date.parse(parsed.data.first_report_at) : NaN;
  return {
    reports: parsed.data.reports,
    people: parsed.data.people,
    levels,
    firstReportAt: Number.isNaN(first) ? null : first,
    comments: parsed.data.comments,
  };
}

interface ErrorLike {
  code?: string;
  message?: string;
  status?: number;
  name?: string;
}

/** Maps a PostgREST / auth / fetch failure to a `HubError` the UI can word. */
export function toHubError(error: unknown): HubError {
  if (error instanceof HubError) {
    return error;
  }
  const e: ErrorLike = typeof error === "object" && error !== null ? (error as ErrorLike) : {};
  const message = e.message ?? "";
  // 54000 is the trigger's "too many comments" (10 per 10 minutes).
  if (e.code === "54000" || e.status === 429) {
    return new HubError("rate_limited", message);
  }
  if (
    e.name === "AuthRetryableFetchError" ||
    e.status === 0 ||
    /network|failed to fetch|fetch failed|timed out/i.test(message)
  ) {
    return new HubError("network", message);
  }
  return new HubError("unknown", message);
}

function requireClient(): SupabaseClient {
  const client = getSupabaseClient();
  if (!client) {
    throw new HubError("unknown", "Supabase is not configured");
  }
  return client;
}

/** The signed-in user's id, signing in anonymously first when this install
 * has no session yet (comments and flags are open to anonymous sessions). */
async function requireUserId(client: SupabaseClient): Promise<string> {
  try {
    await signInAnonymously();
  } catch (error) {
    throw toHubError(error);
  }
  const { data } = await client.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) {
    throw new HubError("not_signed_in");
  }
  return userId;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

interface ProfileRow {
  user_id: string;
  display_name: string;
  avatar_path: string | null;
}
interface RoleRow {
  user_id: string;
  role: string;
  org_name: string | null;
}
interface ReactionRow {
  comment_id: string;
}

export const SupabaseEventHubTransport: EventHubTransport = {
  async fetchSummary(eventUuid) {
    const client = getSupabaseClient();
    if (!client) {
      return null;
    }
    const { data, error } = await client.rpc("event_hub_summary", {
      p_event_id: eventUuid,
    });
    if (error) {
      throw toHubError(error);
    }
    return parseSummary(data);
  },

  async fetchComments(eventUuid) {
    const client = getSupabaseClient();
    if (!client) {
      return [];
    }
    const { data, error } = await client
      .from("event_comments")
      .select(COMMENT_COLUMNS.join(", "))
      .eq("event_id", eventUuid)
      .order("created_at", { ascending: false })
      .limit(HUB_COMMENT_LIMIT);
    if (error) {
      throw toHubError(error);
    }
    return parseCommentRows(data);
  },

  async fetchAuthors(userIds) {
    const client = getSupabaseClient();
    const authors: Record<string, HubAuthor> = {};
    if (!client || userIds.length === 0) {
      return authors;
    }
    for (const ids of chunk(userIds, ID_CHUNK)) {
      const { data, error } = await client
        .from("profiles")
        .select("user_id, display_name, avatar_path")
        .in("user_id", ids);
      if (error) {
        throw toHubError(error);
      }
      for (const row of (data ?? []) as unknown as ProfileRow[]) {
        authors[row.user_id] = {
          userId: row.user_id,
          displayName: row.display_name,
          avatarPath: row.avatar_path,
        };
      }
    }
    return authors;
  },

  async fetchRoles(userIds) {
    const client = getSupabaseClient();
    const roles: Record<string, HubRole[]> = {};
    if (!client || userIds.length === 0) {
      return roles;
    }
    for (const ids of chunk(userIds, ID_CHUNK)) {
      const { data, error } = await client
        .from("user_roles")
        .select("user_id, role, org_name")
        .in("user_id", ids);
      if (error) {
        throw toHubError(error);
      }
      for (const row of (data ?? []) as unknown as RoleRow[]) {
        const kind = HUB_ROLE_KINDS.find((candidate) => candidate === row.role);
        if (!kind) {
          continue;
        }
        (roles[row.user_id] ??= []).push({ role: kind, orgName: row.org_name });
      }
    }
    return roles;
  },

  async fetchMyHelpful(commentIds) {
    const client = getSupabaseClient();
    if (!client || commentIds.length === 0) {
      return [];
    }
    const helped: string[] = [];
    for (const ids of chunk(commentIds, ID_CHUNK)) {
      // RLS returns only the caller's own marks.
      const { data, error } = await client
        .from("comment_reactions")
        .select("comment_id")
        .eq("kind", "helpful")
        .in("comment_id", ids);
      if (error) {
        throw toHubError(error);
      }
      for (const row of (data ?? []) as unknown as ReactionRow[]) {
        helped.push(row.comment_id);
      }
    }
    return helped;
  },

  async postComment({ eventUuid, parentId, body }) {
    const client = requireClient();
    const userId = await requireUserId(client);
    // status, area, depth and pace are decided by the database trigger;
    // only these four columns are ours to send.
    const { error } = await client.from("event_comments").insert({
      event_id: eventUuid,
      parent_id: parentId,
      user_id: userId,
      body,
    });
    if (error) {
      throw toHubError(error);
    }
  },

  async setHelpful(commentId, helpful) {
    const client = requireClient();
    const userId = await requireUserId(client);
    if (helpful) {
      const { error } = await client
        .from("comment_reactions")
        .insert({ comment_id: commentId, user_id: userId, kind: "helpful" });
      // 23505: already marked (a double tap or a second device) is fine.
      if (error && error.code !== "23505") {
        throw toHubError(error);
      }
      return;
    }
    const { error } = await client
      .from("comment_reactions")
      .delete()
      .eq("comment_id", commentId)
      .eq("user_id", userId)
      .eq("kind", "helpful");
    if (error) {
      throw toHubError(error);
    }
  },

  async flagComment(commentId, reason) {
    const client = requireClient();
    const userId = await requireUserId(client);
    const { error } = await client
      .from("comment_flags")
      .insert({ comment_id: commentId, user_id: userId, reason });
    // 23505: this reader already reported it.
    if (error && error.code !== "23505") {
      throw toHubError(error);
    }
  },

  async deleteComment(commentId) {
    const client = requireClient();
    const { error } = await client.rpc("delete_my_comment", { p_comment_id: commentId });
    if (error) {
      throw toHubError(error);
    }
  },

  async moderateComment(commentId, action, reason) {
    const client = requireClient();
    const { error } = await client.rpc("moderate_comment", {
      p_comment_id: commentId,
      p_action: action,
      p_reason: reason ?? null,
    });
    if (error) {
      throw toHubError(error);
    }
  },
};
