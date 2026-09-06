import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Static-analysis regression guards over migrations 0025/0026's actual SQL
 * text — the same "no live Postgres, no SQL-parser dependency, plain
 * string/regex checks" convention `src/features/felt/__tests__/
 * supabase-transport.test.ts` already uses to keep client code and schema
 * from drifting apart (that file's own header: "parse `supabase/migrations/
 * 0003_felt_reports.sql` itself... no SQL parser dependency"). Applied here
 * to the properties that matter most for this handover:
 *
 *   1. The allocator is one atomic `INSERT ... ON CONFLICT ... RETURNING`
 *      statement, never a `SELECT` followed by a separate `UPDATE` (the
 *      lost-update race this whole migration exists to close).
 *   2. The 2026 reserved-band seed is exactly 999.
 *   3. `allocate_bumelerze_id[_batch]` are revoked from anon/authenticated
 *      and granted only to service_role.
 *   4. `upsert_event_from_client` is STILL granted to anon/authenticated
 *      (this handover must not accidentally lock the client out).
 *   5. The "genuinely new physical event" INSERT into `events` allocates a
 *      bml id and includes it in the SAME statement that creates the row —
 *      never a later, separate UPDATE (which the added CHECK constraint
 *      would reject outright for a 'published' row, since CHECK constraints
 *      are evaluated per-row at statement end, not deferrable).
 *   6. The `events_bumelerze_id_required_when_published` CHECK constraint
 *      exists with the expected condition — the DB-level backstop for "an
 *      event must never be published without one," independent of whether
 *      every call site remembers to allocate one correctly.
 *
 * These are real regression guards (a future edit that reintroduces the
 * SELECT-then-UPDATE anti-pattern, or that drops the CHECK constraint, or
 * that widens the grant to anon, fails this suite) but they are NOT a
 * substitute for running these migrations against a real local Postgres
 * (`supabase start`) before applying them to production — see this repo's
 * own supabase/README.md "reviewed by inspection only" precedent for every
 * migration before it, and the task hand-off notes for this one.
 */

function readMigration(fileName: string): string {
  const sqlPath = path.join(__dirname, "..", fileName);
  return fs.readFileSync(sqlPath, "utf8");
}

describe("0025_bumelerze_id_allocator.sql", () => {
  const sql = readMigration("0025_bumelerze_id_allocator.sql");

  it("seeds the 2026 reserved band at counter 999 (first Postgres-issued 2026 id = counter 1000)", () => {
    expect(sql).toMatch(
      /insert into public\.bumelerze_id_counters \(year, last_counter\)\s*\nvalues \(2026, 999\);/,
    );
  });

  it("allocate_bumelerze_id_batch performs ONE atomic upsert-with-returning, not a select-then-update", () => {
    const fnStart = sql.indexOf("create or replace function public.allocate_bumelerze_id_batch");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = sql.indexOf("\n$$;", fnStart);
    const body = sql.slice(fnStart, fnEnd);

    // The one safe pattern must be present...
    expect(body).toMatch(/insert into public\.bumelerze_id_counters/);
    expect(body).toMatch(/on conflict \(year\) do update/);
    expect(body).toMatch(/returning last_counter into v_end/);

    // ...and the unsafe pattern this migration exists to avoid must NOT be:
    // a bare `select ... into ... from bumelerze_id_counters` immediately
    // followed by a separate `update bumelerze_id_counters` would reintroduce
    // the lost-update race under concurrent callers.
    expect(body).not.toMatch(/select\s+last_counter\s+into/i);
    expect(body).not.toMatch(/update public\.bumelerze_id_counters\s+set\s+last_counter/i);
  });

  it("allocate_bumelerze_id delegates to allocate_bumelerze_id_batch(p_year, 1) — one locking path, not two", () => {
    const fnStart = sql.lastIndexOf(
      "create or replace function public.allocate_bumelerze_id(p_year integer)",
    );
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = sql.indexOf("\n$$;", fnStart);
    const body = sql.slice(fnStart, fnEnd);
    expect(body).toMatch(/allocate_bumelerze_id_batch\(p_year, 1\)/);
  });

  it("both allocator RPCs are revoked from anon/authenticated and granted only to service_role", () => {
    for (const fn of ["allocate_bumelerze_id(integer)", "allocate_bumelerze_id_batch(integer, integer)"]) {
      const revokeRe = new RegExp(
        `revoke all on function public\\.${fn.replace(/[()]/g, "\\$&")} from public, anon, authenticated;`,
      );
      const grantRe = new RegExp(
        `grant execute on function public\\.${fn.replace(/[()]/g, "\\$&")} to service_role;`,
      );
      expect(sql).toMatch(revokeRe);
      expect(sql).toMatch(grantRe);
    }
    // Belt-and-braces: neither function name should appear in ANY grant
    // line that mentions anon or authenticated.
    const grantLines = sql.split("\n").filter((line) => /^grant execute/.test(line.trim()));
    for (const line of grantLines) {
      if (line.includes("allocate_bumelerze_id")) {
        expect(line).not.toMatch(/anon|authenticated/);
      }
    }
  });

  it("bumelerze_id_counters has row level security enabled", () => {
    expect(sql).toMatch(/alter table public\.bumelerze_id_counters enable row level security;/);
  });
});

describe("0026_wire_bumelerze_id_allocation.sql", () => {
  const sql = readMigration("0026_wire_bumelerze_id_allocation.sql");

  it("allocates a bml id BEFORE inserting the 'genuinely new physical event' row", () => {
    const allocateIdx = sql.indexOf("v_bml_id := public.allocate_bumelerze_id(");
    const insertIdx = sql.indexOf("insert into public.events (\n    origin_time");
    expect(allocateIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(allocateIdx).toBeLessThan(insertIdx);
  });

  it("the new-event INSERT includes bumelerze_id in the SAME statement as the row, never a later UPDATE", () => {
    const insertStart = sql.indexOf("insert into public.events (\n    origin_time");
    const insertEnd = sql.indexOf(";", insertStart);
    const insertStatement = sql.slice(insertStart, insertEnd);

    expect(insertStatement).toMatch(/region_flag, bumelerze_id/);
    expect(insertStatement).toMatch(/v_bml_id\s*\n\s*\)/);
  });

  it("derives the origin year from origin_time explicitly at UTC (never the session timezone)", () => {
    expect(sql).toMatch(/extract\(year from \(p_origin_time at time zone 'utc'\)\)::integer/);
  });

  it("upsert_event_from_client stays callable by anon and authenticated after this change", () => {
    const grantIdx = sql.indexOf("grant execute on function public.upsert_event_from_client");
    expect(grantIdx).toBeGreaterThan(-1);
    const grantEnd = sql.indexOf(";", grantIdx);
    const grantLine = sql.slice(grantIdx, grantEnd);
    expect(grantLine).toMatch(/anon, authenticated, service_role/);
  });

  it("adds the DB-level invariant: a published event can never be missing a bumelerze_id", () => {
    expect(sql).toMatch(
      /add constraint events_bumelerze_id_required_when_published\s*\n\s*check \(status <> 'published' or bumelerze_id is not null\);/,
    );
  });

  it("backfill assigns ids in origin-time ascending order", () => {
    const doBlockIdx = sql.indexOf("do $$");
    expect(doBlockIdx).toBeGreaterThan(-1);
    const doBlockEnd = sql.indexOf("$$;", doBlockIdx + 3);
    const doBlock = sql.slice(doBlockIdx, doBlockEnd);
    expect(doBlock).toMatch(/order by origin_time asc, event_id asc/);
    expect(doBlock).toMatch(/where bumelerze_id is null/);
  });

  it("does NOT touch detect_possible_events — crowd-detected events are out of scope by design", () => {
    expect(sql).not.toMatch(/create or replace function public\.detect_possible_events/);
  });
});

describe("0029_dedup_radius_50km.sql", () => {
  const sql = readMigration("0029_dedup_radius_50km.sql");

  it("re-issues upsert_event_from_client with the 50 km cross-provider radius (config.ts DEDUP_MAX_DISTANCE_KM)", () => {
    expect(sql).toMatch(/create or replace function public\.upsert_event_from_client/);
    expect(sql).toMatch(/ST_DWithin\([\s\S]*?50000 -- 50 km/);
    expect(sql).not.toMatch(/100000 -- 100 km, meters/);
  });

  it("keeps the crowd 'possible' event match at 100 km", () => {
    expect(sql).toMatch(/<= 600 -- 10 min[\s\S]*?100000 -- 100 km/);
  });

  it("still allocates the bml id inside the new-event insert and keeps the grants", () => {
    expect(sql.indexOf("v_bml_id := public.allocate_bumelerze_id(")).toBeGreaterThan(-1);
    expect(sql).toMatch(/grant execute on function public\.upsert_event_from_client[\s\S]*?anon, authenticated, service_role/);
  });
});
