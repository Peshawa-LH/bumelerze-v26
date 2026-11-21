import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";

import { toAsciiDigits } from "@/lib/format-numbers";
import { getSupabaseClient } from "@/lib/supabase";
import { asAuthLike, toAccountError } from "./auth-errors";
import { AccountError } from "./types";

/**
 * Two-step sign-in (security checklist A0.1): a 6-digit code from an
 * authenticator app (TOTP) after the password, through Supabase Auth MFA.
 * Offered only to accounts with admin tools (the screens decide that; the
 * server allows it for any account). The screens never call Supabase
 * directly; they call these functions.
 *
 * Supabase's words: a session is `aal1` after the password and `aal2` once a
 * code was verified; `nextLevel` is `aal2` when the account has a verified
 * factor. Verifying a code (`mfa.challenge` then `mfa.verify`) raises THIS
 * device's session to aal2 and the server ends the account's aal1 sessions
 * elsewhere.
 */

/** Shown in the authenticator app and stored as the factor's name. */
export const TWO_STEP_NAME = "Bumelerze";
export const TWO_STEP_CODE_LENGTH = 6;

/** The digits of a typed code: Eastern Arabic-Indic and Persian digits (a
 * Sorani or Arabic keyboard) become ASCII; spaces and anything else go. */
export function normalizeTwoStepCode(input: string): string {
  return toAsciiDigits(input).replace(/[^0-9]/g, "");
}

export function isCompleteTwoStepCode(input: string): boolean {
  return normalizeTwoStepCode(input).length === TWO_STEP_CODE_LENGTH;
}

// ---------------------------------------------------------------------------
// IO boundary (supabase-js MFA results)
// ---------------------------------------------------------------------------

const FactorSchema = z.object({
  id: z.string().min(1),
  factor_type: z.string(),
  status: z.string(),
});
const FactorListSchema = z.object({ all: z.array(FactorSchema) });
const EnrollSchema = z.object({
  id: z.string().min(1),
  totp: z.object({
    secret: z.string().min(1),
    uri: z.string().min(1),
  }),
});
const ChallengeSchema = z.object({ id: z.string().min(1) });

interface TotpFactors {
  verified: string[];
  unverified: string[];
}

function requireClient(): SupabaseClient {
  const client = getSupabaseClient();
  if (!client) {
    throw new AccountError("unconfigured");
  }
  return client;
}

async function requireAccountUser(client: SupabaseClient): Promise<User> {
  const { data } = await client.auth.getSession();
  const user = data.session?.user ?? null;
  if (!user || user.is_anonymous === true) {
    throw new AccountError("no_session");
  }
  return user;
}

/** The account's TOTP factors, from the server (`listFactors` reads the
 * user), so a factor added or removed on another device is seen. */
async function listTotpFactors(client: SupabaseClient): Promise<TotpFactors> {
  const { data, error } = await client.auth.mfa.listFactors();
  if (error) {
    throw toAccountError(error);
  }
  const parsed = FactorListSchema.safeParse(data);
  if (!parsed.success) {
    throw new AccountError("unknown");
  }
  const totp = parsed.data.all.filter((factor) => factor.factor_type === "totp");
  return {
    verified: totp.filter((f) => f.status === "verified").map((f) => f.id),
    unverified: totp.filter((f) => f.status !== "verified").map((f) => f.id),
  };
}

async function unenroll(client: SupabaseClient, factorId: string): Promise<void> {
  const { error } = await client.auth.mfa.unenroll({ factorId });
  if (error) {
    throw toAccountError(error);
  }
}

/** `mfa.challenge` then `mfa.verify` with the typed code. On success the
 * session on this device is aal2 (supabase-js stores the new tokens). */
async function challengeAndVerify(
  client: SupabaseClient,
  factorId: string,
  code: string,
): Promise<void> {
  const digits = normalizeTwoStepCode(code);
  if (digits.length !== TWO_STEP_CODE_LENGTH) {
    throw new AccountError("wrong_code");
  }
  const challenge = await client.auth.mfa.challenge({ factorId });
  if (challenge.error) {
    throw toAccountError(challenge.error);
  }
  const parsed = ChallengeSchema.safeParse(challenge.data);
  if (!parsed.success) {
    throw new AccountError("unknown");
  }
  const { error } = await client.auth.mfa.verify({
    factorId,
    challengeId: parsed.data.id,
    code: digits,
  });
  if (error) {
    throw toAccountError(error, "wrong_code");
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Whether two-step sign-in is on, from the session stored on this device
 * (no network): for the My account row. It follows this device's own
 * changes at once (turning on stores the verified factor with the new
 * session; turning off refreshes the session). Never throws. */
export async function readTwoStepEnabledOnDevice(): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) {
    return false;
  }
  try {
    const { data } = await client.auth.getSession();
    const factors = data.session?.user?.factors ?? [];
    return factors.some(
      (factor) => factor.factor_type === "totp" && factor.status === "verified",
    );
  } catch {
    return false;
  }
}

/**
 * True when this device is signed in to an account that has two-step
 * sign-in on but has not given a code in this session (aal1 -> aal2).
 * `fresh` asks the server for the account's factors (one request) instead
 * of trusting the stored session's copy, which is how a device that signed
 * in before two-step sign-in was turned on finds out. Never throws: when it
 * cannot tell (offline, no session), it says no.
 */
export async function twoStepCodeNeeded(
  options: { fresh?: boolean } = {},
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) {
    return false;
  }
  try {
    let jwt: string | undefined;
    if (options.fresh) {
      const { data } = await client.auth.getSession();
      const session = data.session;
      if (!session || session.user?.is_anonymous === true) {
        return false;
      }
      jwt = session.access_token;
    }
    const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel(jwt);
    if (error || !data) {
      return false;
    }
    return data.currentLevel === "aal1" && data.nextLevel === "aal2";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Set up / turn off / verify
// ---------------------------------------------------------------------------

export type TwoStepSetup =
  | { kind: "alreadyOn" }
  | {
      kind: "setup";
      factorId: string;
      /** The base32 key, for typing in by hand. */
      secret: string;
      /** The otpauth:// link the QR code holds (the same link Supabase's
       * `totp.qr_code` image encodes). */
      uri: string;
    };

/**
 * Starts turning two-step sign-in on: removes any unverified factor left
 * from an abandoned attempt (Supabase refuses a second factor with the same
 * name), then `mfa.enroll` a new TOTP factor. Nothing is on until
 * `confirmTwoStepSetup` verifies a code from it.
 */
export async function startTwoStepSetup(): Promise<TwoStepSetup> {
  const client = requireClient();
  await requireAccountUser(client);
  const factors = await listTotpFactors(client);
  if (factors.verified.length > 0) {
    return { kind: "alreadyOn" };
  }
  await removeUnverified(client, factors.unverified);
  let result = await enrollTotp(client);
  if (result.error && asAuthLike(result.error).code === "mfa_factor_name_conflict") {
    // An unverified factor appeared meanwhile (the screen left and opened
    // again quickly): clear it and try once more.
    await removeUnverified(client, (await listTotpFactors(client)).unverified);
    result = await enrollTotp(client);
  }
  const { data, error } = result;
  if (error) {
    throw toAccountError(error);
  }
  const parsed = EnrollSchema.safeParse(data);
  if (!parsed.success) {
    throw new AccountError("unknown");
  }
  return {
    kind: "setup",
    factorId: parsed.data.id,
    secret: parsed.data.totp.secret,
    uri: parsed.data.totp.uri,
  };
}

function enrollTotp(client: SupabaseClient) {
  return client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: TWO_STEP_NAME,
    // Without it the authenticator app would name the entry after the Auth
    // site address; with it, "Bumelerze", as the screens say.
    issuer: TWO_STEP_NAME,
  });
}

/** Removes unverified factors; one already gone (an abandoned setup being
 * cleaned up at the same moment) is fine. */
async function removeUnverified(client: SupabaseClient, factorIds: string[]): Promise<void> {
  for (const factorId of factorIds) {
    const { error } = await client.auth.mfa.unenroll({ factorId });
    const e = asAuthLike(error);
    if (error && e.code !== "mfa_factor_not_found" && e.status !== 404) {
      throw toAccountError(error);
    }
  }
}

/** Turns two-step sign-in on: the first code from the new factor verifies
 * it (`mfa.challenge` + `mfa.verify`). */
export async function confirmTwoStepSetup(factorId: string, code: string): Promise<void> {
  const client = requireClient();
  await challengeAndVerify(client, factorId, code);
}

/** Best effort: removes the unverified factor of a setup the person left
 * before giving a code. The next setup removes it anyway. */
export async function abandonTwoStepSetup(factorId: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) {
    return;
  }
  try {
    await client.auth.mfa.unenroll({ factorId });
  } catch {
    // Offline: startTwoStepSetup cleans it up next time.
  }
}

/** Gives the code for this session (after the password, or for a device
 * that was signed in before two-step sign-in was turned on): aal1 -> aal2. */
export async function verifyTwoStepCode(code: string): Promise<void> {
  const client = requireClient();
  await requireAccountUser(client);
  const factors = await listTotpFactors(client);
  const factorId = factors.verified[0];
  if (!factorId) {
    // Turned off meanwhile (another device): nothing left to give a code for.
    return;
  }
  await challengeAndVerify(client, factorId, code);
}

/**
 * Turns two-step sign-in off. Supabase removes a verified factor only from
 * an aal2 session, so the code is verified first (which also proves the
 * person still has the authenticator), then every TOTP factor is removed
 * and the session refreshed so this device's copy of the account forgets
 * the factor.
 */
export async function turnOffTwoStep(code: string): Promise<void> {
  const client = requireClient();
  await requireAccountUser(client);
  const factors = await listTotpFactors(client);
  const factorId = factors.verified[0];
  if (factorId) {
    await challengeAndVerify(client, factorId, code);
  }
  for (const id of [...factors.verified, ...factors.unverified]) {
    await unenroll(client, id);
  }
  await client.auth.refreshSession().catch(() => undefined);
}
