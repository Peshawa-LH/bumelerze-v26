import { z } from "zod";

import { toCommunityError } from "@/features/community/transport";
import { CommunityError } from "@/features/community/types";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * Migration 0065: the hearts on the Event hub and on comments under posts,
 * the two carousel aggregates (felt shaking by town, reports over time) and
 * the profile header (counts, "Followed by"). Every call is a SECURITY
 * DEFINER function that applies its own rules; screens never call Supabase
 * directly and tests inject a fake.
 */
export interface LikeState {
  count: number;
  liked: boolean;
}

/** One town of "Felt shaking by town": the app's gazetteer id, the number of
 * live reports and the typical level (null below 3 reports). */
export interface FeltTown {
  townId: string;
  reports: number;
  level: number | null;
}

/** "Reports over time": the first 24 hours after the origin time. */
export interface FeltTimeline {
  total: number;
  firstDay: number;
  firstHour: number;
  /** Minutes from the origin to the first report, or null when none came in
   * the first day. */
  minutesToFirst: number | null;
  /** 24 hourly counts, hour 0 first. */
  hours: number[];
}

export interface ProfileHeaderInfo {
  posts: number;
  followers: number;
  following: number;
  /** Up to two people the viewer follows who follow this person. */
  followedBy: { username: string; displayName: string }[];
  followedByTotal: number;
}

export interface SocialTransport {
  fetchHubLikes(eventUuid: string): Promise<LikeState>;
  setHubLike(eventUuid: string, like: boolean): Promise<LikeState>;
  fetchFeltTowns(eventUuid: string): Promise<FeltTown[]>;
  fetchFeltTimeline(eventUuid: string): Promise<FeltTimeline | null>;
  /** Comment id to its hearts, for the comments of one post (only those that
   * have any). */
  fetchPostCommentLikes(postId: string): Promise<Record<string, LikeState>>;
  setPostCommentLike(commentId: string, like: boolean): Promise<LikeState>;
  fetchProfileHeader(username: string): Promise<ProfileHeaderInfo | null>;
}

const likeSchema = z.object({
  count: z.coerce.number().int().nonnegative().catch(0),
  liked: z.boolean().catch(false),
});

export function parseLikeState(data: unknown): LikeState {
  const parsed = likeSchema.safeParse(data);
  return parsed.success ? parsed.data : { count: 0, liked: false };
}

const townSchema = z.object({
  town_id: z.string(),
  reports: z.coerce.number().int().nonnegative(),
  level: z.coerce.number().int().min(1).max(12).nullable().optional(),
});

/** Rows that fail the contract are dropped, never thrown on. */
export function parseFeltTowns(data: unknown): FeltTown[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const towns: FeltTown[] = [];
  for (const row of data) {
    const parsed = townSchema.safeParse(row);
    if (parsed.success && parsed.data.reports > 0) {
      towns.push({
        townId: parsed.data.town_id,
        reports: parsed.data.reports,
        level: parsed.data.level ?? null,
      });
    }
  }
  return towns;
}

const timelineSchema = z.object({
  total: z.coerce.number().int().nonnegative(),
  first_day: z.coerce.number().int().nonnegative(),
  first_hour: z.coerce.number().int().nonnegative(),
  minutes_to_first: z.coerce.number().int().nonnegative().nullable().optional(),
  hours: z.array(z.coerce.number().int().nonnegative()),
});

export function parseFeltTimeline(data: unknown): FeltTimeline | null {
  const parsed = timelineSchema.safeParse(data);
  if (!parsed.success) {
    return null;
  }
  const hours = Array.from({ length: 24 }, (_, i) => parsed.data.hours[i] ?? 0);
  return {
    total: parsed.data.total,
    firstDay: parsed.data.first_day,
    firstHour: parsed.data.first_hour,
    minutesToFirst: parsed.data.minutes_to_first ?? null,
    hours,
  };
}

const commentLikeSchema = z.object({
  comment_id: z.string(),
  likes: z.coerce.number().int().nonnegative(),
  liked: z.boolean().catch(false),
});

export function parsePostCommentLikes(data: unknown): Record<string, LikeState> {
  const out: Record<string, LikeState> = {};
  if (!Array.isArray(data)) {
    return out;
  }
  for (const row of data) {
    const parsed = commentLikeSchema.safeParse(row);
    if (parsed.success) {
      out[parsed.data.comment_id] = {
        count: parsed.data.likes,
        liked: parsed.data.liked,
      };
    }
  }
  return out;
}

const headerSchema = z.object({
  posts: z.coerce.number().int().nonnegative().catch(0),
  followers: z.coerce.number().int().nonnegative().catch(0),
  following: z.coerce.number().int().nonnegative().catch(0),
  followed_by: z
    .array(
      z.object({
        username: z.string(),
        display_name: z.string().nullable().optional(),
      }),
    )
    .catch([]),
  followed_by_total: z.coerce.number().int().nonnegative().catch(0),
});

export function parseProfileHeader(data: unknown): ProfileHeaderInfo | null {
  const parsed = headerSchema.safeParse(data);
  if (!parsed.success) {
    return null;
  }
  return {
    posts: parsed.data.posts,
    followers: parsed.data.followers,
    following: parsed.data.following,
    followedBy: parsed.data.followed_by.map((person) => ({
      username: person.username,
      displayName: person.display_name ?? person.username,
    })),
    followedByTotal: parsed.data.followed_by_total,
  };
}

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

export const SupabaseSocialTransport: SocialTransport = {
  async fetchHubLikes(eventUuid) {
    return parseLikeState(await rpc("event_hub_likes", { p_event_id: eventUuid }));
  },
  async setHubLike(eventUuid, like) {
    return parseLikeState(
      await rpc("set_hub_like", { p_event_id: eventUuid, p_like: like }),
    );
  },
  async fetchFeltTowns(eventUuid) {
    return parseFeltTowns(await rpc("event_felt_towns", { p_event_id: eventUuid }));
  },
  async fetchFeltTimeline(eventUuid) {
    return parseFeltTimeline(await rpc("event_felt_timeline", { p_event_id: eventUuid }));
  },
  async fetchPostCommentLikes(postId) {
    return parsePostCommentLikes(
      await rpc("post_comment_likes_of", { p_post_id: postId }),
    );
  },
  async setPostCommentLike(commentId, like) {
    return parseLikeState(
      await rpc("set_post_comment_like", { p_comment_id: commentId, p_like: like }),
    );
  },
  async fetchProfileHeader(username) {
    return parseProfileHeader(await rpc("profile_header", { p_username: username }));
  },
};
