import { readFileSync } from "fs";
import { join } from "path";

import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0071 (per-caller limits on the felt flow and on
 * event registration by the app). Pasted into the SQL editor as one line, so
 * the paste rules are pinned; so are the promises: only app callers are
 * counted, never the server; the caller is the session or the device, stored
 * as an md5; no global cap on felt reports; a refusal is P0001 with the
 * message token rate_limited, which the felt queue retries with its capped
 * backoff (it gives up only on 23505). The behaviour was exercised against a
 * real Postgres (PGlite: 0001-0070 then 0071 twice, 40 checks; the 0070 and
 * 0068 proofs again on top) when it was written; these keep it from being
 * edited away.
 */
const raw = readMigration("0071_anonymous_write_limits.sql");
const sql = readCode("0071_anonymous_write_limits.sql");
const fn = (name: string) => functionSource(sql, name);
const FELT_TABLES = ["felt_reports", "felt_report_details", "felt_comments", "felt_photos"];

describe("0071 can be pasted into the SQL editor as one line", () => {
  it("has no transaction statements", () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });

  it("has only full-line comments", () => {
    for (const line of sql.split("\n")) {
      expect(line).not.toContain("--");
    }
  });

  it("is plain ASCII and has no question marks (editors read ? as a parameter)", () => {
    expect(raw).not.toMatch(/[^\x00-\x7f]/);
    expect(raw).not.toContain("?");
  });

  it("is idempotent", () => {
    expect(sql).not.toMatch(/create table (?!if not exists)/i);
    expect(sql).not.toMatch(/create (unique )?index (?!if not exists)/i);
    expect(sql).not.toMatch(/create function/i);
    const creates = [...sql.matchAll(/create trigger (\w+)/g)].map((m) => m[1]);
    expect(creates).toHaveLength(5);
    for (const name of creates) {
      expect(sql).toMatch(new RegExp(`drop trigger if exists ${name} on public\\.\\w+;`));
    }
    expect(sql).toContain(
      "if exists (select 1 from cron.job where cron.job.jobname = 'purge_write_rate_counters') then",
    );
    expect(sql).toContain("perform cron.unschedule('purge_write_rate_counters');");
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0071:/);
  });
});

describe("the counters", () => {
  it("one table, closed: RLS on, no client grant, no policy", () => {
    expect(createdTables(sql)).toEqual(["write_rate_counters"]);
    expect(sql).toContain("alter table public.write_rate_counters enable row level security;");
    expect(sql).toContain("revoke all on public.write_rate_counters from public, anon, authenticated;");
    expect(sql).not.toMatch(/create policy/);
    expect(sql).not.toMatch(/grant [a-z, ]+ on public\.write_rate_counters/);
  });

  it("counts a fixed minute and hour window inside the writing transaction", () => {
    const body = fn("write_rate_take");
    expect(body).toContain("values (p_bucket, 'minute', date_trunc('minute', now()), 1)");
    expect(body).toContain("values (p_bucket, 'hour', date_trunc('hour', now()), 1)");
    expect(body).toContain("on conflict (bucket, window_kind, window_start) do update set hits = c.hits + 1");
    expect(body).toContain("return v_minute <= p_per_minute and v_hour <= p_per_hour;");
  });

  it("only the server functions are defined, none callable by the app", () => {
    expect(createdFunctions(sql).sort()).toEqual(
      ["event_registration_rate_limit", "felt_writes_rate_limit", "write_rate_take"].sort(),
    );
    for (const name of createdFunctions(sql)) {
      expect(fn(name)).toContain("security definer");
      expect(fn(name)).toContain("set search_path = public, pg_temp");
    }
    expect(sql).toContain(
      "revoke all on function public.write_rate_take(text, integer, integer) from public, anon, authenticated;",
    );
    expect(sql).not.toMatch(/grant execute/);
  });

  it("is purged hourly: minute windows after 2 hours, all after 2 days", () => {
    expect(sql).toContain(
      "perform cron.schedule('purge_write_rate_counters', '7 * * * *', $cron$delete from public.write_rate_counters where window_start < now() - interval '2 days' or (window_kind = 'minute' and window_start < now() - interval '2 hours');$cron$);",
    );
  });
});

describe("the felt flow", () => {
  it("one trigger on each felt table, before insert", () => {
    for (const table of FELT_TABLES) {
      expect(sql).toContain(
        `create trigger ${table}_rate_limit\n  before insert on public.${table}\n  for each row execute function public.felt_writes_rate_limit();`,
      );
    }
  });

  it("counts app callers only, by session or else by the report's device, hashed", () => {
    const body = fn("felt_writes_rate_limit");
    expect(body).toContain("if not public.request_is_client() then\n    return new;");
    expect(body).toContain("v_caller := 'u:' || md5(v_uid::text);");
    expect(body).toContain("v_device := v_row ->> 'device_id';");
    expect(body).toContain("v_report := coalesce(v_row ->> 'felt_report_id', v_row ->> 'report_id');");
    expect(body).toContain("'d:' || md5(v_device)");
  });

  it("20 a minute and 60 an hour per caller and table, no global cap", () => {
    const body = fn("felt_writes_rate_limit");
    expect(body).toContain("public.write_rate_take(tg_table_name || ':' || v_caller, 20, 60)");
    expect(body).not.toContain(":all");
  });

  it("refuses with P0001 and the rate_limited token", () => {
    const body = fn("felt_writes_rate_limit");
    expect(body).toContain(
      "raise exception '%: rate_limited', tg_table_name using errcode = 'P0001',",
    );
  });

  it("drops and changes no policy: the open details policy stays for 26.4.3", () => {
    expect(sql).not.toMatch(/drop policy|create policy|alter policy/);
  });
});

describe("event registration by the app", () => {
  it("is counted at the source record insert, so a lookup of a known event never is", () => {
    expect(sql).toContain(
      "create trigger source_records_client_rate_limit\n  before insert on public.event_source_records\n  for each row execute function public.event_registration_rate_limit();",
    );
    // upsert_event_from_client (0033) returns a known record before any insert
    const rpc = functionSource(readCode("0033_security_hardening.sql"), "upsert_event_from_client");
    const lookup = rpc.indexOf("if v_event_id is not null then");
    const firstInsert = rpc.indexOf("insert into public.event_source_records");
    expect(lookup).toBeGreaterThan(0);
    expect(rpc.indexOf("return v_event_id;", lookup)).toBeLessThan(firstInsert);
  });

  it("20 a minute and 120 an hour per session, 30 and 300 for all app callers", () => {
    const body = fn("event_registration_rate_limit");
    expect(body).toContain("if not public.request_is_client() then\n    return new;");
    expect(body).toContain(
      "public.write_rate_take('event_registration:u:' || md5(v_uid::text), 20, 120)",
    );
    expect(body).toContain("public.write_rate_take('event_registration:all', 30, 300)");
    expect(
      body.match(
        /raise exception 'upsert_event_from_client: rate_limited' using errcode = 'P0001',/g,
      ),
    ).toHaveLength(2);
  });
});

describe("the app copes without a change", () => {
  const transport = readFileSync(
    join(__dirname, "../../../src/features/felt/supabase-transport.ts"),
    "utf8",
  );

  it("the felt queue retries every insert error except a duplicate", () => {
    expect(transport).toContain('const POSTGRES_UNIQUE_VIOLATION = "23505";');
    expect(transport).toContain("return errorCode !== POSTGRES_UNIQUE_VIOLATION;");
  });

  it("a refused registration leaves the report unassigned instead of failing it", () => {
    expect(transport).toMatch(
      /if \(error \|\| typeof data !== "string" \|\| data\.length === 0\) \{\s+return null;/,
    );
  });

  it("the queue's pause between retries is capped at 10 minutes", () => {
    const queue = readFileSync(join(__dirname, "../../../src/features/felt/queue.ts"), "utf8");
    expect(queue).toContain("const MAX_BACKOFF_MS = 10 * 60_000;");
  });
});
