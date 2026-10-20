import type { Provider, SupabaseClient } from "@supabase/supabase-js";
import * as WebBrowser from "expo-web-browser";

import { NATIVE_AUTH_CALLBACK_URL } from "@/features/links/incoming";
import { AccountError } from "./types";

/**
 * Google / Apple sign-in in the iOS/Android app. Prepared, NOT live: the
 * buttons stay hidden until EXPO_PUBLIC_AUTH_GOOGLE / _APPLE are "1"
 * (constants.ts), and it has never run against the real providers.
 *
 * The web sends the whole page to the provider and back. The app instead
 * opens the provider's page in the system sign-in sheet (expo-web-browser,
 * ASWebAuthenticationSession on iOS), which closes itself when Supabase
 * redirects to `bumelerze://auth/callback` and hands that address back here.
 * The new session is then read from it:
 * - `?code=…` (PKCE flow): exchanged with `exchangeCodeForSession`;
 * - `#access_token=…&refresh_token=…` (the implicit flow, supabase-js's
 *   default today): stored with `setSession`.
 * The callback never reaches the router (app/+native-intent.tsx ignores it).
 *
 * Supabase needs, before the flags are turned on: the providers enabled,
 * "Allow manual linking" on (a guest is upgraded with `linkIdentity`, so the
 * user id and every guest report stay), and `bumelerze://auth/callback` in
 * Authentication > URL Configuration > Redirect URLs.
 */

export type NativeOAuthOutcome = "signedIn" | "cancelled";

export interface OAuthCallback {
  code: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  error: string | null;
  errorDescription: string | null;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

function readParams(part: string, into: Map<string, string>): void {
  for (const pair of part.split("&")) {
    if (!pair) {
      continue;
    }
    const at = pair.indexOf("=");
    const key = decode(at === -1 ? pair : pair.slice(0, at));
    const value = at === -1 ? "" : decode(pair.slice(at + 1));
    if (!into.has(key)) {
      into.set(key, value);
    }
  }
}

/** Reads the query and the `#` part of the address Supabase returned to. */
export function readOAuthCallback(url: string): OAuthCallback {
  const params = new Map<string, string>();
  const hashAt = url.indexOf("#");
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");
  if (queryAt !== -1) {
    readParams(beforeHash.slice(queryAt + 1), params);
  }
  if (hashAt !== -1) {
    readParams(url.slice(hashAt + 1), params);
  }
  const get = (key: string) => {
    const value = params.get(key);
    return value ? value : null;
  };
  return {
    code: get("code"),
    accessToken: get("access_token"),
    refreshToken: get("refresh_token"),
    error: get("error_code") ?? get("error"),
    errorDescription: get("error_description"),
  };
}

/**
 * Turns the returned address into a session. "cancelled" when the person
 * declined at the provider; a failure throws (the caller maps it to the
 * account error texts).
 */
export async function completeOAuthCallback(
  client: SupabaseClient,
  url: string,
): Promise<NativeOAuthOutcome> {
  const callback = readOAuthCallback(url);
  if (callback.error) {
    if (callback.error === "access_denied") {
      return "cancelled";
    }
    throw new AccountError("unknown", callback.errorDescription ?? callback.error);
  }
  if (callback.code) {
    const { error } = await client.auth.exchangeCodeForSession(callback.code);
    if (error) {
      throw error;
    }
    return "signedIn";
  }
  if (callback.accessToken && callback.refreshToken) {
    const { error } = await client.auth.setSession({
      access_token: callback.accessToken,
      refresh_token: callback.refreshToken,
    });
    if (error) {
      throw error;
    }
    return "signedIn";
  }
  throw new AccountError("unknown", "oauth callback without a session");
}

/**
 * The whole native round trip. `upgradeGuest`: link the provider to this
 * install's guest user (keeps the user id), else sign in with it.
 */
export async function runNativeOAuth(
  client: SupabaseClient,
  provider: Provider,
  upgradeGuest: boolean,
): Promise<NativeOAuthOutcome> {
  const options = { redirectTo: NATIVE_AUTH_CALLBACK_URL, skipBrowserRedirect: true };
  const { data, error } = upgradeGuest
    ? await client.auth.linkIdentity({ provider, options })
    : await client.auth.signInWithOAuth({ provider, options });
  if (error) {
    throw error;
  }
  const authUrl = data?.url;
  if (!authUrl) {
    throw new AccountError("unknown", "no provider address");
  }
  const result = await WebBrowser.openAuthSessionAsync(authUrl, NATIVE_AUTH_CALLBACK_URL);
  if (result.type !== "success") {
    // Closed, cancelled, or a second sign-in sheet was already open.
    return "cancelled";
  }
  return completeOAuthCallback(client, result.url);
}
