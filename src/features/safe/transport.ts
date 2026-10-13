import { z } from "zod";

import { resolveEventUuid } from "@/features/felt/supabase-transport";
import type { EventRegistration } from "@/features/felt";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * "I'm safe" data access (migrations 0057 and 0064). Screens and the queue
 * never call Supabase directly; tests inject a fake.
 *
 * PRIVACY: the check-in call carries the phone's random client id, the
 * server's event id or the id of the person's own felt report, and the time.
 * No coordinates, no device id.
 * (Resolving a feed event to the server's id sends the EARTHQUAKE's public
 * epicentre, the same call a felt report already makes; never the phone's.)
 */

export type CheckInFailure =
  | "unconfigured"
  | "network"
  | "not_account"
  | "event"
  | "report"
  | "rate_limited"
  | "unknown";

/** How many people a check-in reached inside the app (migration 0064):
 * approved family members, and follows under the person's choice. */
export interface CheckInTold {
  family: number;
  follows: number;
}

export type CheckInResult =
  | { outcome: "sent"; told?: CheckInTold | null }
  /** The server already holds this client id as taken back (Undo arrived first). */
  | { outcome: "retracted" }
  | { outcome: "failed"; retryable: boolean; reason: CheckInFailure };

export interface CheckInInput {
  clientId: string;
  /** The server's event id; null for a check-in tied to a felt report only. */
  eventId: string | null;
  /** The person's own felt report (migration 0064): the check-in is real
   * even without a regional M4.0, tied to the report's earthquake when it
   * has one. */
  reportId?: string | null;
  /** Phone time, ms. The server clamps it (not in the future, not before the
   * earthquake, not older than 72 hours). */
  checkedInAt: number;
}

export interface CheckInTransport {
  /** Server event id for a feed event, or null when it cannot be resolved now. */
  resolveEvent(registration: EventRegistration): Promise<string | null>;
  checkIn(input: CheckInInput): Promise<CheckInResult>;
  /** True once the server has it as taken back. */
  retract(clientId: string): Promise<boolean>;
}

/** One check-in as the family sees it: who, when, which earthquake (null
 * for a check-in tied to a felt report only, migration 0064). */
export interface FamilyCheckIn {
  userId: string;
  checkedInAt: number;
  event: {
    eventId: string;
    bumelerzeId: string | null;
    magnitude: number;
    place: string | null;
    originTime: number;
  } | null;
}

export interface FamilyCheckIns {
  /** My own switch for this home (null when unknown). */
  myShare: boolean | null;
  /** Members whose status I may see (me included). */
  sharing: string[];
  /** Newest first. */
  checkins: FamilyCheckIn[];
}

export interface FamilyCheckInTransport {
  fetchFamily(tagId: string): Promise<FamilyCheckIns>;
  setSharing(tagId: string, on: boolean): Promise<void>;
}

interface ErrorLike {
  code?: string;
  message?: string;
  status?: number;
  name?: string;
}

/** Maps a PostgREST/RPC error to a failure the queue can act on. Terminal:
 * no account, the event is unusable, a foreign client id. Everything else
 * (network, rate limit, the function not deployed yet) is retried later. */
export function classifyCheckInError(error: unknown): {
  retryable: boolean;
  reason: CheckInFailure;
} {
  const e: ErrorLike =
    typeof error === "object" && error !== null ? (error as ErrorLike) : {};
  const message = e.message ?? "";
  if (e.code === "42501") {
    return { retryable: false, reason: "not_account" };
  }
  if (e.code === "P0002") {
    // The felt report has not reached the server yet: try again later.
    return { retryable: true, reason: "report" };
  }
  if (e.code === "22023") {
    return {
      retryable: false,
      reason: /event_|report_/.test(message) ? "event" : "unknown",
    };
  }
  if (e.code === "54000" || e.status === 429) {
    return { retryable: true, reason: "rate_limited" };
  }
  if (
    e.name === "AuthRetryableFetchError" ||
    e.status === 0 ||
    /network|failed to fetch|fetch failed|timed out/i.test(message)
  ) {
    return { retryable: true, reason: "network" };
  }
  return { retryable: true, reason: "unknown" };
}

const countSchema = z.coerce.number().int().nonnegative().catch(0);
const checkInResultSchema = z.object({
  client_id: z.string(),
  status: z.enum(["safe", "retracted"]),
  told: z
    .object({ family: countSchema, follows: countSchema })
    .nullable()
    .optional()
    .catch(null),
});

const familySchema = z.object({
  my_share: z.boolean().nullable().optional(),
  sharing: z.array(z.string()),
  checkins: z.array(z.unknown()),
});

const familyRowSchema = z.object({
  user_id: z.string(),
  checked_in_at: z.string(),
  event_id: z.string().nullable(),
  bumelerze_id: z.string().nullable().optional(),
  magnitude: z.union([z.number(), z.string()]).nullable().optional(),
  place: z.string().nullable().optional(),
  origin_time: z.string().nullable().optional(),
});

/** Parses `family_checkins` output. Rows that break the contract are dropped. */
export function parseFamilyCheckIns(data: unknown): FamilyCheckIns {
  const parsed = familySchema.safeParse(data);
  if (!parsed.success) {
    return { myShare: null, sharing: [], checkins: [] };
  }
  const checkins: FamilyCheckIn[] = [];
  for (const raw of parsed.data.checkins) {
    const row = familyRowSchema.safeParse(raw);
    if (!row.success) continue;
    const checkedInAt = Date.parse(row.data.checked_in_at);
    if (!Number.isFinite(checkedInAt)) continue;
    let event: FamilyCheckIn["event"] = null;
    if (row.data.event_id !== null) {
      const originTime = Date.parse(row.data.origin_time ?? "");
      const magnitude = Number(row.data.magnitude);
      if (
        !Number.isFinite(originTime) ||
        row.data.magnitude === null ||
        row.data.magnitude === undefined ||
        !Number.isFinite(magnitude)
      ) {
        continue;
      }
      event = {
        eventId: row.data.event_id,
        bumelerzeId: row.data.bumelerze_id ?? null,
        magnitude,
        place: row.data.place ?? null,
        originTime,
      };
    }
    checkins.push({ userId: row.data.user_id, checkedInAt, event });
  }
  checkins.sort((a, b) => b.checkedInAt - a.checkedInAt);
  return {
    myShare: parsed.data.my_share ?? null,
    sharing: parsed.data.sharing,
    checkins,
  };
}

export const SupabaseCheckInTransport: CheckInTransport = {
  async resolveEvent(registration) {
    const client = getSupabaseClient();
    if (!client) return null;
    return resolveEventUuid(client, registration);
  },

  async checkIn({ clientId, eventId, reportId, checkedInAt }) {
    const client = getSupabaseClient();
    if (!client) {
      return { outcome: "failed", retryable: true, reason: "unconfigured" };
    }
    try {
      const { data, error } = await client.rpc("check_in", {
        p_client_id: clientId,
        p_event_id: eventId,
        p_checked_in_at: new Date(checkedInAt).toISOString(),
        ...(reportId ? { p_report_id: reportId } : {}),
      });
      if (error) {
        return { outcome: "failed", ...classifyCheckInError(error) };
      }
      const parsed = checkInResultSchema.safeParse(data);
      if (!parsed.success) {
        return { outcome: "failed", retryable: true, reason: "unknown" };
      }
      return parsed.data.status === "retracted"
        ? { outcome: "retracted" }
        : { outcome: "sent", told: parsed.data.told ?? null };
    } catch (caught) {
      return { outcome: "failed", ...classifyCheckInError(caught) };
    }
  },

  async retract(clientId) {
    const client = getSupabaseClient();
    if (!client) return false;
    try {
      const { error } = await client.rpc("retract_checkin", { p_client_id: clientId });
      if (!error) return true;
      // No account any more: nothing on the server can be ours; stop trying.
      return error.code === "42501";
    } catch {
      return false;
    }
  },
};

/** Who a check-in reaches (migration 0064, Settings > Notifications). */
export const SAFE_AUDIENCES = ["family", "mutual", "followers"] as const;
export type SafeAudienceChoice = (typeof SAFE_AUDIENCES)[number];

/** The person's choice, and how many people each choice reaches today. */
export interface SafeAudience {
  audience: SafeAudienceChoice;
  /** Approved family members who would be told. */
  family: number;
  /** Mutual follows outside the family. */
  mutual: number;
  /** Every accepted follower outside the family (mutual ones included). */
  followers: number;
  /** Follows told under the current choice. */
  follows: number;
}

export interface SafeAudienceTransport {
  fetchAudience(): Promise<SafeAudience>;
  setAudience(audience: SafeAudienceChoice): Promise<SafeAudience>;
}

const audienceSchema = z.object({
  audience: z.enum(SAFE_AUDIENCES).catch("mutual"),
  family: countSchema,
  mutual: countSchema,
  followers: countSchema,
  follows: countSchema,
});

/** Parses `my_safe_audience` / `set_safe_audience`. Throws on a bad shape. */
export function parseSafeAudience(data: unknown): SafeAudience {
  const parsed = audienceSchema.safeParse(data);
  if (!parsed.success) {
    throw new FamilyStatusError("safe_audience");
  }
  return parsed.data;
}

export const SupabaseSafeAudienceTransport: SafeAudienceTransport = {
  async fetchAudience() {
    const client = getSupabaseClient();
    if (!client) throw new FamilyStatusError("unconfigured");
    const { data, error } = await client.rpc("my_safe_audience");
    if (error) throw new FamilyStatusError(error.message);
    return parseSafeAudience(data);
  },

  async setAudience(audience) {
    const client = getSupabaseClient();
    if (!client) throw new FamilyStatusError("unconfigured");
    const { data, error } = await client.rpc("set_safe_audience", {
      p_audience: audience,
    });
    if (error) throw new FamilyStatusError(error.message);
    return parseSafeAudience(data);
  },
};

export class FamilyStatusError extends Error {
  constructor(message?: string) {
    super(message ?? "family_status");
    this.name = "FamilyStatusError";
  }
}

export const SupabaseFamilyCheckInTransport: FamilyCheckInTransport = {
  async fetchFamily(tagId) {
    const client = getSupabaseClient();
    if (!client) throw new FamilyStatusError("unconfigured");
    const { data, error } = await client.rpc("family_checkins", { p_tag: tagId });
    if (error) throw new FamilyStatusError(error.message);
    return parseFamilyCheckIns(data);
  },

  async setSharing(tagId, on) {
    const client = getSupabaseClient();
    if (!client) throw new FamilyStatusError("unconfigured");
    const { error } = await client.rpc("set_checkin_sharing", { p_tag: tagId, p_on: on });
    if (error) throw new FamilyStatusError(error.message);
  },
};
