import { z } from "zod";

import { toCommunityError } from "@/features/community/transport";
import { CommunityError } from "@/features/community/types";
import { HUB_ROLE_KINDS, type HubRoleKind } from "@/features/eventhub/types";
import { getSupabaseClient } from "@/lib/supabase";
import {
  PEOPLE_PAGE_SIZE,
  PEOPLE_PLATFORMS,
  type PeopleCursor,
  type PeopleFilters,
  type PeoplePage,
  type PeoplePlatform,
  type PeopleQuery,
  type PeopleStats,
  type PersonDetail,
  type PersonKind,
  type PersonNote,
  type PersonRow,
  type PersonStatus,
  type ResettableField,
} from "./types";

/**
 * People directory data access (migration 0055). Every function checks the
 * caller's permission on the server; the app only decides what to show.
 * Nothing here ever carries a coordinate, a raw device id, a push token or a
 * password hash: the server does not return them.
 */
export interface PeopleTransport {
  /** One page of the directory (`admin_people_search`). */
  search(query: PeopleQuery, cursor: PeopleCursor | null): Promise<PeoplePage>;
  /** The numbers header (`admin_people_stats`). */
  stats(): Promise<PeopleStats>;
  /** One person's page (`admin_person`); the server logs the open. */
  person(userId: string): Promise<PersonDetail>;
  /** The full email (`admin_reveal_email`); the server logs it. */
  revealEmail(userId: string): Promise<string | null>;
  /** Puts a copied name / photo back (`admin_reset_profile_fields`). Resolves
   * with the audit row id the Undo uses, or null when nothing needed resetting. */
  resetProfile(userId: string, fields: ResettableField[]): Promise<string | null>;
  notes(userId: string): Promise<PersonNote[]>;
  addNote(userId: string, body: string): Promise<void>;
}

function ms(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

const num = z.coerce.number().catch(0);
const str = z.string().nullable().optional();
const KINDS = ["account", "guest"] as const;
const STATUSES = ["active", "restricted", "suspended"] as const;

function platformOf(value: string | null | undefined): PeoplePlatform | null {
  return PEOPLE_PLATFORMS.find((p) => p === value) ?? null;
}
function ranksOf(value: unknown): HubRoleKind[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: HubRoleKind[] = [];
  for (const entry of value) {
    const role = HUB_ROLE_KINDS.find((kind) => kind === entry);
    if (role) {
      out.push(role);
    }
  }
  return out;
}
function statusOf(value: string | null | undefined): PersonStatus {
  return STATUSES.find((s) => s === value) ?? "active";
}

const rowSchema = z.object({
  user_id: z.string(),
  kind: z.enum(KINDS).catch("account"),
  username: str,
  display_name: str,
  avatar_path: str,
  ranks: z.unknown().optional(),
  status: z.string().nullable().optional(),
  joined: str,
  last_seen: str,
  platform: str,
  open_reports: num,
  masked_email: str,
  counts: z
    .object({
      felt_reports: num,
      comments: num,
      posts: num,
      homes_owned: num,
      homes_member: num,
      feedback: num,
    })
    .partial()
    .optional(),
});

export function parsePersonRow(raw: unknown): PersonRow | null {
  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const d = parsed.data;
  const c = d.counts ?? {};
  return {
    userId: d.user_id,
    kind: d.kind as PersonKind,
    username: d.username ?? null,
    displayName: d.display_name ?? null,
    avatarPath: d.avatar_path ?? null,
    ranks: ranksOf(d.ranks),
    status: statusOf(d.status),
    joined: ms(d.joined),
    lastSeen: ms(d.last_seen),
    platform: platformOf(d.platform),
    openReports: d.open_reports,
    maskedEmail: d.masked_email ?? null,
    counts: {
      feltReports: c.felt_reports ?? 0,
      comments: c.comments ?? 0,
      posts: c.posts ?? 0,
      homesOwned: c.homes_owned ?? 0,
      homesMember: c.homes_member ?? 0,
      feedback: c.feedback ?? 0,
    },
  };
}

const cursorSchema = z.object({ k: z.string(), id: z.string() });

export function parsePeoplePage(data: unknown): PeoplePage {
  const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const rows: PersonRow[] = [];
  if (Array.isArray(obj.rows)) {
    for (const raw of obj.rows) {
      const row = parsePersonRow(raw);
      if (row) {
        rows.push(row);
      }
    }
  }
  const cursor = cursorSchema.safeParse(obj.next_cursor);
  const idle = z.coerce.number().safeParse(obj.idle_guests);
  return {
    rows,
    nextCursor: cursor.success ? cursor.data : null,
    idleGuests: obj.idle_guests == null || !idle.success ? null : idle.data,
  };
}

const optNum = z.coerce.number().nullable().optional();
const statsSchema = z.object({
  accounts_total: num,
  guests_total: optNum,
  new_accounts_7d: num,
  new_accounts_30d: num,
  active_accounts_7d: num,
  active_accounts_30d: num,
  active_guests_7d: optNum,
  active_guests_30d: optNum,
  presence_since: str,
  restricted: num,
  suspended: num,
  platforms: z
    .object({ ios: num, android: num, web: num })
    .partial()
    .optional(),
});

export function parsePeopleStats(data: unknown): PeopleStats {
  const parsed = statsSchema.safeParse(data);
  if (!parsed.success) {
    throw new CommunityError("unknown", "bad stats");
  }
  const d = parsed.data;
  return {
    accountsTotal: d.accounts_total,
    guestsTotal: d.guests_total ?? null,
    newAccounts7d: d.new_accounts_7d,
    newAccounts30d: d.new_accounts_30d,
    activeAccounts7d: d.active_accounts_7d,
    activeAccounts30d: d.active_accounts_30d,
    activeGuests7d: d.active_guests_7d ?? null,
    activeGuests30d: d.active_guests_30d ?? null,
    presenceSince: ms(d.presence_since),
    restricted: d.restricted,
    suspended: d.suspended,
    platforms: {
      ios: d.platforms?.ios ?? 0,
      android: d.platforms?.android ?? 0,
      web: d.platforms?.web ?? 0,
    },
  };
}

const identitySchema = z.object({
  user_id: z.string(),
  kind: z.enum(KINDS).catch("account"),
  username: str,
  display_name: str,
  avatar_path: str,
  is_private: z.boolean().nullable().optional(),
  ranks: z.unknown().optional(),
  status: z.string().nullable().optional(),
  joined: str,
  first_seen: str,
  last_seen: str,
  platform: str,
  app_version: str,
  locale: str,
  terms_version: str,
  terms_accepted_at: str,
  research_consent_version: str,
  research_consent_at: str,
  masked_email: str,
  has_password: z.boolean().nullable().optional(),
});
const deviceSchema = z.object({
  fingerprint: z.string(),
  first_seen: str,
  last_seen: str,
  felt_reports: num,
  feedback: num,
  platform: str,
});
const sameSchema = z.object({
  user_id: z.string(),
  kind: z.enum(KINDS).catch("account"),
  username: str,
  display_name: str,
  fingerprint: z.string(),
});
const countsSchema = z
  .object({
    felt_reports: num,
    comments: num,
    comments_visible: num,
    comments_pending: num,
    comments_hidden: num,
    comments_removed: num,
    posts: num,
    feedback: num,
    followers: num,
    following: num,
    blocks_made: num,
    blocks_received: num,
    reports_filed: num,
    reports_received: num,
    reports_open: num,
    homes_owned: num,
    homes_member: num,
    notes: num,
  })
  .partial();
const restrictionSchema = z.object({
  restriction_id: z.string(),
  level: z.enum(["warning", "restrict", "suspend"]),
  reason: z.string(),
  note: str,
  starts_at: str,
  ends_at: str,
  created_at: str,
  created_by_name: str,
  lifted_at: str,
  lifted_by_name: str,
  appeal_requested_at: str,
  active: z.boolean().catch(false),
});

function list<T>(value: unknown, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: T[] = [];
  for (const entry of value) {
    const parsed = schema.safeParse(entry);
    if (parsed.success) {
      out.push(parsed.data);
    }
  }
  return out;
}

export function parsePersonDetail(data: unknown): PersonDetail {
  const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const identity = identitySchema.safeParse(obj.identity);
  if (!identity.success) {
    throw new CommunityError("not_found", "bad person");
  }
  const i = identity.data;
  const ranks = Array.isArray(i.ranks)
    ? i.ranks.flatMap((entry) => {
        const e = (entry ?? {}) as { role?: unknown; org_name?: unknown };
        const role = HUB_ROLE_KINDS.find((kind) => kind === e.role);
        return role
          ? [{ role, orgName: typeof e.org_name === "string" ? e.org_name : null }]
          : [];
      })
    : [];
  const k = (countsSchema.safeParse(obj.counts).data ?? {}) as Record<string, number>;
  const recent = (obj.recent && typeof obj.recent === "object" ? obj.recent : {}) as Record<
    string,
    unknown
  >;
  const felt = z.object({
    report_id: z.string(),
    created_at: str,
    event: str,
    intensity: optNum,
  });
  const comment = z.object({
    comment_id: z.string(),
    created_at: str,
    event: str,
    status: z.string(),
    author_deleted: z.boolean().catch(false),
    excerpt: str,
  });
  const post = z.object({
    post_id: z.string(),
    created_at: str,
    status: z.string(),
    excerpt: str,
  });
  const feedback = z.object({
    feedback_id: z.string(),
    created_at: str,
    category: str,
    status: str,
  });
  return {
    identity: {
      userId: i.user_id,
      kind: i.kind as PersonKind,
      username: i.username ?? null,
      displayName: i.display_name ?? null,
      avatarPath: i.avatar_path ?? null,
      isPrivate: i.is_private === true,
      ranks,
      status: statusOf(i.status),
      joined: ms(i.joined),
      firstSeen: ms(i.first_seen),
      lastSeen: ms(i.last_seen),
      platform: platformOf(i.platform),
      appVersion: i.app_version ?? null,
      locale: i.locale ?? null,
      termsVersion: i.terms_version ?? null,
      termsAcceptedAt: ms(i.terms_accepted_at),
      researchConsentVersion: i.research_consent_version ?? null,
      researchConsentAt: ms(i.research_consent_at),
      maskedEmail: i.masked_email ?? null,
      hasPassword: typeof i.has_password === "boolean" ? i.has_password : null,
    },
    devices: list(obj.devices, deviceSchema).map((d) => ({
      fingerprint: d.fingerprint,
      firstSeen: ms(d.first_seen),
      lastSeen: ms(d.last_seen),
      feltReports: d.felt_reports,
      feedback: d.feedback,
      platform: platformOf(d.platform),
    })),
    sameDeviceUsers: list(obj.same_device_users, sameSchema).map((s) => ({
      userId: s.user_id,
      kind: s.kind as PersonKind,
      username: s.username ?? null,
      displayName: s.display_name ?? null,
      fingerprint: s.fingerprint,
    })),
    counts: {
      feltReports: k.felt_reports ?? 0,
      comments: k.comments ?? 0,
      commentsVisible: k.comments_visible ?? 0,
      commentsPending: k.comments_pending ?? 0,
      commentsHidden: k.comments_hidden ?? 0,
      commentsRemoved: k.comments_removed ?? 0,
      posts: k.posts ?? 0,
      feedback: k.feedback ?? 0,
      followers: k.followers ?? 0,
      following: k.following ?? 0,
      blocksMade: k.blocks_made ?? 0,
      blocksReceived: k.blocks_received ?? 0,
      reportsFiled: k.reports_filed ?? 0,
      reportsReceived: k.reports_received ?? 0,
      reportsOpen: k.reports_open ?? 0,
      homesOwned: k.homes_owned ?? 0,
      homesMember: k.homes_member ?? 0,
      notes: k.notes ?? 0,
    },
    recent: {
      feltReports: list(recent.felt_reports, felt).map((r) => ({
        reportId: r.report_id,
        createdAt: ms(r.created_at),
        event: r.event ?? null,
        intensity: r.intensity ?? null,
      })),
      comments: list(recent.comments, comment).map((c) => ({
        commentId: c.comment_id,
        createdAt: ms(c.created_at),
        event: c.event ?? null,
        status: c.status,
        authorDeleted: c.author_deleted,
        excerpt: c.excerpt ?? null,
      })),
      posts: list(recent.posts, post).map((p) => ({
        postId: p.post_id,
        createdAt: ms(p.created_at),
        status: p.status,
        excerpt: p.excerpt ?? null,
      })),
      feedback: list(recent.feedback, feedback).map((f) => ({
        feedbackId: f.feedback_id,
        createdAt: ms(f.created_at),
        category: f.category ?? null,
        status: f.status ?? null,
      })),
    },
    restrictions: list(obj.restrictions, restrictionSchema).map((r) => ({
      restrictionId: r.restriction_id,
      level: r.level,
      reason: r.reason,
      note: r.note ?? null,
      startsAt: ms(r.starts_at),
      endsAt: ms(r.ends_at),
      createdAt: ms(r.created_at),
      createdByName: r.created_by_name ?? null,
      liftedAt: ms(r.lifted_at),
      liftedByName: r.lifted_by_name ?? null,
      appealRequestedAt: ms(r.appeal_requested_at),
      active: r.active,
    })),
  };
}

const noteSchema = z.object({
  id: z.string(),
  body: z.string(),
  created_at: str,
  author_id: str,
  author_name: str,
});

export function parseNotes(data: unknown): PersonNote[] {
  return list(data, noteSchema).map((n) => ({
    id: n.id,
    body: n.body,
    createdAt: ms(n.created_at),
    authorId: n.author_id ?? null,
    authorName: n.author_name ?? null,
  }));
}

/** The jsonb filter object the server takes: only the keys that are set. */
export function filtersToJson(filters: PeopleFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (filters.rank) out.rank = filters.rank;
  if (filters.status) out.status = filters.status;
  if (filters.reported) out.reported = true;
  if (filters.joinedFrom) out.joined_from = filters.joinedFrom;
  if (filters.joinedTo) out.joined_to = filters.joinedTo;
  if (filters.activeDays) out.active_days = filters.activeDays;
  if (filters.platform) out.platform = filters.platform;
  if (filters.hasPassword !== null) out.has_password = filters.hasPassword;
  return out;
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

export const SupabasePeopleTransport: PeopleTransport = {
  async search(query, cursor) {
    return parsePeoplePage(
      await call("admin_people_search", {
        p_query: query.query.trim() === "" ? null : query.query.trim(),
        p_kind: query.tab,
        p_filters: filtersToJson(query.filters),
        p_sort: query.sort,
        p_cursor: cursor,
        p_limit: PEOPLE_PAGE_SIZE,
      }),
    );
  },
  async stats() {
    return parsePeopleStats(await call("admin_people_stats"));
  },
  async person(userId) {
    return parsePersonDetail(await call("admin_person", { p_user_id: userId }));
  },
  async revealEmail(userId) {
    const data = await call("admin_reveal_email", { p_user_id: userId });
    return typeof data === "string" ? data : null;
  },
  async resetProfile(userId, fields) {
    const data = await call("admin_reset_profile_fields", {
      p_user_id: userId,
      p_fields: fields,
    });
    return typeof data === "string" ? data : null;
  },
  async notes(userId) {
    return parseNotes(await call("admin_person_notes", { p_user_id: userId }));
  },
  async addNote(userId, body) {
    await call("admin_add_person_note", { p_user_id: userId, p_body: body });
  },
};
