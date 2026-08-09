import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client wiring — env-gated, ready before any Supabase project
 * exists (Supabase-ready wiring wave, 2026-08). NO live project is assumed
 * anywhere in this module or its callers; every entry point checks
 * `isSupabaseConfigured()` first and falls back to today's local-only
 * behavior when it's false (`PendingTransport` in `features/felt/queue.ts`,
 * a no-op telemetry ping in `features/telemetry/ping.ts`).
 *
 * **Env var pattern (Expo SDK 57 standard):** `EXPO_PUBLIC_`-prefixed
 * variables are inlined into the JS bundle by Metro at build/start time —
 * no `app.config.ts` `extra` plumbing needed, and the same `.env` works for
 * `expo start`, EAS builds, and EAS Update alike (docs.expo.dev
 * "Environment variables"). See `.env.example` at the repo root for the two
 * values the owner pastes in, and `supabase/README.md`'s "Wiring status"
 * section for the end-to-end unlock procedure.
 *
 * **Auth model recap (supabase/README.md, migrations 0003/0005):**
 * `felt_reports`/`felt_report_details`/`telemetry_pings` accept anonymous
 * (`anon` role) inserts keyed on a client-generated `device_id` / no
 * identity at all — those never need a Supabase Auth session, just the anon
 * key. `notification_subscriptions` is the one table that needs a real
 * `auth.uid()` for its per-row RLS ownership, via Supabase Anonymous Auth —
 * that's what `signInAnonymously()` below is for (not used by anything in
 * this wave yet; notification-subscription sync is still future work, see
 * README).
 */

function normalizeEnvValue(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value.trim() : null;
}

// Static (non-dynamic) member access on `process.env` is required both by
// Metro's own EXPO_PUBLIC_ inlining (it statically scans for exactly this
// shape at build time — a dynamic `process.env[name]` lookup would not get
// replaced) and by the `expo/no-dynamic-env-var` lint rule. Two tiny
// wrapper functions (not one parameterized one) so both call sites stay
// statically analyzable. Read live (not snapshotted at module load) so
// tests can flip `process.env` and `jest.resetModules()` between cases
// without a separate code path from production, where these are static
// per bundle anyway.
function readSupabaseUrl(): string | null {
  return normalizeEnvValue(process.env.EXPO_PUBLIC_SUPABASE_URL);
}

function readSupabaseAnonKey(): string | null {
  return normalizeEnvValue(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
}

/** Guard every Supabase-touching call site with this — mirrors the wave
 * brief's "isSupabaseConfigured() guard everywhere" requirement. */
export function isSupabaseConfigured(): boolean {
  return readSupabaseUrl() !== null && readSupabaseAnonKey() !== null;
}

let cachedClient: SupabaseClient | null = null;

/**
 * Returns the singleton Supabase client, or `null` when unconfigured — never
 * throws, so callers can write `const client = getSupabaseClient(); if
 * (!client) return ...;` without a try/catch. AsyncStorage-backed auth
 * storage (matches `features/felt/device-id.ts` and the felt-queue
 * persister's own storage choice) so an anonymous-auth session survives app
 * restarts instead of re-signing-in every cold start.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }
  if (!cachedClient) {
    const url = readSupabaseUrl();
    const anonKey = readSupabaseAnonKey();
    // isSupabaseConfigured() above already proved both are non-null; the
    // casts here just satisfy the compiler without re-deriving that.
    cachedClient = createClient(url as string, anonKey as string, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return cachedClient;
}

let anonymousSignInPromise: Promise<void> | null = null;

async function performAnonymousSignIn(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("signInAnonymously: Supabase is not configured");
  }

  // A prior launch may already have a persisted anonymous session (restored
  // from AsyncStorage above) — skip the network round-trip entirely when so.
  const { data: sessionData } = await client.auth.getSession();
  if (sessionData.session) {
    return;
  }

  const { error } = await client.auth.signInAnonymously();
  if (error) {
    throw error;
  }
}

/**
 * Lazy, memoized anonymous sign-in (supabase/migrations/0005 README note:
 * "the Expo app needs to call `signInAnonymously()` once per install before
 * writing to [`notification_subscriptions`]"). Safe to call from multiple
 * places — concurrent callers within one app session all await the SAME
 * underlying `auth.signInAnonymously()` call rather than racing two sign-ins
 * (same in-flight-promise-cache pattern as `features/felt/device-id.ts`'s
 * `getDeviceId()`). On failure the cache is cleared so a later retry (next
 * foreground, next screen visit) can try again instead of being stuck
 * replaying one rejected promise forever.
 */
export function signInAnonymously(): Promise<void> {
  if (!anonymousSignInPromise) {
    anonymousSignInPromise = performAnonymousSignIn().catch((error: unknown) => {
      anonymousSignInPromise = null;
      throw error;
    });
  }
  return anonymousSignInPromise;
}

/** Test-only escape hatch — clears the client + sign-in caches so each test
 * can start from a clean slate after mutating `process.env`. Never called
 * from app code. */
export function __resetSupabaseForTests(): void {
  cachedClient = null;
  anonymousSignInPromise = null;
}
