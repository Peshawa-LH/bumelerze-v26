import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getDeviceId } from "@/features/felt/device-id";
import { asAuthLike } from "./auth-errors";

/**
 * Moving a guest's reports into an account at sign-in, by SESSION rather
 * than by device id (security audit DB-03, migration 0079).
 *
 * 1. Still a guest, right before signing in: `prepare_device_handover()`
 *    returns a one-time token (64 hex characters) for THIS anonymous user.
 *    The server keeps it for 10 minutes; the app keeps it in memory only,
 *    for 9 (so it never offers one the server has just let go). Best effort:
 *    no token never stops a sign-in.
 * 2. Signed in (after the 6-digit code, when two-step sign-in is on):
 *    `claim_device_handover(p_token)` moves that guest's rows into the
 *    account, once.
 *
 * The app ships before 0079 is applied, so a server without the two new
 * functions (PostgREST PGRST202 / Postgres 42883) gets the old
 * `claim_device_reports(p_device_id)`. A server WITH them never gets the
 * device id: no token means nothing is moved.
 */

/** How long the app offers a token (the server keeps it 10 minutes). */
export const HANDOVER_CLIENT_TTL_MS = 9 * 60_000;
/** Asking for a token never holds a sign-in up longer than this. */
export const HANDOVER_PREPARE_TIMEOUT_MS = 4_000;

const tokenSchema = z.string().regex(/^[0-9a-f]{64}$/);

type ServerSupport = "unknown" | "present" | "missing";

let held: { token: string; expiresAt: number } | null = null;
let support: ServerSupport = "unknown";

/** The server does not have the function (migration not applied yet). */
function isMissingFunction(error: unknown): boolean {
  const code = asAuthLike(error).code;
  return code === "PGRST202" || code === "42883";
}

function asCount(data: unknown): number {
  return typeof data === "number" && Number.isFinite(data) ? data : 0;
}

/** Resolves `null` when `promise` takes longer than `ms`. */
function withinTime<T>(promise: PromiseLike<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Asks for a handover token while this device is still a guest. Does
 * nothing for an account or without a session. Never throws; any token held
 * from before is forgotten first.
 */
export async function prepareHandover(
  client: SupabaseClient,
  now: number = Date.now(),
): Promise<void> {
  held = null;
  try {
    const { data: sessionData } = await client.auth.getSession();
    if (sessionData.session?.user?.is_anonymous !== true) {
      return;
    }
    const result = await withinTime(
      client.rpc("prepare_device_handover"),
      HANDOVER_PREPARE_TIMEOUT_MS,
    );
    if (!result) {
      return;
    }
    if (result.error) {
      if (isMissingFunction(result.error)) {
        support = "missing";
      }
      return;
    }
    const parsed = tokenSchema.safeParse(result.data);
    if (!parsed.success) {
      return;
    }
    support = "present";
    held = { token: parsed.data, expiresAt: now + HANDOVER_CLIENT_TTL_MS };
  } catch {
    // Offline or refused: the sign-in goes ahead; nothing will be moved.
  }
}

/** Forgets the token (a sign-in that failed, a sign-out). */
export function discardHandover(): void {
  held = null;
}

/** True while a token is held and still inside its 9 minutes. */
export function hasHandoverToken(now: number = Date.now()): boolean {
  return held !== null && held.expiresAt > now;
}

function takeToken(now: number): string | null {
  const token = held && held.expiresAt > now ? held.token : null;
  held = null;
  return token;
}

async function claimByDeviceId(client: SupabaseClient): Promise<number> {
  const deviceId = await getDeviceId();
  const { data, error } = await client.rpc("claim_device_reports", {
    p_device_id: deviceId,
  });
  return error ? 0 : asCount(data);
}

/**
 * Moves the guest's rows into the signed-in account: with the held token
 * (then forgotten), or by device id on a server without migration 0079.
 * When it is not yet known whether the server has 0079 and no token is held
 * (the app restarted between password and code), one claim with an empty
 * token tells: 0 from a server that has it, PGRST202 from one that has not.
 * Never throws; returns how many rows moved.
 */
export async function claimHandover(
  client: SupabaseClient,
  now: number = Date.now(),
): Promise<number> {
  try {
    const token = takeToken(now);
    if (token === null && support === "present") {
      return 0;
    }
    if (token === null && support === "missing") {
      return await claimByDeviceId(client);
    }
    const { data, error } = await client.rpc("claim_device_handover", {
      p_token: token ?? "",
    });
    if (error) {
      if (isMissingFunction(error)) {
        support = "missing";
        return await claimByDeviceId(client);
      }
      return 0;
    }
    support = "present";
    return asCount(data);
  } catch {
    return 0;
  }
}

/** Test-only: no token held, nothing known about the server. */
export function __resetHandoverForTests(): void {
  held = null;
  support = "unknown";
}
