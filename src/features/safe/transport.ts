import { z } from "zod";

import { resolveEventUuid } from "@/features/felt/supabase-transport";
import type { EventRegistration } from "@/features/felt";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * "I'm safe" data access (migration 0057). Screens and the queue never call
 * Supabase directly; tests inject a fake.
 *
 * PRIVACY: the check-in call carries exactly three things: the phone's random
 * client id, the server's event id and the time. No coordinates, no device id.
 * (Resolving a feed event to the server's id sends the EARTHQUAKE's public
 * epicentre, the same call a felt report already makes; never the phone's.)
 */

export type CheckInFailure =
  "unconfigured" | "network" | "not_account" | "event" | "rate_limited" | "unknown";

export type CheckInResult =
  | { outcome: "sent" }
  /** The server already holds this client id as taken back (Undo arrived first). */
  | { outcome: "retracted" }
  | { outcome: "failed"; retryable: boolean; reason: CheckInFailure };

export interface CheckInInput {
  clientId: string;
  eventId: string;
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

/** One check-in as the family sees it: who, when, which earthquake. */
export interface FamilyCheckIn {
  userId: string;
  checkedInAt: number;
  event: {
    eventId: string;
    bumelerzeId: string | null;
    magnitude: number;
    place: string | null;
    originTime: number;
  };
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
  if (e.code === "22023") {
    return { retryable: false, reason: /event_/.test(message) ? "event" : "unknown" };
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

const checkInResultSchema = z.object({
  client_id: z.string(),
  status: z.enum(["safe", "retracted"]),
});

const familySchema = z.object({
  my_share: z.boolean().nullable().optional(),
  sharing: z.array(z.string()),
  checkins: z.array(z.unknown()),
});

const familyRowSchema = z.object({
  user_id: z.string(),
  checked_in_at: z.string(),
  event_id: z.string(),
  bumelerze_id: z.string().nullable(),
  magnitude: z.union([z.number(), z.string()]),
  place: z.string().nullable(),
  origin_time: z.string(),
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
    const originTime = Date.parse(row.data.origin_time);
    const magnitude = Number(row.data.magnitude);
    if (
      !Number.isFinite(checkedInAt) ||
      !Number.isFinite(originTime) ||
      !Number.isFinite(magnitude)
    ) {
      continue;
    }
    checkins.push({
      userId: row.data.user_id,
      checkedInAt,
      event: {
        eventId: row.data.event_id,
        bumelerzeId: row.data.bumelerze_id,
        magnitude,
        place: row.data.place,
        originTime,
      },
    });
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

  async checkIn({ clientId, eventId, checkedInAt }) {
    const client = getSupabaseClient();
    if (!client) {
      return { outcome: "failed", retryable: true, reason: "unconfigured" };
    }
    try {
      const { data, error } = await client.rpc("check_in", {
        p_client_id: clientId,
        p_event_id: eventId,
        p_checked_in_at: new Date(checkedInAt).toISOString(),
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
        : { outcome: "sent" };
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
