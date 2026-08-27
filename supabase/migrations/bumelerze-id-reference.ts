/**
 * Pure TS "reference port" of migration 0025's SQL (`bumelerze_base36`,
 * `format_bumelerze_id`, `allocate_bumelerze_id[_batch]`'s atomic upsert)
 * and, independently, of `shake_service/event_id.py`'s `base36`/
 * `format_bumelerze_id`. Test-only: nothing in the shipped app or any Edge
 * Function imports this module — it exists purely so this schema-only
 * change can be proven correct as a Jest unit test, with no live Postgres
 * connection anywhere, which is the SAME posture
 * `supabase/functions/ingest-events/__tests__/ingest-channel.test.ts`
 * already takes for `upsert_event_from_client`'s own dedup rule ("prove
 * idempotency and dedup as unit tests, not against a running Supabase
 * project", that file's own header comment) — this is the identical
 * convention applied to the id allocator instead.
 */

export const BML_PREFIX = "bml";

const BASE36_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Non-negative integer -> lowercase base-36 string, no padding. Mirrors
 * `shake_service/event_id.py::base36` and migration 0025's
 * `bumelerze_base36` line for line (same alphabet, same "0" special case,
 * same divmod-by-36 loop). */
export function base36(n: number): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`base36: expected a non-negative integer, got ${n}`);
  }
  if (n === 0) {
    return "0";
  }
  let result = "";
  let remaining = n;
  while (remaining > 0) {
    const digit = remaining % 36;
    result = BASE36_DIGITS[digit] + result;
    remaining = Math.floor(remaining / 36);
  }
  return result;
}

/** `(year, 1-based counter)` -> canonical bml id. Mirrors
 * `shake_service/event_id.py::format_bumelerze_id` and migration 0025's
 * `format_bumelerze_id`: pad ONLY when the base-36 suffix is shorter than 4
 * chars (never truncate a past-`zzzz` rollover id — `padStart` has the same
 * "grow, never truncate" behavior as a real string, unlike Postgres's
 * `lpad()`, which DOES truncate; migration 0025's own SQL guards against
 * that explicitly, this port doesn't need to because `padStart` is already
 * safe). */
export function formatBumelerzeId(year: number, counter: number): string {
  if (!Number.isInteger(year) || year < 0 || year > 9999) {
    throw new RangeError(`formatBumelerzeId: year ${year} not expressible in 4 digits`);
  }
  if (!Number.isInteger(counter) || counter < 1) {
    throw new RangeError(`formatBumelerzeId: counter must be >= 1, got ${counter}`);
  }
  const suffix = base36(counter).padStart(4, "0");
  return `${BML_PREFIX}${String(year).padStart(4, "0")}${suffix}`;
}

/**
 * In-memory stand-in for `public.bumelerze_id_counters` +
 * `allocate_bumelerze_id_batch`'s single
 * `INSERT ... ON CONFLICT (year) DO UPDATE ... RETURNING` statement.
 *
 * Faithfulness to the real SQL's concurrency guarantee: Postgres serializes
 * concurrent writers that collide on the same `year` row — the second (and
 * third, ...) transaction blocks until the first commits, then re-evaluates
 * the ON CONFLICT branch against the now-committed value (migration 0025's
 * own header comment has the full argument). A synchronous JS function body
 * with no `await` between "read last_counter" and "write last_counter + n"
 * has the IDENTICAL atomicity property, for the identical reason: nothing
 * else can interleave inside one uninterrupted synchronous step. This is
 * why `allocateBatch` below is written with no `await` anywhere — adding
 * one would silently stop modeling what the real single SQL statement
 * guarantees.
 */
export class InMemoryBumelerzeIdCounters {
  private readonly counters = new Map<number, number>();

  /** Reference port of `allocate_bumelerze_id_batch(p_year, p_count)`. */
  allocateBatch(year: number, count: number): string[] {
    if (!Number.isInteger(count) || count < 1) {
      throw new RangeError(`allocateBatch: count must be >= 1, got ${count}`);
    }
    const previous = this.counters.get(year) ?? 0;
    const end = previous + count;
    this.counters.set(year, end); // the "... RETURNING last_counter" write, same statement
    const ids: string[] = [];
    for (let counter = previous + 1; counter <= end; counter += 1) {
      ids.push(formatBumelerzeId(year, counter));
    }
    return ids;
  }

  /** Reference port of `allocate_bumelerze_id(p_year)` — thin wrapper over
   * `allocateBatch(year, 1)`, exactly like the real SQL (migration 0025 §5:
   * "so there is exactly ONE place the atomic upsert is written"). */
  allocate(year: number): string {
    const ids = this.allocateBatch(year, 1);
    const id = ids[0];
    if (id === undefined) {
      // Unreachable: allocateBatch(year, 1) always returns exactly one
      // element. Surfaced loudly rather than silently, matching this
      // codebase's own "raise exception" posture for unreachable branches
      // (e.g. ingest-events/db.ts's createSourceRecordViaEventRegistry).
      throw new Error(`allocate(${year}): allocateBatch returned no ids`);
    }
    return id;
  }

  /** Reference port of migration 0025 §2's seed row (`insert into
   * bumelerze_id_counters (year, last_counter) values (2026, 999)`). */
  seed(year: number, lastCounter: number): void {
    this.counters.set(year, lastCounter);
  }
}
