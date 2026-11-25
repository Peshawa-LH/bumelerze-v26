import { z } from "zod";

import {
  NOTICE_LANGUAGES,
  type NoticeKind,
  type NoticeTexts,
} from "@/features/home-extras/transport";
import { call } from "../transport";

/** Admin > Home screen (`home.manage`, migration 0084). */

export interface AdminHomeNotice {
  id: string;
  kind: NoticeKind;
  texts: NoticeTexts;
  /** UTC ms. */
  endsAt: number;
}

/** An earthquake on Home now, or one found by the search. */
export interface AdminHomeEvent {
  eventId: string;
  bumelerzeId: string | null;
  place: string | null;
  magnitude: number | null;
  /** UTC ms. */
  originTime: number;
  /** UTC ms while it is on Home, else null. */
  onHomeUntil: number | null;
}

export interface AdminHomeState {
  notice: AdminHomeNotice | null;
  pins: AdminHomeEvent[];
}

export const NOTICE_HOURS = [6, 24, 72, 168] as const;
export type NoticeHours = (typeof NOTICE_HOURS)[number];
export const PIN_DAYS = [1, 3, 7, 30] as const;
export type PinDays = (typeof PIN_DAYS)[number];
/** At most this many earthquakes on Home at a time (owner choice 5). */
export const MAX_PINS = 3;
/** The longest message text, per language. */
export const NOTICE_MAX_LENGTH = 200;

const text = z.string().min(1).optional().catch(undefined);
const noticeSchema = z.object({
  notice_id: z.string(),
  kind: z.enum(["info", "important"]).catch("info"),
  texts: z.object({ en: text, ckb: text, kmr: text, ar: text }).catch({}),
  ends_at: z.string(),
});
const eventSchema = z.object({
  event_id: z.string(),
  bumelerze_id: z.string().nullable().optional(),
  place: z.string().nullable().optional(),
  magnitude: z.coerce.number().nullable().optional().catch(null),
  origin_time: z.string(),
  ends_at: z.string().nullable().optional(),
  pinned_until: z.string().nullable().optional(),
});

function parseEvents(value: unknown): AdminHomeEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((row) => {
    const parsed = eventSchema.safeParse(row);
    const originTime = parsed.success ? Date.parse(parsed.data.origin_time) : NaN;
    if (!parsed.success || Number.isNaN(originTime)) {
      return [];
    }
    const d = parsed.data;
    const until = d.ends_at ?? d.pinned_until ?? null;
    const onHomeUntil = until ? Date.parse(until) : NaN;
    return [
      {
        eventId: d.event_id,
        bumelerzeId: d.bumelerze_id ?? null,
        place: d.place ?? null,
        magnitude: d.magnitude ?? null,
        originTime,
        onHomeUntil: Number.isNaN(onHomeUntil) ? null : onHomeUntil,
      },
    ];
  });
}

export function parseAdminHomeState(data: unknown): AdminHomeState {
  const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const parsed = noticeSchema.safeParse(obj.notice);
  let notice: AdminHomeNotice | null = null;
  if (parsed.success) {
    const endsAt = Date.parse(parsed.data.ends_at);
    const texts: NoticeTexts = {};
    for (const language of NOTICE_LANGUAGES) {
      const value = parsed.data.texts[language];
      if (value) {
        texts[language] = value;
      }
    }
    if (!Number.isNaN(endsAt)) {
      notice = { id: parsed.data.notice_id, kind: parsed.data.kind, texts, endsAt };
    }
  }
  return { notice, pins: parseEvents(obj.pins) };
}

export function parseFoundEvents(data: unknown): AdminHomeEvent[] {
  return parseEvents(data);
}

export interface PostNoticeInput {
  kind: NoticeKind;
  texts: NoticeTexts;
  hours: NoticeHours;
}

export interface HomeAdminTransport {
  fetchState(): Promise<AdminHomeState>;
  findEvents(query: string): Promise<AdminHomeEvent[]>;
  /** Returns the new message's id. */
  postNotice(input: PostNoticeInput): Promise<string>;
  removeNotice(): Promise<boolean>;
  pin(eventId: string, days: PinDays): Promise<void>;
  unpin(eventId: string): Promise<boolean>;
}

export const SupabaseHomeAdminTransport: HomeAdminTransport = {
  async fetchState() {
    return parseAdminHomeState(await call("admin_home_screen"));
  },
  async findEvents(query) {
    const q = query.trim();
    return parseFoundEvents(
      await call("admin_home_find_events", { p_query: q === "" ? null : q, p_limit: 20 }),
    );
  },
  async postNotice({ kind, texts, hours }) {
    const id = await call("admin_post_home_notice", {
      p_kind: kind,
      p_text_en: texts.en ?? null,
      p_text_ckb: texts.ckb ?? null,
      p_text_kmr: texts.kmr ?? null,
      p_text_ar: texts.ar ?? null,
      p_hours: hours,
    });
    return typeof id === "string" ? id : "";
  },
  async removeNotice() {
    return (await call("admin_remove_home_notice")) === true;
  },
  async pin(eventId, days) {
    await call("admin_pin_home_event", { p_event_id: eventId, p_days: days });
  },
  async unpin(eventId) {
    return (await call("admin_unpin_home_event", { p_event_id: eventId })) === true;
  },
};
