import { z } from "zod";

import { toCommunityError } from "@/features/community/transport";
import { CommunityError } from "@/features/community/types";
import { HUB_ROLE_KINDS, type HubRoleKind } from "@/features/eventhub/types";
import { getSupabaseClient } from "@/lib/supabase";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_PAGE_SIZE,
  FEEDBACK_STATUSES,
  type FeedbackCategory,
  type FeedbackDetail,
  type FeedbackFilters,
  type FeedbackRow,
  type FeedbackStatus,
  type InboxCounts,
} from "./types";

/** The private bucket feedback screenshots live in (migration 0020). */
export const FEEDBACK_PHOTOS_BUCKET = "feedback-photos";
/** Signed screenshot links last ten minutes: long enough to look, short
 * enough that a copied link soon stops working. */
const SIGNED_URL_SECONDS = 600;

/**
 * Feedback inbox data access (migration 0060). Every function checks
 * `feedback.manage` (or `badges.grant` for the grant) on the server; the app
 * only decides what to show.
 */
export interface InboxTransport {
  /** One page, newest first. `before` is the last row's `cursor`. */
  list(filters: FeedbackFilters, before: string | null): Promise<FeedbackRow[]>;
  counts(): Promise<InboxCounts>;
  get(feedbackId: string): Promise<FeedbackDetail>;
  /** Short-lived links to the screenshots, in the order given. A path that
   * cannot be signed is left out. */
  signScreenshots(paths: string[]): Promise<{ path: string; url: string }[]>;
  /** Status and triage note; `note` null keeps the note, "" clears it. */
  setStatus(
    feedbackId: string,
    status: FeedbackStatus,
    note: string | null,
  ): Promise<void>;
  /** "Grant requested badge": the rank, then the request is marked solved. */
  grantBadge(
    feedbackId: string,
    role: HubRoleKind,
    orgName: string | null,
  ): Promise<void>;
}

function ms(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function statusOf(value: unknown): FeedbackStatus {
  return FEEDBACK_STATUSES.find((s) => s === value) ?? "unseen";
}

function categoryOf(value: unknown): FeedbackCategory | null {
  return FEEDBACK_CATEGORIES.find((c) => c === value) ?? null;
}

const str = z.string().nullable().optional();
const num = z.coerce.number().catch(0);

const rowSchema = z.object({
  feedback_id: z.string(),
  created_at: z.string(),
  status: z.string(),
  category: str,
  preview: z.string().nullable().catch(""),
  platform: str,
  app_version: str,
  locale: str,
  user_id: str,
  display_name: str,
  username: str,
  photo_count: num,
  has_note: z.boolean().catch(false),
});

export function parseFeedbackRows(data: unknown): FeedbackRow[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const rows: FeedbackRow[] = [];
  for (const raw of data) {
    const parsed = rowSchema.safeParse(raw);
    const createdAt = parsed.success ? ms(parsed.data.created_at) : null;
    if (!parsed.success || createdAt === null) {
      continue;
    }
    const d = parsed.data;
    rows.push({
      id: d.feedback_id,
      cursor: d.created_at,
      createdAt,
      status: statusOf(d.status),
      category: categoryOf(d.category),
      preview: d.preview ?? "",
      platform: d.platform ?? null,
      appVersion: d.app_version ?? null,
      locale: d.locale ?? null,
      userId: d.user_id ?? null,
      displayName: d.display_name ?? null,
      username: d.username ?? null,
      photoCount: d.photo_count,
      hasNote: d.has_note,
    });
  }
  return rows;
}

const detailSchema = z.object({
  feedback_id: z.string(),
  created_at: z.string(),
  updated_at: str,
  status: z.string(),
  category: str,
  message: z.string(),
  contact: str,
  platform: str,
  app_version: str,
  locale: str,
  triage_note: str,
  person: z
    .object({
      user_id: z.string(),
      is_account: z.boolean().catch(false),
      display_name: str,
      username: str,
      ranks: z.array(z.string()).catch([]),
    })
    .nullable()
    .optional()
    .catch(null),
  photos: z.array(z.object({ photo_id: z.string(), storage_path: z.string() })).catch([]),
  restriction: z
    .object({
      restriction_id: z.string(),
      level: z.enum(["warning", "restrict", "suspend"]),
      reason: z.string(),
      ends_at: str,
      lifted_at: str,
      active: z.boolean().catch(false),
    })
    .nullable()
    .optional()
    .catch(null),
});

export function parseFeedbackDetail(data: unknown): FeedbackDetail {
  const parsed = detailSchema.safeParse(data);
  const createdAt = parsed.success ? ms(parsed.data.created_at) : null;
  if (!parsed.success || createdAt === null) {
    throw new CommunityError("not_found", "bad feedback");
  }
  const d = parsed.data;
  const person = d.person ?? null;
  const restriction = d.restriction ?? null;
  return {
    id: d.feedback_id,
    createdAt,
    updatedAt: ms(d.updated_at),
    status: statusOf(d.status),
    category: categoryOf(d.category),
    message: d.message,
    contact: d.contact ?? null,
    platform: d.platform ?? null,
    appVersion: d.app_version ?? null,
    locale: d.locale ?? null,
    triageNote: d.triage_note ?? null,
    person: person
      ? {
          userId: person.user_id,
          isAccount: person.is_account,
          displayName: person.display_name ?? null,
          username: person.username ?? null,
          ranks: person.ranks.flatMap((r) => HUB_ROLE_KINDS.filter((k) => k === r)),
        }
      : null,
    photos: d.photos.map((p) => ({ id: p.photo_id, storagePath: p.storage_path })),
    restriction: restriction
      ? {
          id: restriction.restriction_id,
          level: restriction.level,
          reason: restriction.reason,
          endsAt: ms(restriction.ends_at),
          liftedAt: ms(restriction.lifted_at),
          active: restriction.active,
        }
      : null,
  };
}

const countsSchema = z.object({
  feedback: z
    .object({
      unseen: num,
      in_review: num,
      solved: num,
      wont_do: num,
      badge_requests_open: num,
      appeals_open: num,
    })
    .nullable()
    .optional()
    .catch(null),
  photos_pending: z.coerce.number().nullable().optional().catch(null),
});

export function parseInboxCounts(data: unknown): InboxCounts {
  const parsed = countsSchema.safeParse(data ?? {});
  if (!parsed.success) {
    return { feedback: null, photosPending: null };
  }
  const f = parsed.data.feedback ?? null;
  return {
    feedback: f
      ? {
          unseen: f.unseen,
          inReview: f.in_review,
          solved: f.solved,
          wontDo: f.wont_do,
          badgeRequestsOpen: f.badge_requests_open,
          appealsOpen: f.appeals_open,
        }
      : null,
    photosPending: parsed.data.photos_pending ?? null,
  };
}

/** The search box as the server expects it: trimmed, at most 100 characters. */
export function normalizeSearch(text: string): string {
  return text.trim().slice(0, 100);
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

export const SupabaseInboxTransport: InboxTransport = {
  async list(filters, before) {
    const search = normalizeSearch(filters.search);
    return parseFeedbackRows(
      await call("admin_feedback_list", {
        p_status: filters.status,
        p_category: filters.category,
        p_search: search === "" ? null : search,
        p_before: before,
        p_limit: FEEDBACK_PAGE_SIZE,
      }),
    );
  },
  async counts() {
    return parseInboxCounts(await call("admin_inbox_counts"));
  },
  async get(feedbackId) {
    return parseFeedbackDetail(
      await call("admin_feedback_get", { p_feedback_id: feedbackId }),
    );
  },
  async signScreenshots(paths) {
    if (paths.length === 0) {
      return [];
    }
    const client = getSupabaseClient();
    if (!client) {
      throw new CommunityError("unavailable", "Supabase is not configured");
    }
    const { data, error } = await client.storage
      .from(FEEDBACK_PHOTOS_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_SECONDS);
    if (error) {
      throw toCommunityError(error);
    }
    const out: { path: string; url: string }[] = [];
    for (const entry of data ?? []) {
      if (entry.signedUrl && entry.path) {
        out.push({ path: entry.path, url: entry.signedUrl });
      }
    }
    return out;
  },
  async setStatus(feedbackId, status, note) {
    await call("admin_feedback_set_status", {
      p_feedback_id: feedbackId,
      p_status: status,
      p_note: note,
    });
  },
  async grantBadge(feedbackId, role, orgName) {
    await call("admin_feedback_grant_badge", {
      p_feedback_id: feedbackId,
      p_role: role,
      p_org_name: orgName,
    });
  },
};
