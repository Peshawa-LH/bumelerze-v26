import { readdirSync } from "fs";
import { join } from "path";

import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0074 (the edge functions require a shared
 * secret held in Vault; security audit CI-01, DB-16, LIVE-02, LIVE-03).
 * Pasted into the SQL editor as one line, so the paste rules are pinned; so
 * are the promises: the secret is made in the database once and never
 * overwritten, only the service role can read it, only the four functions
 * can be called, the seven cron jobs keep their names, schedules, bodies,
 * timeouts and the send_alerts guard (compared here with the migrations
 * that created them), and no job command carries the secret. The behaviour
 * was exercised against a real Postgres (PGlite: 0001-0073 without 0041,
 * then 0074 twice, 77 checks, with a capturing net.http_post comparing every
 * job's request before and after; the 0073 proof again on top) when it was
 * written; these keep it from being edited away.
 */
const FILE = "0074_function_secret.sql";
const raw = readMigration(FILE);
const sql = readCode(FILE);
const fn = (name: string) => functionSource(sql, name);
const flat = (text: string) => text.replace(/\s+/g, " ");

const FUNCTIONS = [
  "aggregate-felt-cells",
  "ingest-events",
  "purge-home-photos",
  "send-alerts",
];
const KEY = "sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I";

interface Job {
  name: string;
  schedule: string;
  fn: string;
  body: string;
  timeout: number;
  guard: string | null;
}

/** The jobs as 0017, 0024, 0061 and 0062 scheduled them (net.http_post). */
function oldJobs(): Job[] {
  const jobs: Job[] = [];
  for (const file of [
    "0017_aggregation_cron.sql",
    "0024_ingest_events_cron.sql",
    "0061_activity_mute_export_trash.sql",
    "0062_alert_sender.sql",
  ]) {
    const code = flat(readCode(file));
    const re =
      /cron\.schedule\( ?'(\w+)', ?'([^']+)', ?\$(\w*)\$ ?SELECT net\.http_post\( ?url := 'https:\/\/bcgyxepgruwardhozvfq\.supabase\.co\/functions\/v1\/([\w-]+)', body := '([^']*)'::jsonb, params := '\{\}'::jsonb, headers := jsonb_build_object\( ?'Content-Type', 'application\/json', 'apikey', '(\w+)', 'Authorization', 'Bearer (\w+)' ?\), timeout_milliseconds := (\d+) ?\)( WHERE [^;]+)?; ?\$\3\$/g;
    for (const m of code.matchAll(re)) {
      expect(m[6]).toBe(KEY);
      expect(m[7]).toBe(KEY);
      jobs.push({
        name: m[1] as string,
        schedule: m[2] as string,
        fn: m[4] as string,
        body: m[5] as string,
        timeout: Number(m[8]),
        guard: m[9] ? (m[9] as string).trim().toLowerCase() : null,
      });
    }
  }
  return jobs.sort((a, b) => a.name.localeCompare(b.name));
}

/** The jobs as 0074 schedules them (call_edge_function). */
function newJobs(): Job[] {
  const re =
    /^select cron\.schedule\('(\w+)', '([^']+)', \$cron\$select public\.call_edge_function\('([\w-]+)', '([^']*)'::jsonb, (\d+)\)( where [^;]+)?;\$cron\$\);$/gm;
  return [...sql.matchAll(re)]
    .map((m) => ({
      name: m[1] as string,
      schedule: m[2] as string,
      fn: m[3] as string,
      body: m[4] as string,
      timeout: Number(m[5]),
      guard: m[6] ? (m[6] as string).trim() : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe("0074 can be pasted into the SQL editor as one line", () => {
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

  it("is idempotent: no table, functions replaced, the secret made only when absent", () => {
    expect(createdTables(sql)).toEqual([]);
    expect(sql).not.toMatch(/create function/i);
    expect(sql).not.toMatch(/cron\.unschedule/);
    expect(flat(sql)).toContain(
      "if not exists (select 1 from vault.decrypted_secrets ds where ds.name = 'edge_function_secret') then perform vault.create_secret(",
    );
  });

  it("documents itself, the order of the live steps included", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0074:/);
    expect(raw).toContain("CI-01, DB-16, LIVE-02, LIVE-03");
    expect(raw).toContain("Apply this first");
    expect(raw).toContain(
      "select public.call_edge_function('send-alerts', '{\"health\":true}'::jsonb);",
    );
  });
});

describe("the secret", () => {
  it("is 32 random bytes made inside the database, hex", () => {
    expect(flat(sql)).toContain(
      "perform vault.create_secret( encode(extensions.gen_random_bytes(32), 'hex'), 'edge_function_secret',",
    );
  });

  it("is never updated or deleted by the migration (a rotated value is kept)", () => {
    expect(sql).not.toMatch(/vault\.update_secret/);
    expect(sql).not.toMatch(/(update|delete from) vault\./);
  });

  it("is read by edge_function_secret(), for the service role only", () => {
    const body = fn("edge_function_secret");
    expect(body).toContain("returns text");
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public, pg_temp");
    expect(flat(body)).toContain(
      "select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name = 'edge_function_secret' limit 1",
    );
    expect(sql).toContain(
      "revoke all on function public.edge_function_secret() from public, anon, authenticated;",
    );
    expect(sql).toContain(
      "grant execute on function public.edge_function_secret() to service_role;",
    );
  });
});

describe("call_edge_function", () => {
  const body = fn("call_edge_function");

  it("is the only other function, not callable by the app", () => {
    expect(createdFunctions(sql).sort()).toEqual([
      "call_edge_function",
      "edge_function_secret",
    ]);
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public, pg_temp");
    expect(body).toContain("returns bigint");
    expect(sql).toContain(
      "revoke all on function public.call_edge_function(text, jsonb, integer) from public, anon, authenticated;",
    );
    const grants = [
      ...sql.matchAll(/grant execute on function (public\.\w+\([^)]*\)) to (\w+);/g),
    ].map((m) => `${m[1]} ${m[2]}`);
    expect(grants).toEqual([
      "public.edge_function_secret() service_role",
      "public.call_edge_function(text, jsonb, integer) service_role",
    ]);
    expect(sql).not.toMatch(/to (anon|authenticated|public)\b/);
  });

  it("calls only the four functions, which are exactly the function folders", () => {
    expect(flat(body)).toContain(
      "p_name not in ('aggregate-felt-cells', 'ingest-events', 'purge-home-photos', 'send-alerts') then raise exception 'call_edge_function: unknown function' using errcode = '22023';",
    );
    const folders = readdirSync(join(__dirname, "../../functions"), {
      withFileTypes: true,
    })
      .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
      .map((d) => d.name)
      .sort();
    expect(folders).toEqual(FUNCTIONS);
  });

  it("refuses a body that is not an object and an odd timeout", () => {
    expect(body).toContain("if jsonb_typeof(v_body) <> 'object' then");
    expect(body).toContain(
      "if p_timeout_ms is null or p_timeout_ms < 1000 or p_timeout_ms > 300000 then",
    );
  });

  it("refuses to post without the secret", () => {
    expect(flat(body)).toContain(
      "v_secret := public.edge_function_secret(); if v_secret is null or v_secret = '' then raise exception",
    );
  });

  it("posts with the same headers as before plus x-bumelerze-function-secret", () => {
    expect(flat(body)).toContain(
      "return net.http_post( url := 'https://bcgyxepgruwardhozvfq.supabase.co/functions/v1/' || p_name, body := v_body, params := '{}'::jsonb, headers := jsonb_build_object( 'Content-Type', 'application/json', 'apikey', '" +
        KEY +
        "', 'Authorization', 'Bearer " +
        KEY +
        "', 'x-bumelerze-function-secret', v_secret), timeout_milliseconds := p_timeout_ms );",
    );
  });

  it("never shows the secret in an error", () => {
    for (const m of body.matchAll(/raise exception '([^']*)'(, [^;]*)? using/g)) {
      expect(m[2]).toBeUndefined();
    }
  });
});

describe("the seven cron jobs", () => {
  it("keep the names, schedules, bodies, timeouts and guard of 0017, 0024, 0061 and 0062", () => {
    const before = oldJobs();
    expect(before.map((j) => j.name)).toEqual([
      "aggregate_felt_cells",
      "ingest_events_emsc",
      "ingest_events_geofon",
      "ingest_events_isc",
      "ingest_events_usgs",
      "purge_home_photos",
      "send_alerts",
    ]);
    expect(newJobs()).toEqual(before);
  });

  it("are, literally", () => {
    expect(newJobs()).toEqual([
      {
        name: "aggregate_felt_cells",
        schedule: "*/5 * * * *",
        fn: "aggregate-felt-cells",
        body: "{}",
        timeout: 30000,
        guard: null,
      },
      {
        name: "ingest_events_emsc",
        schedule: "*/1 * * * *",
        fn: "ingest-events",
        body: '{"channel":"emsc"}',
        timeout: 15000,
        guard: null,
      },
      {
        name: "ingest_events_geofon",
        schedule: "*/5 * * * *",
        fn: "ingest-events",
        body: '{"channel":"geofon"}',
        timeout: 20000,
        guard: null,
      },
      {
        name: "ingest_events_isc",
        schedule: "17 3 * * *",
        fn: "ingest-events",
        body: '{"channel":"isc"}',
        timeout: 45000,
        guard: null,
      },
      {
        name: "ingest_events_usgs",
        schedule: "*/1 * * * *",
        fn: "ingest-events",
        body: '{"channel":"usgs"}',
        timeout: 15000,
        guard: null,
      },
      {
        name: "purge_home_photos",
        schedule: "15 4 * * *",
        fn: "purge-home-photos",
        body: "{}",
        timeout: 30000,
        guard: null,
      },
      {
        name: "send_alerts",
        schedule: "* * * * *",
        fn: "send-alerts",
        body: "{}",
        timeout: 60000,
        guard: "where public.alert_work_pending()",
      },
    ]);
  });

  it("are the only jobs scheduled, and their commands carry neither the secret nor the key", () => {
    expect([...sql.matchAll(/cron\.schedule\(/g)]).toHaveLength(7);
    for (const m of sql.matchAll(/\$cron\$([^$]*)\$cron\$/g)) {
      expect(m[1]).not.toContain("sb_publishable");
      expect(m[1]).not.toContain("secret");
      expect(m[1]).not.toContain("net.http_post");
    }
  });

  it("are checked at the end: one job per name calling call_edge_function, or the paste fails", () => {
    const tail = flat(sql.slice(sql.lastIndexOf("do $$")));
    expect(tail).toContain(
      "where (select count(*) from cron.job j where j.jobname = n.name) <> 1",
    );
    expect(tail).toContain(
      "and position('public.call_edge_function(' in j.command) = 0);",
    );
    expect(tail).toContain(
      "raise exception '0074: these jobs are missing, doubled or not rescheduled: %', v_bad;",
    );
    for (const name of newJobs().map((j) => j.name)) {
      expect(tail).toContain(`'${name}'`);
    }
  });
});
