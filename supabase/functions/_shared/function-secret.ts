// The shared secret every edge function call must carry (migration 0074;
// security audit CI-01, DB-16, LIVE-02, LIVE-03).
//
// The only callers of the four functions are the seven pg_cron jobs, which
// post through public.call_edge_function(). That function adds the header
// x-bumelerze-function-secret with the value of the Vault secret
// edge_function_secret, generated inside the database. Each function reads
// the same value once per instance through its own service-role client
// (rpc edge_function_secret, service role only) and checks the header as the
// FIRST thing it does, before the method, the body or anything else:
//   - no header, or a wrong one       -> 401 {"error":"unauthorized"}
//   - the secret cannot be read       -> 503 {"error":"unavailable"}
//     (fail closed; nothing is cached, the next call asks again)
//   - right                           -> null: carry on.
// The answers are fixed and say nothing about why. The secret is never
// logged or returned.
//
// Rotation: when the owner replaces the value in Vault, the jobs send the
// new one at once; an instance holding the old copy reloads it when a call
// does not match, at most once a minute, so nobody has to redeploy.
//
// Pure: no Deno, no npm imports (the caller hands in the loader), so Jest
// drives this file directly (__tests__/function-secret.test.ts). Imported by
// relative path, so a thin wrapper pinned to a commit picks it up from the
// same commit.

export const FUNCTION_SECRET_HEADER = "x-bumelerze-function-secret";

/** Shortest value accepted as the expected secret (0074 makes 64 hex). */
export const MIN_SECRET_LENGTH = 32;

/** How long a loaded copy is trusted before a mismatch may reload it. */
export const RELOAD_AFTER_MS = 60_000;

export interface Refusal {
  status: 401 | 503;
  body: { error: "unauthorized" | "unavailable" };
}

export const UNAUTHORIZED: Refusal = { status: 401, body: { error: "unauthorized" } };
export const UNAVAILABLE: Refusal = { status: 503, body: { error: "unavailable" } };

export interface HeaderSource {
  get(name: string): string | null;
}

export interface SecretCheckOptions {
  /** Milliseconds since the epoch; tests pass a clock. */
  now?: () => number;
  /** Told when the secret cannot be loaded; never given the secret. */
  onLoadError?: (message: string) => void;
}

/**
 * Equal strings, in time that depends only on the expected value's length,
 * not on where the first difference is.
 */
export function sameSecret(given: string, expected: string): boolean {
  let diff = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i += 1) {
    const g = i < given.length ? given.charCodeAt(i) : 0;
    diff |= g ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Returns the per-instance check. `load` fetches the expected secret (the
 * rpc); it may throw or return anything, and only a string of at least
 * MIN_SECRET_LENGTH characters is accepted and cached.
 */
export function createFunctionSecretCheck(
  load: () => Promise<unknown>,
  options: SecretCheckOptions = {},
): (headers: HeaderSource) => Promise<Refusal | null> {
  const now = options.now ?? Date.now;
  let cached: { value: string; at: number } | null = null;
  let inFlight: Promise<string | null> | null = null;

  function loadOnce(): Promise<string | null> {
    if (!inFlight) {
      inFlight = (async () => {
        try {
          const value = await load();
          if (typeof value !== "string" || value.length < MIN_SECRET_LENGTH) {
            options.onLoadError?.("edge_function_secret is missing or too short");
            return null;
          }
          cached = { value, at: now() };
          return value;
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : String(caught);
          options.onLoadError?.(
            `edge_function_secret could not be read: ${message.slice(0, 200)}`,
          );
          return null;
        } finally {
          inFlight = null;
        }
      })();
    }
    return inFlight;
  }

  return async function checkFunctionSecret(
    headers: HeaderSource,
  ): Promise<Refusal | null> {
    const given = headers.get(FUNCTION_SECRET_HEADER);
    if (given === null || given === "") {
      return UNAUTHORIZED;
    }
    let expected = cached?.value ?? (await loadOnce());
    if (expected === null) {
      return UNAVAILABLE;
    }
    if (sameSecret(given, expected)) {
      return null;
    }
    // The value may have been rotated in Vault since this copy was loaded.
    if (cached && now() - cached.at >= RELOAD_AFTER_MS) {
      expected = await loadOnce();
      if (expected === null) {
        return UNAVAILABLE;
      }
      if (sameSecret(given, expected)) {
        return null;
      }
    }
    return UNAUTHORIZED;
  };
}

/** The usual loader: rpc edge_function_secret through a service-role client. */
export function rpcSecretLoader(
  client: () => {
    rpc(name: string): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  },
): () => Promise<unknown> {
  return async () => {
    const { data, error } = await client().rpc("edge_function_secret");
    if (error) {
      throw new Error(error.message);
    }
    return data;
  };
}

/** The refusal as an HTTP response (Deno). */
export function refusalResponse(refusal: Refusal): Response {
  return new Response(JSON.stringify(refusal.body), {
    status: refusal.status,
    headers: { "Content-Type": "application/json" },
  });
}
