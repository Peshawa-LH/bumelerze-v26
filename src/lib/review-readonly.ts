/**
 * Review-safe (read-only) builds: `EXPO_PUBLIC_REVIEW_READONLY=1`.
 *
 * Builds made to walk through every screen (parity reviews of the iOS app
 * against the web app) talk to the LIVE Supabase project. Tapping through
 * the felt flow, I'm safe or Tag my building there would create real rows,
 * as a live check did on 2026-10-14. With the flag set, the Supabase
 * client's `fetch` lets reads through (GET and HEAD) and refuses everything
 * else, plus every auth call (sign-in, sign-up, token refresh, even
 * reading the user): no anonymous accounts are created either.
 *
 * A refused request fails exactly like a request made without a network
 * connection (`TypeError: Network request failed`, React Native's own
 * offline error), so every screen shows its normal offline state and the
 * offline queues keep their items instead of sending them. Nothing crashes.
 *
 * Off unless the flag is exactly "1"; the web build never sets it. Read
 * live with a static `process.env` member access (Metro's EXPO_PUBLIC_
 * inlining and the `expo/no-dynamic-env-var` lint rule both need that
 * shape), same as `src/lib/supabase.ts`.
 */

/** True when this build was made with `EXPO_PUBLIC_REVIEW_READONLY=1`. */
export function isReviewReadonlyBuild(): boolean {
  return process.env.EXPO_PUBLIC_REVIEW_READONLY === "1";
}

/** The message React Native's `fetch` rejects with when there is no network:
 * the app's error classifiers already read it as "offline". */
export const REVIEW_READONLY_REFUSAL_MESSAGE = "Network request failed";

const READ_METHODS = new Set(["GET", "HEAD"]);

type FetchFn = typeof fetch;
type FetchInput = Parameters<FetchFn>[0];
type FetchInit = Parameters<FetchFn>[1];

function requestMethod(input: FetchInput, init: FetchInit): string {
  if (init?.method) {
    return init.method.toUpperCase();
  }
  if (typeof input === "object" && input !== null && "method" in input) {
    const method = (input as { method?: unknown }).method;
    if (typeof method === "string" && method.length > 0) {
      return method.toUpperCase();
    }
  }
  return "GET";
}

function requestUrl(input: FetchInput): string {
  if (typeof input === "string") {
    return input;
  }
  if (typeof input === "object" && input !== null) {
    if ("url" in input && typeof (input as { url?: unknown }).url === "string") {
      return (input as { url: string }).url;
    }
    if ("href" in input && typeof (input as { href?: unknown }).href === "string") {
      return (input as { href: string }).href;
    }
  }
  return String(input);
}

/** Whether a read-only build lets this request through: reads only, and
 * nothing at all under Supabase Auth (`/auth/v1/`). */
export function isAllowedInReviewReadonly(input: FetchInput, init?: FetchInit): boolean {
  if (requestUrl(input).includes("/auth/v1/")) {
    return false;
  }
  return READ_METHODS.has(requestMethod(input, init));
}

/**
 * Wraps `baseFetch` so it refuses every write and every auth call. The
 * refusal is a rejected promise with the offline error, never a thrown
 * exception from the call itself, so callers' normal `.catch`/`error`
 * handling takes it.
 */
export function createReviewReadonlyFetch(baseFetch: FetchFn): FetchFn {
  return (input, init) => {
    if (!isAllowedInReviewReadonly(input, init)) {
      return Promise.reject(new TypeError(REVIEW_READONLY_REFUSAL_MESSAGE));
    }
    return baseFetch(input, init);
  };
}
