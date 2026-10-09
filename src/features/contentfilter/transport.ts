import { z } from "zod";

import { toCommunityError } from "@/features/community/transport";
import { CommunityError } from "@/features/community/types";
import { getSupabaseClient } from "@/lib/supabase";
import {
  FILTER_KINDS,
  FILTER_LANGS,
  type ContentHold,
  type FilterKind,
  type FilterLang,
  type FilterTerm,
  type FilterTestResult,
  type SurgeMode,
  type SurgeStatus,
} from "./types";

/**
 * Word filter, busy-time review and pinned notes (migration 0059). Every
 * function checks the caller's permission on the server; the app only decides
 * what to show. Screens never call Supabase directly; tests inject a fake.
 */
export interface ContentFilterTransport {
  /** The list (`filter.manage`). */
  fetchTerms(): Promise<FilterTerm[]>;
  /** Adds a word or phrase; adding a listed one switches it on again. */
  addTerm(term: string, lang: FilterLang, kind: FilterKind): Promise<string>;
  setTermActive(termId: string, active: boolean): Promise<void>;
  /** "Would this be held?" Nothing is recorded. */
  testText(text: string): Promise<FilterTestResult>;
  fetchSurgeStatus(): Promise<SurgeStatus>;
  setSurgeMode(mode: SurgeMode): Promise<SurgeStatus>;
  /** Public: busy-time review is on (the Event hub banner). */
  fetchSurgeActive(): Promise<boolean>;
  /** Why the given comments or posts wait (moderators). At most 200 ids. */
  fetchHolds(kind: "comment" | "post", ids: readonly string[]): Promise<ContentHold[]>;
  /** Approves a held post (`comments.moderate`). */
  approvePost(postId: string): Promise<void>;
  /** Pins a comment to the top of its Event hub (`hubs.feature`). */
  pinComment(commentId: string): Promise<void>;
  unpinComment(commentId: string): Promise<void>;
}

const kindSchema = z.enum(FILTER_KINDS as [FilterKind, ...FilterKind[]]);
const langSchema = z.enum(FILTER_LANGS as [FilterLang, ...FilterLang[]]);

const termSchema = z.object({
  term_id: z.string(),
  term: z.string(),
  lang: langSchema.catch("any"),
  kind: kindSchema.catch("other"),
  is_pattern: z.boolean().catch(false),
  active: z.boolean().catch(true),
  draft: z.boolean().catch(false),
  holds_30d: z.coerce.number().int().nonnegative().catch(0),
});

export function parseTerms(data: unknown): FilterTerm[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const rows: FilterTerm[] = [];
  for (const row of data) {
    const parsed = termSchema.safeParse(row);
    if (parsed.success) {
      const d = parsed.data;
      rows.push({
        id: d.term_id,
        term: d.term,
        lang: d.lang,
        kind: d.kind,
        isPattern: d.is_pattern,
        active: d.active,
        draft: d.draft,
        holds30d: d.holds_30d,
      });
    }
  }
  return rows;
}

const testSchema = z.object({
  held: z.boolean().catch(false),
  matches: z
    .array(
      z.object({
        term: z.string(),
        kind: kindSchema.catch("other"),
        lang: langSchema.catch("any"),
        is_pattern: z.boolean().catch(false),
      }),
    )
    .catch([]),
  surge: z.boolean().catch(false),
});

export function parseTestResult(data: unknown): FilterTestResult {
  const parsed = testSchema.safeParse(data);
  if (!parsed.success) {
    return { held: false, matches: [], surge: false };
  }
  return {
    held: parsed.data.held,
    matches: parsed.data.matches.map((m) => ({
      term: m.term,
      kind: m.kind,
      lang: m.lang,
      isPattern: m.is_pattern,
    })),
    surge: parsed.data.surge,
  };
}

const num = z.coerce.number().nullable().catch(null).optional();
const surgeSchema = z.object({
  active: z.boolean().catch(false),
  mode: z.enum(["auto", "on", "off"]).catch("auto"),
  until: z.string().nullable().catch(null).optional(),
  reason: z.enum(["magnitude", "felt", "manual"]).nullable().catch(null).optional(),
  event_ref: z.string().nullable().catch(null).optional(),
  magnitude: num,
  place: z.string().nullable().catch(null).optional(),
  reports: num,
  min_magnitude: z.coerce.number().catch(5),
  felt_reports: z.coerce.number().catch(50),
  account_days: z.coerce.number().catch(7),
});

export function parseSurgeStatus(data: unknown): SurgeStatus {
  const d = surgeSchema.parse(typeof data === "object" && data !== null ? data : {});
  const until = d.until ? Date.parse(d.until) : NaN;
  return {
    active: d.active,
    mode: d.mode,
    until: Number.isNaN(until) ? null : until,
    reason: d.reason ?? null,
    eventRef: d.event_ref ?? null,
    magnitude: d.magnitude ?? null,
    place: d.place ?? null,
    reports: d.reports ?? null,
    minMagnitude: d.min_magnitude,
    feltReports: d.felt_reports,
    accountDays: d.account_days,
  };
}

const holdSchema = z.object({
  target_id: z.string(),
  reason: z.enum(["filter", "surge"]),
  term: z.string().nullable().optional(),
  kind: kindSchema.nullable().catch(null).optional(),
});

export function parseHolds(data: unknown): ContentHold[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const rows: ContentHold[] = [];
  for (const row of data) {
    const parsed = holdSchema.safeParse(row);
    if (parsed.success) {
      rows.push({
        targetId: parsed.data.target_id,
        reason: parsed.data.reason,
        term: parsed.data.term ?? null,
        kind: parsed.data.kind ?? null,
      });
    }
  }
  return rows;
}

/** The server's validation tokens for the list (migration 0059). */
export type FilterInputProblem = "term_invalid" | "lang_invalid" | "kind_invalid";

export function filterInputProblem(error: unknown): FilterInputProblem | null {
  const message = error instanceof Error ? error.message : "";
  for (const token of ["term_invalid", "lang_invalid", "kind_invalid"] as const) {
    if (message.includes(token)) {
      return token;
    }
  }
  return null;
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

/** At most 200 ids per call, as the server allows. */
const HOLD_ID_LIMIT = 200;

export const SupabaseContentFilterTransport: ContentFilterTransport = {
  async fetchTerms() {
    return parseTerms(await call("admin_filter_terms"));
  },
  async addTerm(term, lang, kind) {
    const data = await call("admin_add_filter_term", {
      p_term: term.trim(),
      p_lang: lang,
      p_kind: kind,
    });
    return typeof data === "string" ? data : "";
  },
  async setTermActive(termId, active) {
    await call("admin_set_filter_term", { p_term_id: termId, p_active: active });
  },
  async testText(text) {
    return parseTestResult(await call("admin_test_filter", { p_text: text }));
  },
  async fetchSurgeStatus() {
    return parseSurgeStatus(await call("admin_surge_status"));
  },
  async setSurgeMode(mode) {
    return parseSurgeStatus(await call("admin_set_surge_mode", { p_mode: mode }));
  },
  async fetchSurgeActive() {
    try {
      return (await call("hub_surge_active")) === true;
    } catch (error) {
      // before migration 0059 there is no busy-time review: no banner
      if (error instanceof CommunityError && error.code === "unavailable") {
        return false;
      }
      throw error;
    }
  },
  async fetchHolds(kind, ids) {
    if (ids.length === 0) {
      return [];
    }
    return parseHolds(
      await call("content_holds_for", {
        p_target_type: kind,
        p_ids: ids.slice(0, HOLD_ID_LIMIT),
      }),
    );
  },
  async approvePost(postId) {
    await call("admin_approve_post", { p_post_id: postId, p_note: null });
  },
  async pinComment(commentId) {
    await call("pin_hub_comment", { p_comment_id: commentId });
  },
  async unpinComment(commentId) {
    await call("unpin_hub_comment", { p_comment_id: commentId });
  },
};
