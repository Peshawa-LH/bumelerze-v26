import { z } from "zod";

import { stripBidiControls } from "@/lib/bidi-text";
import { call } from "../transport";

/**
 * Admin > Hidden earthquakes (`events.hide`, migration 0085): hide an
 * earthquake for everyone (a second card for one earthquake, not a real
 * one, or another reason) and show it again. Every function checks the
 * permission and the two-step session on the server (42501), and refuses
 * bad input (22023).
 */

/** The reasons, in the order the hide sheet offers them (wording 2.11). */
export const HIDE_REASONS = ["duplicate", "not_real", "other"] as const;
export type HideReason = (typeof HIDE_REASONS)[number];
/** The longest note, as on the server. */
export const HIDE_NOTE_MAX_LENGTH = 200;

/** An earthquake as the admin tools draw it: "M 5.1 · place · date · bml...".
 * A possible earthquake (crowd-detected, owner choice 3) has no Bumelerze
 * id, place or magnitude. */
export interface HiddenEventCard {
  /** The registry uuid (`events.event_id`). */
  eventId: string;
  bumelerzeId: string | null;
  place: string | null;
  magnitude: number | null;
  /** UTC ms. */
  originTime: number;
  /** The registry status (`published`, `possible`), when the server says. */
  status: string | null;
}

/** A row of "Hidden now". */
export interface AdminHiddenEvent extends HiddenEventCard {
  reason: HideReason;
  note: string | null;
  /** UTC ms. */
  hiddenAt: number;
  hiddenByName: string | null;
  /** The card that stays, for a second card. */
  kept: HiddenEventCard | null;
}

/** A search result: the Home screen tool's search, plus whether it is hidden. */
export interface HideFoundEvent extends HiddenEventCard {
  hidden: boolean;
}

/** A choice for "Card that stays": within 10 minutes and 300 km. */
export interface HideCandidate extends HiddenEventCard {
  distanceKm: number | null;
  minutesApart: number | null;
}

/** What hiding would change (wording 2.17). */
export interface HideImpact {
  feltReports: number;
  safetyCheckins: number;
  onHome: boolean;
}

export interface HideInput {
  eventId: string;
  reason: HideReason;
  /** Required for a second card, else null. */
  keptEventId: string | null;
  note: string | null;
}

export interface HideResult {
  movedFeltReports: number;
  movedCheckins: number;
  unpinned: boolean;
}

export interface ShowAgainResult {
  movedBackFeltReports: number;
  movedBackCheckins: number;
}

const count = z.coerce.number().int().nonnegative().catch(0);
const cardSchema = z.object({
  event_id: z.string().min(1),
  bumelerze_id: z.string().nullable().optional(),
  place: z.string().nullable().optional(),
  magnitude: z.coerce.number().nullable().optional().catch(null),
  origin_time: z.string(),
  status: z.string().nullable().optional().catch(null),
});

function parseCard(value: unknown): HiddenEventCard | null {
  const parsed = cardSchema.safeParse(value);
  const originTime = parsed.success ? Date.parse(parsed.data.origin_time) : NaN;
  if (!parsed.success || Number.isNaN(originTime)) {
    return null;
  }
  const d = parsed.data;
  return {
    eventId: d.event_id,
    bumelerzeId: d.bumelerze_id ?? null,
    place: d.place ?? null,
    magnitude: d.magnitude ?? null,
    originTime,
    status: d.status ?? null,
  };
}

function rows<T>(data: unknown, parse: (row: unknown) => T | null): T[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data.flatMap((row) => {
    const parsed = parse(row);
    return parsed ? [parsed] : [];
  });
}

const hiddenSchema = z.object({
  // A reason a newer server adds reads as "Other" (its note says why).
  reason: z.enum(HIDE_REASONS).catch("other"),
  note: z.string().nullable().optional().catch(null),
  hidden_at: z.string(),
  hidden_by_name: z.string().nullable().optional().catch(null),
  kept: z.unknown().optional(),
});

export function parseAdminHiddenEvents(data: unknown): AdminHiddenEvent[] {
  return rows(data, (row) => {
    const card = parseCard(row);
    const parsed = hiddenSchema.safeParse(row);
    const hiddenAt = parsed.success ? Date.parse(parsed.data.hidden_at) : NaN;
    if (!card || !parsed.success || Number.isNaN(hiddenAt)) {
      return null;
    }
    const d = parsed.data;
    const note = d.note?.trim() ? d.note.trim() : null;
    return {
      ...card,
      reason: d.reason,
      note,
      hiddenAt,
      hiddenByName: d.hidden_by_name ?? null,
      kept: d.kept ? parseCard(d.kept) : null,
    };
  });
}

const foundSchema = z.object({ hidden: z.boolean().catch(false) });

export function parseHideFoundEvents(data: unknown): HideFoundEvent[] {
  return rows(data, (row) => {
    const card = parseCard(row);
    const parsed = foundSchema.safeParse(row);
    return card ? { ...card, hidden: parsed.success && parsed.data.hidden } : null;
  });
}

const distance = z.coerce.number().nonnegative().nullable().optional().catch(null);
const candidateSchema = z.object({ distance_km: distance, minutes_apart: distance });

export function parseHideCandidates(data: unknown): HideCandidate[] {
  return rows(data, (row) => {
    const card = parseCard(row);
    const parsed = candidateSchema.safeParse(row);
    if (!card) {
      return null;
    }
    return {
      ...card,
      distanceKm: parsed.success ? (parsed.data.distance_km ?? null) : null,
      minutesApart: parsed.success ? (parsed.data.minutes_apart ?? null) : null,
    };
  });
}

const impactSchema = z.object({
  felt_reports: count,
  safety_checkins: count,
  on_home: z.boolean().catch(false),
});

export function parseHideImpact(data: unknown): HideImpact {
  const parsed = impactSchema.safeParse(data ?? {});
  if (!parsed.success) {
    return { feltReports: 0, safetyCheckins: 0, onHome: false };
  }
  return {
    feltReports: parsed.data.felt_reports,
    safetyCheckins: parsed.data.safety_checkins,
    onHome: parsed.data.on_home,
  };
}

const hideResultSchema = z.object({
  moved_felt_reports: count,
  moved_checkins: count,
  unpinned: z.boolean().catch(false),
});

export function parseHideResult(data: unknown): HideResult {
  const parsed = hideResultSchema.safeParse(data ?? {});
  return parsed.success
    ? {
        movedFeltReports: parsed.data.moved_felt_reports,
        movedCheckins: parsed.data.moved_checkins,
        unpinned: parsed.data.unpinned,
      }
    : { movedFeltReports: 0, movedCheckins: 0, unpinned: false };
}

const showAgainSchema = z.object({
  moved_back_felt_reports: count,
  moved_back_checkins: count,
});

export function parseShowAgainResult(data: unknown): ShowAgainResult {
  const parsed = showAgainSchema.safeParse(data ?? {});
  return parsed.success
    ? {
        movedBackFeltReports: parsed.data.moved_back_felt_reports,
        movedBackCheckins: parsed.data.moved_back_checkins,
      }
    : { movedBackFeltReports: 0, movedBackCheckins: 0 };
}

/** The note as it is sent: plain text, no direction controls, at most 200
 * characters, null when empty (the server does the same, as in 0084). */
export function cleanHideNote(note: string): string | null {
  const clean = stripBidiControls(note).trim().slice(0, HIDE_NOTE_MAX_LENGTH);
  return clean === "" ? null : clean;
}

/**
 * What a refusal from the server means for the hide sheet and the page
 * (0085's messages, "<function>: <name>"): `kept` (kept_required,
 * kept_is_same, kept_not_found, kept_hidden), `note` (note_required,
 * note_too_long) and `isKeptCard` (is_kept_card: another hidden earthquake
 * points to this one as its card that stays) have their own words (2.19,
 * 2.20, 2.25); `stale` (bad_reason,
 * event_not_found, already_hidden, not_hidden) means another admin may have
 * acted: the generic line, and the lists are read again. Anything else
 * (not_allowed is 42501, "Not allowed") goes through the shared words.
 */
export type HideErrorKind = "kept" | "note" | "isKeptCard" | "stale" | null;

export function hideErrorKind(error: unknown): HideErrorKind {
  const message = error instanceof Error ? error.message : "";
  if (/(^|:\s*)is_kept_card\b/.test(message)) {
    return "isKeptCard";
  }
  if (/(^|:\s*)kept_/.test(message)) {
    return "kept";
  }
  if (/(^|:\s*)note_(required|too_long)\b/.test(message)) {
    return "note";
  }
  if (/(^|:\s*)(bad_reason|event_not_found|already_hidden|not_hidden)\b/.test(message)) {
    return "stale";
  }
  return null;
}

export interface HiddenEventsAdminTransport {
  fetchHidden(): Promise<AdminHiddenEvent[]>;
  findEvents(query: string): Promise<HideFoundEvent[]>;
  fetchCandidates(eventId: string): Promise<HideCandidate[]>;
  fetchImpact(eventId: string): Promise<HideImpact>;
  hide(input: HideInput): Promise<HideResult>;
  showAgain(eventId: string): Promise<ShowAgainResult>;
}

export const SupabaseHiddenEventsAdminTransport: HiddenEventsAdminTransport = {
  async fetchHidden() {
    return parseAdminHiddenEvents(await call("admin_hidden_events"));
  },
  async findEvents(query) {
    const q = query.trim();
    return parseHideFoundEvents(
      await call("admin_hide_find_events", { p_query: q === "" ? null : q, p_limit: 20 }),
    );
  },
  async fetchCandidates(eventId) {
    return parseHideCandidates(
      await call("admin_hide_candidates", { p_event_id: eventId }),
    );
  },
  async fetchImpact(eventId) {
    return parseHideImpact(await call("admin_hide_impact", { p_event_id: eventId }));
  },
  async hide({ eventId, reason, keptEventId, note }) {
    return parseHideResult(
      await call("admin_hide_event", {
        p_event_id: eventId,
        p_reason: reason,
        p_kept_event_id: reason === "duplicate" ? keptEventId : null,
        p_note: note,
      }),
    );
  },
  async showAgain(eventId) {
    return parseShowAgainResult(
      await call("admin_unhide_event", { p_event_id: eventId }),
    );
  },
};
