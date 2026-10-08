import { z } from "zod";

import { toCommunityError } from "@/features/community/transport";
import { CommunityError } from "@/features/community/types";
import { getSupabaseClient } from "@/lib/supabase";
import type {
  AdminRestriction,
  MyRestriction,
  RestrictInput,
  RestrictionLevel,
} from "./types";

/**
 * Account limits: data access (migration 0054). Screens never call Supabase
 * directly; tests inject a fake `RestrictionsTransport`.
 */
export interface RestrictionsTransport {
  /** The limit the signed-in identity is under now, or null (`my_restriction`). */
  fetchMine(): Promise<MyRestriction | null>;
  /** "Ask for review" (`request_restriction_review`): once per restriction. */
  requestReview(restrictionId: string, message: string): Promise<void>;
  /** Warn, restrict or suspend (`admin_restrict_account`); returns the id the
   * Undo lifts. */
  restrict(input: RestrictInput): Promise<string>;
  /** Lifts a limit (`admin_lift_restriction`). Repeating it is harmless. */
  lift(restrictionId: string): Promise<void>;
  /** Limits in force plus the last 30 days (no user), or one person's history
   * (`admin_account_restrictions`). */
  fetchAdminList(userId?: string | null): Promise<AdminRestriction[]>;
}

const LEVELS = ["warning", "restrict", "suspend"] as const;

const mineSchema = z.object({
  restriction_id: z.string(),
  level: z.enum(LEVELS),
  reason: z.string(),
  starts_at: z.string(),
  ends_at: z.string().nullable().optional(),
  appeal_requested_at: z.string().nullable().optional(),
});

function ms(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** `my_restriction()` rows -> the one limit (the server returns at most one). */
export function parseMyRestriction(data: unknown): MyRestriction | null {
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  for (const row of rows) {
    const parsed = mineSchema.safeParse(row);
    const startsAt = parsed.success ? ms(parsed.data.starts_at) : null;
    if (!parsed.success || startsAt === null) {
      continue;
    }
    return {
      id: parsed.data.restriction_id,
      level: parsed.data.level,
      reason: parsed.data.reason,
      startsAt,
      endsAt: ms(parsed.data.ends_at),
      appealRequestedAt: ms(parsed.data.appeal_requested_at),
    };
  }
  return null;
}

const adminSchema = z.object({
  restriction_id: z.string(),
  user_id: z.string(),
  user_name: z.string().nullable().optional(),
  user_username: z.string().nullable().optional(),
  is_guest: z.boolean().catch(false),
  level: z.enum(LEVELS),
  reason: z.string(),
  note: z.string().nullable().optional(),
  starts_at: z.string(),
  ends_at: z.string().nullable().optional(),
  created_at: z.string(),
  created_by_name: z.string().nullable().optional(),
  lifted_at: z.string().nullable().optional(),
  lifted_by_name: z.string().nullable().optional(),
  appeal_requested_at: z.string().nullable().optional(),
  active: z.boolean().catch(false),
});

export function parseAdminRestrictions(data: unknown): AdminRestriction[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const rows: AdminRestriction[] = [];
  for (const row of data) {
    const parsed = adminSchema.safeParse(row);
    const startsAt = parsed.success ? ms(parsed.data.starts_at) : null;
    const createdAt = parsed.success ? ms(parsed.data.created_at) : null;
    if (!parsed.success || startsAt === null || createdAt === null) {
      continue;
    }
    const d = parsed.data;
    rows.push({
      id: d.restriction_id,
      userId: d.user_id,
      userName: d.user_name ?? null,
      userUsername: d.user_username ?? null,
      isGuest: d.is_guest,
      level: d.level as RestrictionLevel,
      reason: d.reason,
      note: d.note ?? null,
      startsAt,
      endsAt: ms(d.ends_at),
      createdAt,
      createdByName: d.created_by_name ?? null,
      liftedAt: ms(d.lifted_at),
      liftedByName: d.lifted_by_name ?? null,
      appealRequestedAt: ms(d.appeal_requested_at),
      active: d.active,
    });
  }
  return rows;
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

export const SupabaseRestrictionsTransport: RestrictionsTransport = {
  async fetchMine() {
    return parseMyRestriction(await call("my_restriction"));
  },
  async requestReview(restrictionId, message) {
    await call("request_restriction_review", {
      p_restriction_id: restrictionId,
      p_message: message === "" ? null : message,
    });
  },
  async restrict(input) {
    const id = await call("admin_restrict_account", {
      p_user_id: input.userId,
      p_level: input.level,
      p_reason: input.reason,
      p_note: input.note,
      p_ends_at: input.endsAt,
    });
    if (typeof id !== "string") {
      throw new CommunityError("unknown", "admin_restrict_account returned no id");
    }
    return id;
  },
  async lift(restrictionId) {
    await call("admin_lift_restriction", {
      p_restriction_id: restrictionId,
      p_note: null,
    });
  },
  async fetchAdminList(userId) {
    return parseAdminRestrictions(
      await call("admin_account_restrictions", {
        p_user_id: userId ?? null,
        p_limit: 100,
      }),
    );
  },
};
