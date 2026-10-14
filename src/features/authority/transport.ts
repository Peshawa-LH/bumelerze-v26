import { z } from "zod";

import { VULNERABILITY_CLASSES } from "@/features/building/ims25";
import { CommunityError } from "@/features/community/types";
import { call } from "@/features/admin/transport";
import type {
  AreaClasses,
  AuthorityOverview,
  CheckinEvent,
  EventSafety,
  SharedPerson,
  SharingState,
} from "./types";

const count = z.coerce.number().int().nonnegative().catch(0);
const hidden = z.coerce.number().int().nonnegative().nullable().catch(null);
const vc = z.enum(VULNERABILITY_CLASSES).nullable().catch(null);

const eventSchema = z.object({
  event_id: z.string(),
  bumelerze_id: z.string().nullable().optional(),
  magnitude: z.coerce.number().nullable().optional().catch(null),
  place: z.string().nullable().optional(),
  origin_time: z.string(),
  checkins: count.optional(),
});

function parseEvent(row: unknown): CheckinEvent | null {
  const parsed = eventSchema.safeParse(row);
  const t = parsed.success ? Date.parse(parsed.data.origin_time) : NaN;
  if (!parsed.success || Number.isNaN(t)) {
    return null;
  }
  return {
    eventId: parsed.data.event_id,
    bumelerzeId: parsed.data.bumelerze_id ?? null,
    magnitude: parsed.data.magnitude ?? null,
    place: parsed.data.place ?? null,
    originTime: t,
    checkins: parsed.data.checkins ?? 0,
  };
}

function classRecord<T>(source: Record<string, unknown>, value: (v: unknown) => T) {
  return Object.fromEntries(
    VULNERABILITY_CLASSES.map((k) => [k, value(source[k])]),
  ) as Record<(typeof VULNERABILITY_CLASSES)[number], T>;
}

export function parseOverview(data: unknown): AuthorityOverview {
  const obj = (data && typeof data === "object" ? data : null) as Record<
    string,
    unknown
  > | null;
  if (!obj) {
    throw new CommunityError("unavailable", "bad overview");
  }
  const areas: AreaClasses[] = (Array.isArray(obj.areas) ? obj.areas : []).flatMap(
    (row) => {
      const r = (row ?? {}) as { area?: unknown; classes?: unknown };
      if (typeof r.area !== "string") {
        return [];
      }
      const cls = (r.classes && typeof r.classes === "object" ? r.classes : {}) as Record<
        string,
        unknown
      >;
      return [{ area: r.area, classes: classRecord(cls, (v) => hidden.parse(v)) }];
    },
  );
  const totals = (
    obj.classes && typeof obj.classes === "object" ? obj.classes : {}
  ) as Record<string, unknown>;
  return {
    areas,
    classes: classRecord(totals, (v) => count.parse(v)),
    events: (Array.isArray(obj.events) ? obj.events : []).flatMap((row) => {
      const e = parseEvent(row);
      return e ? [e] : [];
    }),
  };
}

export function parseEventSafety(data: unknown): EventSafety {
  const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const event = parseEvent(obj.event);
  if (!event) {
    throw new CommunityError("not_found", "bad event");
  }
  const { checkins: _ignored, ...rest } = event;
  void _ignored;
  return {
    event: rest,
    checkins: hidden.parse(obj.checkins ?? null),
    areas: (Array.isArray(obj.areas) ? obj.areas : []).flatMap((row) => {
      const r = (row ?? {}) as { area?: unknown; people?: unknown; safe?: unknown };
      return typeof r.area === "string"
        ? [
            {
              area: r.area,
              people: count.parse(r.people),
              safe: hidden.parse(r.safe ?? null),
            },
          ]
        : [];
    }),
  };
}

const personSchema = z.object({
  user_id: z.string(),
  username: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  homes: z
    .array(
      z.object({
        area: z.string().nullable().optional(),
        kind: z.enum(["house", "apartment"]).nullable().optional().catch(null),
        vc: vc.optional(),
        vc_range: z.string().nullable().optional(),
      }),
    )
    .catch([]),
  safe: z
    .object({
      checked_in_at: z.string(),
      bumelerze_id: z.string().nullable().optional(),
      magnitude: z.coerce.number().nullable().optional().catch(null),
      place: z.string().nullable().optional(),
      origin_time: z.string().nullable().optional(),
    })
    .nullable()
    .optional()
    .catch(null),
});

export function parsePeople(data: unknown): SharedPerson[] {
  const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  return (Array.isArray(obj.people) ? obj.people : []).flatMap((row) => {
    const parsed = personSchema.safeParse(row);
    if (!parsed.success) {
      return [];
    }
    const d = parsed.data;
    const at = d.safe ? Date.parse(d.safe.checked_in_at) : NaN;
    return [
      {
        userId: d.user_id,
        username: d.username ?? null,
        displayName: d.display_name ?? null,
        homes: d.homes.map((h) => ({
          area: h.area ?? null,
          kind: h.kind ?? null,
          vc: h.vc ?? null,
          vcRange: h.vc_range ?? null,
        })),
        safe:
          d.safe && !Number.isNaN(at)
            ? {
                checkedInAt: at,
                bumelerzeId: d.safe.bumelerze_id ?? null,
                magnitude: d.safe.magnitude ?? null,
                place: d.safe.place ?? null,
                originTime: d.safe.origin_time
                  ? Date.parse(d.safe.origin_time) || null
                  : null,
              }
            : null,
      },
    ];
  });
}

export function parseSharing(data: unknown): SharingState {
  const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const at = typeof obj.changed_at === "string" ? Date.parse(obj.changed_at) : NaN;
  return { enabled: obj.enabled === true, changedAt: Number.isNaN(at) ? null : at };
}

/** Migration 0066. Every authority read is checked and logged on the server. */
export interface AuthorityTransport {
  fetchOverview(): Promise<AuthorityOverview>;
  fetchEventSafety(eventId: string): Promise<EventSafety>;
  fetchPeople(): Promise<SharedPerson[]>;
  fetchSharing(): Promise<SharingState>;
  setSharing(enabled: boolean): Promise<SharingState>;
}

export const SupabaseAuthorityTransport: AuthorityTransport = {
  async fetchOverview() {
    return parseOverview(await call("authority_overview"));
  },
  async fetchEventSafety(eventId) {
    return parseEventSafety(
      await call("authority_event_safety", { p_event_id: eventId }),
    );
  },
  async fetchPeople() {
    return parsePeople(await call("authority_people", { p_limit: 200 }));
  },
  async fetchSharing() {
    return parseSharing(await call("my_authority_sharing"));
  },
  async setSharing(enabled) {
    return parseSharing(await call("set_authority_sharing", { p_enabled: enabled }));
  },
};
