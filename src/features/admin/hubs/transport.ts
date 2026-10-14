import { z } from "zod";

import { call } from "../transport";

/** One earthquake in Admin > Open a hub (`admin_hub_events()`, 0066). */
export interface HubEvent {
  eventId: string;
  bumelerzeId: string | null;
  place: string | null;
  magnitude: number | null;
  /** UTC ms. */
  originTime: number;
  open: boolean;
  /** The pinned note, if the hub has one (first 140 characters). */
  note: { commentId: string; body: string } | null;
}

export interface HubEvents {
  open: HubEvent[];
  events: HubEvent[];
}

const eventSchema = z.object({
  event_id: z.string(),
  bumelerze_id: z.string().nullable().optional(),
  place: z.string().nullable().optional(),
  magnitude: z.coerce.number().nullable().optional().catch(null),
  origin_time: z.string(),
  hub_featured: z.boolean().catch(false),
  note: z
    .object({ comment_id: z.string(), body: z.string() })
    .nullable()
    .optional()
    .catch(null),
});

function parseList(value: unknown): HubEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((row) => {
    const parsed = eventSchema.safeParse(row);
    const t = parsed.success ? Date.parse(parsed.data.origin_time) : NaN;
    if (!parsed.success || Number.isNaN(t)) {
      return [];
    }
    const d = parsed.data;
    return [
      {
        eventId: d.event_id,
        bumelerzeId: d.bumelerze_id ?? null,
        place: d.place ?? null,
        magnitude: d.magnitude ?? null,
        originTime: t,
        open: d.hub_featured,
        note: d.note ? { commentId: d.note.comment_id, body: d.note.body } : null,
      },
    ];
  });
}

export function parseHubEvents(data: unknown): HubEvents {
  const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  return { open: parseList(obj.open), events: parseList(obj.events) };
}

export interface HubAdminTransport {
  fetchEvents(query: string): Promise<HubEvents>;
  setOpen(eventId: string, open: boolean): Promise<void>;
  /** Posts the pinned note as the official account; returns the comment id. */
  postNote(eventId: string, body: string): Promise<string>;
}

export const SupabaseHubAdminTransport: HubAdminTransport = {
  async fetchEvents(query) {
    const q = query.trim();
    return parseHubEvents(
      await call("admin_hub_events", { p_query: q === "" ? null : q, p_limit: 20 }),
    );
  },
  async setOpen(eventId, open) {
    await call("admin_set_hub_open", { p_event_id: eventId, p_open: open });
  },
  async postNote(eventId, body) {
    const id = await call("admin_post_hub_note", { p_event_id: eventId, p_body: body });
    return typeof id === "string" ? id : "";
  },
};
