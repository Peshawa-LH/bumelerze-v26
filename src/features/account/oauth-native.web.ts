import type { Provider, SupabaseClient } from "@supabase/supabase-js";

import { AccountError } from "./types";

/**
 * Web twin of oauth-native.ts: the web hands the whole page to the provider
 * (service.ts `startOAuth`) and never uses the in-app sign-in sheet, so the
 * web download carries neither it nor expo-web-browser.
 */
export type NativeOAuthOutcome = "signedIn" | "cancelled";

export async function runNativeOAuth(
  _client: SupabaseClient,
  _provider: Provider,
  _upgradeGuest: boolean,
): Promise<NativeOAuthOutcome> {
  throw new AccountError("oauth_unavailable");
}
