import { z } from "zod";

import { normalizeSupabaseEventRow } from "@/features/events/normalize";
import { eventsWithSourcesRowSchema } from "@/features/events/supabase-event-schema";
import type { Event } from "@/features/events/types";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * What Bumelerze adds to the top of Home by hand (Admin > Home screen,
 * migration 0084): one message and up to three chosen earthquakes. Read by
 * every phone through `home_extras()`, the only way to these rows.
 */

/** The message's languages, in the order the admin form shows them. A phone
 * in a language the message lacks shows the English text, else the first
 * one filled in (owner choice 3, 2026-11-25). */
export const NOTICE_LANGUAGES = ["en", "ckb", "kmr", "ar"] as const;
export type NoticeLanguage = (typeof NOTICE_LANGUAGES)[number];
export type NoticeTexts = Partial<Record<NoticeLanguage, string>>;
export type NoticeKind = "info" | "important";

export interface HomeNotice {
  id: string;
  kind: NoticeKind;
  texts: NoticeTexts;
  /** UTC ms. */
  startsAt: number;
  /** UTC ms; the phone stops showing it then, also offline. */
  endsAt: number;
}

export interface HomePin {
  /** The registry uuid (`events.event_id`). */
  registryId: string;
  /** The earthquake as the app draws it, built from the registry row. */
  event: Event;
  /** Every provider id the registry knows for it (USGS, EMSC, GEOFON), so
   * the copy in the phone's own feed is found and not listed twice. */
  providerIds: string[];
  /** UTC ms. */
  endsAt: number;
}

export interface HomeExtras {
  notice: HomeNotice | null;
  pins: HomePin[];
}

export const EMPTY_HOME_EXTRAS: HomeExtras = { notice: null, pins: [] };

const text = z.string().trim().min(1).max(400).optional().catch(undefined);
const noticeSchema = z.object({
  notice_id: z.string().min(1),
  kind: z.enum(["info", "important"]).catch("info"),
  texts: z.object({ en: text, ckb: text, kmr: text, ar: text }).catch({}),
  starts_at: z.string(),
  ends_at: z.string(),
});

const sourceSchema = z.object({
  provider: z.string().min(1),
  provider_event_id: z.string().min(1),
  fetched_at: z.string(),
});

const pinSchema = eventsWithSourcesRowSchema.extend({
  ends_at: z.string(),
  sources: z.array(z.unknown()).catch([]),
});

function parseNotice(value: unknown): HomeNotice | null {
  const parsed = noticeSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const d = parsed.data;
  const startsAt = Date.parse(d.starts_at);
  const endsAt = Date.parse(d.ends_at);
  const texts: NoticeTexts = {};
  for (const language of NOTICE_LANGUAGES) {
    const value = d.texts[language];
    if (value) {
      texts[language] = value;
    }
  }
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt) || Object.keys(texts).length === 0) {
    return null;
  }
  return { id: d.notice_id, kind: d.kind, texts, startsAt, endsAt };
}

function parsePin(value: unknown): HomePin | null {
  const parsed = pinSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const row = parsed.data;
  const endsAt = Date.parse(row.ends_at);
  if (Number.isNaN(endsAt) || Number.isNaN(Date.parse(row.origin_time))) {
    return null;
  }
  const sources = row.sources.flatMap((source) => {
    const s = sourceSchema.safeParse(source);
    return s.success ? [s.data] : [];
  });
  return {
    registryId: row.event_id,
    // The first-seen record, as for a shared link (`fetchSupabaseEventByBumelerzeId`).
    event: normalizeSupabaseEventRow(row, sources[0] ?? null),
    providerIds: sources.map((source) => source.provider_event_id),
    endsAt,
  };
}

/** Never throws: a row the app cannot read is left out. */
export function parseHomeExtras(data: unknown): HomeExtras {
  const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const pins = Array.isArray(obj.pins)
    ? obj.pins.flatMap((row) => {
        const pin = parsePin(row);
        return pin ? [pin] : [];
      })
    : [];
  return { notice: parseNotice(obj.notice), pins: pins.slice(0, 3) };
}

export interface HomeExtrasTransport {
  fetchHomeExtras(): Promise<HomeExtras>;
}

export const SupabaseHomeExtrasTransport: HomeExtrasTransport = {
  async fetchHomeExtras() {
    const client = getSupabaseClient();
    if (!client) {
      return EMPTY_HOME_EXTRAS;
    }
    // A plain read (the function is stable): sent as GET, like the app's
    // other public reads.
    const { data, error } = await client.rpc("home_extras", undefined, { get: true });
    if (error) {
      throw error;
    }
    return parseHomeExtras(data);
  },
};
