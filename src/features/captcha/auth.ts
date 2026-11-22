import type {
  AuthResponse,
  AuthTokenResponsePassword,
  SupabaseClient,
} from "@supabase/supabase-js";

import { getCaptchaToken } from "./token-broker";

/**
 * The ONLY place in the app that calls the Supabase Auth endpoints CAPTCHA
 * protects (anonymous sign-in, password sign-in; also sign-up, email codes
 * and password recovery should the app ever use them). Each call asks for a
 * fresh Turnstile token first and passes it as `options.captchaToken`. A
 * test (`__tests__/protected-auth-calls.test.ts`) fails when any other file
 * calls one of those endpoints directly, so a new call site cannot forget
 * the token.
 *
 * Without a token (no site key configured, or Turnstile could not produce
 * one) the call goes out exactly as it did before CAPTCHA existed — no
 * `options` at all.
 */

/** `{ captchaToken }` for one protected call, or `null` (send none). */
export async function captchaOptions(): Promise<{ captchaToken: string } | null> {
  const captchaToken = await getCaptchaToken();
  return captchaToken ? { captchaToken } : null;
}

export async function signInAnonymouslyWithCaptcha(
  client: SupabaseClient,
): Promise<AuthResponse> {
  const captcha = await captchaOptions();
  return captcha
    ? client.auth.signInAnonymously({ options: captcha })
    : client.auth.signInAnonymously();
}

export async function signInWithPasswordWithCaptcha(
  client: SupabaseClient,
  credentials: { email: string; password: string },
): Promise<AuthTokenResponsePassword> {
  const captcha = await captchaOptions();
  return client.auth.signInWithPassword(
    captcha ? { ...credentials, options: captcha } : credentials,
  );
}
