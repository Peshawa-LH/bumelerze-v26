import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { HUB_ROLE_KINDS, type HubRole } from "@/features/eventhub/types";
import { getSupabaseClient } from "@/lib/supabase";
import type { ProfileReportReason } from "./constants";
import {
  CommunityError,
  type FollowRequest,
  type FollowStatus,
  type Person,
  type ProfileComment,
  type PublicProfile,
} from "./types";

/**
 * Community data access (migrations 0045 and 0047). Screens never call
 * Supabase directly; tests inject a fake `CommunityTransport`.
 * Every read goes through a SECURITY DEFINER function that returns public-safe
 * fields only — this file additionally keeps only the fields it knows, so a
 * private column could never reach the UI even if a server function leaked it.
 */
export interface CommunityTransport {
  /** Null when no such account (or it blocked the viewer). Throws
   * `unavailable` before the migration is applied. */
  fetchPublicProfile(username: string): Promise<PublicProfile | null>;
  fetchFollowList(username: string, kind: "followers" | "following"): Promise<Person[]>;
  fetchFollowRequests(): Promise<FollowRequest[]>;
  fetchBlocks(): Promise<Person[]>;
  /** `pending` when the account is private, else `accepted`. */
  follow(userId: string): Promise<Exclude<FollowStatus, "none">>;
  unfollow(userId: string): Promise<void>;
  /** Gives an unfollow back within 60 seconds (`undo_unfollow_user`, 0053);
   * returns the follow status in force afterwards. */
  undoUnfollow(userId: string): Promise<Exclude<FollowStatus, "none">>;
  acceptRequest(userId: string): Promise<void>;
  declineRequest(userId: string): Promise<void>;
  /** Puts a declined follow request back within 60 seconds
   * (`undo_decline_follow_request`, 0053). */
  undoDecline(userId: string): Promise<void>;
  block(userId: string): Promise<void>;
  unblock(userId: string): Promise<void>;
  reportProfile(userId: string, reason: ProfileReportReason): Promise<void>;
  /** `username_available()`; true when the name is free for the caller. */
  isUsernameAvailable(username: string): Promise<boolean>;
}

const roleSchema = z.object({
  role: z.string(),
  org_name: z.string().nullable().optional(),
});

function parseRoles(value: unknown): HubRole[] {
  const parsed = z.array(roleSchema).safeParse(value);
  if (!parsed.success) {
    return [];
  }
  const roles: HubRole[] = [];
  for (const row of parsed.data) {
    const kind = HUB_ROLE_KINDS.find((candidate) => candidate === row.role);
    if (kind) {
      roles.push({ role: kind, orgName: row.org_name ?? null });
    }
  }
  return roles;
}

const count = z.coerce.number().int().nonnegative().catch(0);

const commentSchema = z.object({
  comment_id: z.string(),
  body: z.string(),
  created_at: z.string(),
  helpful_count: count,
  hub_id: z.string().nullable().optional(),
  place: z.string().nullable().optional(),
  magnitude: z.coerce.number().nullable().optional(),
});

const profileSchema = z.object({
  user_id: z.string(),
  username: z.string(),
  display_name: z.string(),
  avatar_path: z.string().nullable().optional(),
  is_private: z.boolean().catch(false),
  roles: z.unknown().optional(),
  is_self: z.boolean().catch(false),
  follow_status: z.enum(["none", "pending", "accepted"]).catch("none"),
  is_blocked: z.boolean().catch(false),
  can_view_full: z.boolean().catch(false),
  member_since: z.string().nullable().optional(),
  followers: count.optional(),
  following: count.optional(),
  comments: count.optional(),
  helpful_received: count.optional(),
  posts_count: count.optional(),
  badges_hidden: z.boolean().optional(),
  milestones: z
    .object({
      reports: count,
      detailed_reports: count,
      photo_reports: count,
    })
    .nullable()
    .optional(),
  recent_comments: z.unknown().optional(),
});

function parseComments(value: unknown): ProfileComment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const comments: ProfileComment[] = [];
  for (const row of value) {
    const parsed = commentSchema.safeParse(row);
    if (!parsed.success) {
      continue;
    }
    const createdAt = Date.parse(parsed.data.created_at);
    if (Number.isNaN(createdAt)) {
      continue;
    }
    comments.push({
      id: parsed.data.comment_id,
      body: parsed.data.body,
      createdAt,
      helpfulCount: parsed.data.helpful_count,
      hubId: parsed.data.hub_id ?? null,
      place: parsed.data.place ?? null,
      magnitude: parsed.data.magnitude ?? null,
    });
  }
  return comments;
}

/**
 * `public_profile()` jsonb -> `PublicProfile`. Anything not listed in the
 * schema is dropped on purpose (a stray `email` or `profession` key never
 * survives), and a viewer without full access gets `details: null` even if
 * the payload carried some.
 */
export function parsePublicProfile(data: unknown): PublicProfile | null {
  const parsed = profileSchema.safeParse(data);
  if (!parsed.success) {
    return null;
  }
  const p = parsed.data;
  const since = p.member_since ? Date.parse(p.member_since) : NaN;
  const details =
    p.can_view_full && !p.is_blocked
      ? {
          memberSince: Number.isNaN(since) ? null : since,
          followers: p.followers ?? 0,
          following: p.following ?? 0,
          comments: p.comments ?? 0,
          helpfulReceived: p.helpful_received ?? 0,
          postsCount: p.posts_count ?? 0,
          badgesHidden: p.badges_hidden ?? false,
          milestones:
            p.badges_hidden || !p.milestones
              ? null
              : {
                  reports: p.milestones.reports,
                  detailedReports: p.milestones.detailed_reports,
                  photoReports: p.milestones.photo_reports,
                },
          recentComments: parseComments(p.recent_comments),
        }
      : null;
  return {
    userId: p.user_id,
    username: p.username,
    displayName: p.display_name,
    avatarPath: p.avatar_path ?? null,
    isPrivate: p.is_private,
    roles: parseRoles(p.roles),
    isSelf: p.is_self,
    followStatus: p.follow_status,
    isBlocked: p.is_blocked,
    canViewFull: p.can_view_full && !p.is_blocked,
    details,
  };
}

const personSchema = z.object({
  person_id: z.string(),
  username: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  avatar_path: z.string().nullable().optional(),
  roles: z.unknown().optional(),
  requested_at: z.string().optional(),
});

export function parsePersonRows(data: unknown): Person[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const people: Person[] = [];
  for (const row of data) {
    const parsed = personSchema.safeParse(row);
    if (!parsed.success) {
      continue;
    }
    people.push({
      userId: parsed.data.person_id,
      username: parsed.data.username ?? null,
      displayName: parsed.data.display_name ?? "",
      avatarPath: parsed.data.avatar_path ?? null,
      roles: parseRoles(parsed.data.roles),
    });
  }
  return people;
}

export function parseFollowRequests(data: unknown): FollowRequest[] {
  const people = parsePersonRows(data);
  const rows = Array.isArray(data) ? (data as { requested_at?: string }[]) : [];
  return people.map((person, index) => {
    const at = Date.parse(rows[index]?.requested_at ?? "");
    return { ...person, requestedAt: Number.isNaN(at) ? 0 : at };
  });
}

interface ErrorLike {
  code?: string;
  message?: string;
  status?: number;
  name?: string;
}

/** Maps a PostgREST / auth / fetch failure to a `CommunityError`. The SQL
 * functions put a short token in their message (not_account, blocked, ...). */
export function toCommunityError(error: unknown): CommunityError {
  if (error instanceof CommunityError) {
    return error;
  }
  const e: ErrorLike =
    typeof error === "object" && error !== null ? (error as ErrorLike) : {};
  const message = e.message ?? "";
  // PGRST202 / 42883: the function does not exist yet (migration not applied);
  // PGRST205 / 42P01: the same for a table (profile posts, migration 0050).
  if (
    e.code === "PGRST202" ||
    e.code === "42883" ||
    e.code === "PGRST205" ||
    e.code === "42P01" ||
    e.status === 404
  ) {
    return new CommunityError("unavailable", message);
  }
  // The SQL says "restore_my_comment: expired"; a bare "JWT expired" is not it.
  if (/:\s*expired\b/.test(message)) {
    return new CommunityError("expired", message);
  }
  for (const token of [
    "not_account",
    "profile_required",
    "blocked",
    "not_found",
    "rate_limited",
    "not_restorable",
  ] as const) {
    if (message.includes(token)) {
      return new CommunityError(token, message);
    }
  }
  if (e.code === "P0002") {
    return new CommunityError("not_found", message);
  }
  if (e.code === "42501") {
    return new CommunityError("forbidden", message);
  }
  if (e.code === "54000" || e.status === 429) {
    return new CommunityError("rate_limited", message);
  }
  if (
    e.name === "AuthRetryableFetchError" ||
    e.status === 0 ||
    /network|failed to fetch|fetch failed|timed out/i.test(message)
  ) {
    return new CommunityError("network", message);
  }
  return new CommunityError("unknown", message);
}

function requireClient(): SupabaseClient {
  const client = getSupabaseClient();
  if (!client) {
    throw new CommunityError("unavailable", "Supabase is not configured");
  }
  return client;
}

async function call(name: string, args?: Record<string, unknown>): Promise<unknown> {
  const client = requireClient();
  const { data, error } = await client.rpc(name, args);
  if (error) {
    throw toCommunityError(error);
  }
  return data;
}

export const SupabaseCommunityTransport: CommunityTransport = {
  async fetchPublicProfile(username) {
    return parsePublicProfile(await call("public_profile", { p_username: username }));
  },

  async fetchFollowList(username, kind) {
    return parsePersonRows(
      await call("follow_list", { p_username: username, p_kind: kind }),
    );
  },

  async fetchFollowRequests() {
    return parseFollowRequests(await call("my_follow_requests"));
  },

  async fetchBlocks() {
    return parsePersonRows(await call("my_blocks"));
  },

  async follow(userId) {
    const status = await call("follow_user", { p_followee: userId });
    return status === "pending" ? "pending" : "accepted";
  },

  async unfollow(userId) {
    await call("unfollow_user", { p_followee: userId });
  },

  async undoUnfollow(userId) {
    const status = await call("undo_unfollow_user", { p_followee: userId });
    return status === "pending" ? "pending" : "accepted";
  },

  async acceptRequest(userId) {
    await call("accept_follow_request", { p_follower: userId });
  },

  async declineRequest(userId) {
    await call("decline_follow_request", { p_follower: userId });
  },

  async undoDecline(userId) {
    await call("undo_decline_follow_request", { p_follower: userId });
  },

  async block(userId) {
    await call("block_user", { p_user: userId });
  },

  async unblock(userId) {
    await call("unblock_user", { p_user: userId });
  },

  async reportProfile(userId, reason) {
    await call("report_profile", { p_user: userId, p_reason: reason });
  },

  async isUsernameAvailable(username) {
    return (await call("username_available", { p_username: username })) === true;
  },
};
