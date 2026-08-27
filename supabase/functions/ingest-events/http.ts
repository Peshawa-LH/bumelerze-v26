// Shared HTTP fetch helper: sane timeout + ONE bounded retry, never more.
//
// "Be polite to the agencies" (wave brief): this function's own cron wiring
// already keeps outbound load low (one HTTP request per channel per tick —
// four channels, three requests/minute plus one daily bulletin sweep total,
// per source-and-ingestion-plan.md §5 vs. today's ~180,000/hour from every
// phone polling directly). The retry policy below is deliberately NOT an
// exponential backoff state machine: a channel that fails now gets exactly
// one immediate retry (transient DNS/TLS hiccups are the common case) and
// then gives up cleanly — the NEXT scheduled cron tick (60s/5min/1 day
// later, per channel) IS the backoff. Building persistent backoff state
// for something that already self-heals on its own schedule would be
// machinery this minimal-ops backend does not need (PROJECT.md: "if
// Supabase can do it, use Supabase" — here, "if pg_cron's own cadence
// already provides backoff, don't build a second one").

export interface FetchTextOptions {
  timeoutMs: number;
  retries?: number;
  retryDelayMs?: number;
}

const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOnce(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`request failed: ${response.status} ${url}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetches `url` as text, with `options.timeoutMs` per attempt and up to
 * `options.retries` (default 1) extra attempts after a `options.retryDelayMs`
 * (default 1.5s) pause. Throws only after every attempt is exhausted — the
 * caller (`ingest-channel.ts`) treats a thrown fetch failure as "this
 * channel's whole run failed", logs it, and returns a non-200 summary
 * without touching the database; it never retries again inside the same
 * invocation, relying on the next cron tick instead (see header comment).
 */
export async function fetchTextWithRetry(
  url: string,
  options: FetchTextOptions,
): Promise<string> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchOnce(url, options.timeoutMs);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(retryDelayMs);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchJsonWithRetry(url: string, options: FetchTextOptions): Promise<unknown> {
  const text = await fetchTextWithRetry(url, options);
  return JSON.parse(text);
}
