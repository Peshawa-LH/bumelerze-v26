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
 * Static checks of migration 0073 (felt writes need a session; security
 * audit DB-01 / PIPE-01). Pasted into the SQL editor as one line, so the
 * paste rules are pinned; so are the promises: no felt write without a
 * session, a report or comment carries the caller's own account, the server
 * owns the times and the event link (no upper bound on the link: reports on
 * past earthquakes are a feature), and the hub counts people. The behaviour
 * was exercised against a real Postgres (PGlite: 0001-0072 without 0041,
 * then 0073 twice, 46 checks, with the 0071 limit, the 0064 withdraw and
 * restore and the 0067 details RPC again on top) when it was written; these
 * keep it from being edited away.
 */
const FILE = "0073_felt_writes_need_session.sql";
const raw = readMigration(FILE);
const sql = readCode(FILE);
const fn = (name: string) => functionSource(sql, name);
const FELT_TABLES = [
  "felt_reports",
  "felt_report_details",
  "felt_comments",
  "felt_photos",
];

/** The text of `create policy <name> ... ;`. */
function policy(name: string): string {
  const start = sql.indexOf(`create policy ${name} `);
  if (start < 0) {
    throw new Error(`policy ${name} not found`);
  }
  return sql.slice(start, sql.indexOf(";", start) + 1);
}

describe("0073 can be pasted into the SQL editor as one line", () => {
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
    expect(createdTables(sql)).toEqual([]);
    expect(sql).not.toMatch(/create (unique )?index/i);
    expect(sql).not.toMatch(/create function/i);
    const triggers = [...sql.matchAll(/create trigger (\w+)/g)].map((m) => m[1]);
    expect(triggers.sort()).toEqual(["felt_comments_fill_user", "felt_reports_server_times"]);
    for (const name of triggers) {
      expect(sql).toMatch(new RegExp(`drop trigger if exists ${name} on public\\.\\w+;`));
    }
    const policies = [...sql.matchAll(/create policy (\w+) on (public\.\w+)/g)];
    expect(policies).toHaveLength(4);
    for (const [, name, table] of policies) {
      expect(sql).toContain(`drop policy if exists ${name} on ${table};`);
    }
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0073:/);
  });
});

describe("felt writes need a session", () => {
  it("anon loses INSERT on the four felt tables", () => {
    expect(sql).toContain(
      "revoke insert on public.felt_reports, public.felt_report_details, public.felt_comments, public.felt_photos from anon;",
    );
    expect(sql).not.toMatch(/grant [a-z, ]+ on (table )?public\.felt_/);
  });

  it("felt_comments loses the write privileges no policy allowed (0067 missed it)", () => {
    expect(sql).toContain(
      "revoke update, delete, truncate, references, trigger on public.felt_comments from anon, authenticated;",
    );
  });

  it("the four insert policies are for authenticated only", () => {
    for (const table of FELT_TABLES) {
      const body = policy(`${table}_insert`);
      expect(body).toContain(`on public.${table}\n  for insert to authenticated\n`);
      expect(body).not.toMatch(/\banon\b/);
    }
    expect(sql).not.toMatch(/to anon, authenticated\s+with check/);
  });

  it("a report and a comment carry the caller's own account; the old null alternative is gone", () => {
    expect(policy("felt_reports_insert")).toContain(
      "with check (\n    device_id is not null\n    and user_id = auth.uid()\n  );",
    );
    expect(policy("felt_comments_insert")).toContain(
      "with check (\n    moderation_status = 'pending'\n    and moderated_at is null\n    and moderated_by is null\n    and user_id = auth.uid()\n  );",
    );
    expect(sql).not.toContain("user_id is null or");
  });

  it("photos and details keep their checks (pending only; details stay open for 26.4.x)", () => {
    expect(policy("felt_photos_insert")).toContain(
      "with check (\n    moderation_status = 'pending'\n    and moderated_at is null\n    and moderated_by is null\n  );",
    );
    expect(policy("felt_report_details_insert")).toContain("with check (true);");
  });
});

describe("the server owns the times, the owner and the event link", () => {
  const body = fn("felt_reports_server_times");

  it("same function, trigger and search_path as 0034, with the caller's rights", () => {
    expect(body).toContain("returns trigger");
    expect(body).toContain("set search_path = public, pg_temp");
    expect(body).not.toContain("security definer");
    expect(sql).toContain(
      "create trigger felt_reports_server_times\n  before insert on public.felt_reports\n  for each row execute function public.felt_reports_server_times();",
    );
    expect(sql).toContain(
      "revoke all on function public.felt_reports_server_times() from public, anon, authenticated;",
    );
  });

  it("submitted_at is the server's; created_at is clamped into the last two days", () => {
    expect(body).toContain("new.submitted_at := now();");
    expect(body).toContain(
      "if new.created_at is null or new.created_at > now() then\n    new.created_at := now();\n  elsif new.created_at < now() - interval '2 days' then\n    new.created_at := now() - interval '2 days';\n  end if;",
    );
  });

  it("fills user_id from the session only when the row has none", () => {
    expect(body).toContain("v_uid uuid := auth.uid();");
    expect(body).toContain(
      "if new.user_id is null and v_uid is not null then\n    new.user_id := v_uid;\n  end if;",
    );
  });

  it("follows merged_into once and keeps only a published or possible event", () => {
    expect(body).toContain("if v_target is not null and v_merged_into is not null then");
    expect(body.match(/from public\.events e/g)).toHaveLength(2);
    expect(body).toContain("coalesce(v_status, '') not in ('published', 'possible')");
    expect(body).toContain("new.event_id := v_target;");
  });

  it("drops the link only for a report made before the earthquake, never for an old one", () => {
    expect(body).toContain("new.created_at < v_origin - interval '10 minutes'");
    expect(body).not.toMatch(/v_origin \+/);
    expect(body).not.toMatch(/now\(\) - v_origin|v_origin < now\(\)/);
  });

  it("the clamp runs before the event check, which reads the clamped time", () => {
    expect(body.indexOf("new.created_at := now() - interval '2 days';")).toBeLessThan(
      body.indexOf("from public.events e"),
    );
  });

  it("comments get the same user_id fill, before insert", () => {
    const fill = fn("felt_comments_fill_user");
    expect(fill).toContain("set search_path = public, pg_temp");
    expect(fill).toContain(
      "if new.user_id is null and v_uid is not null then\n    new.user_id := v_uid;\n  end if;",
    );
    expect(sql).toContain(
      "create trigger felt_comments_fill_user\n  before insert on public.felt_comments\n  for each row execute function public.felt_comments_fill_user();",
    );
    expect(sql).toContain(
      "revoke all on function public.felt_comments_fill_user() from public, anon, authenticated;",
    );
  });
});

describe("hub numbers count people, not rows", () => {
  const REPORTER = "coalesce(r.user_id::text, r.device_id)";
  const prev64 = readCode("0064_share_safe_withdraw.sql");
  const prev65 = readCode("0065_hub_post.sql");

  it("defines exactly the five functions", () => {
    expect(createdFunctions(sql).sort()).toEqual(
      [
        "event_felt_timeline",
        "event_felt_towns",
        "event_hub_summary",
        "felt_comments_fill_user",
        "felt_reports_server_times",
      ].sort(),
    );
  });

  it("keeps each signature, return shape, security mode and search_path", () => {
    const header = (code: string, name: string) => {
      const source = functionSource(code, name);
      return source.slice(0, source.indexOf("as $$"));
    };
    expect(header(sql, "event_hub_summary")).toBe(header(prev64, "event_hub_summary"));
    expect(header(sql, "event_felt_towns")).toBe(header(prev65, "event_felt_towns"));
    expect(header(sql, "event_felt_timeline")).toBe(header(prev65, "event_felt_timeline"));
  });

  it("keeps the grants: execute for anon and authenticated, not public", () => {
    for (const name of ["event_hub_summary", "event_felt_towns", "event_felt_timeline"]) {
      expect(sql).toContain(`revoke all on function public.${name}(uuid) from public;`);
      expect(sql).toContain(
        `grant execute on function public.${name}(uuid) to anon, authenticated;`,
      );
    }
  });

  it("every reader leaves withdrawn reports out", () => {
    expect(fn("event_hub_summary")).toContain("r.withdrawn_at is null");
    for (const name of ["event_felt_towns", "event_felt_timeline"]) {
      expect(fn(name)).toContain("and r.withdrawn_at is null");
    }
  });

  it("the summary counts distinct reporters and takes levels from each one's latest report", () => {
    const body = fn("event_hub_summary");
    expect(body).toContain(`select ${REPORTER} as reporter,`);
    expect(body).toContain("'reports', (select count(distinct live.reporter) from live),");
    expect(body).toContain("'people', (select count(distinct live.reporter) from live),");
    expect(body).toContain(
      "select distinct on (live.reporter) live.reporter, live.cartoon_level\n      from live\n     order by live.reporter, live.created_at desc, live.report_id desc",
    );
    expect(body).toContain("from latest group by latest.cartoon_level");
    expect(body).toContain("'first_report_at', (select min(live.created_at) from live),");
    expect(body).not.toMatch(/count\(\*\) from public\.felt_reports/);
  });

  it("the summary's comments and featured parts are the 0064 lines", () => {
    const tail = (body: string) => body.slice(body.indexOf("'comments',"));
    expect(tail(fn("event_hub_summary"))).toBe(tail(functionSource(prev64, "event_hub_summary")));
  });

  it("towns place one report per reporter and count people", () => {
    const body = fn("event_felt_towns");
    expect(body).toContain(`select distinct on (${REPORTER})`);
    expect(body).toContain(`order by ${REPORTER}, r.created_at desc, r.report_id desc`);
    expect(body).toContain("count(distinct p.reporter)::integer as n,");
    expect(body).toContain("case when count(distinct p.reporter) >= 3");
    expect(body).toContain("percentile_disc(0.5) within group (order by p.lvl)");
    expect(body).toContain("where n.km <= 100");
  });

  it("towns still return only a town id, a count and a level", () => {
    const body = fn("event_felt_towns");
    const output = body.slice(body.lastIndexOf("select towns.town"));
    expect(output).toContain("select towns.town, towns.n, towns.typical");
    expect(output).not.toMatch(/report_id|user_id|device_id|reporter|geohash|\blat\b|\blon\b/);
    const lateral = (code: string) =>
      code.slice(code.indexOf("cross join lateral"), code.indexOf("where n.km <= 100"));
    expect(lateral(body)).toBe(lateral(functionSource(prev65, "event_felt_towns")));
    const order = (code: string) => code.slice(code.indexOf("select towns.town"));
    expect(order(body)).toBe(order(functionSource(prev65, "event_felt_towns")));
  });

  it("the timeline counts distinct reporters in every bucket", () => {
    const body = fn("event_felt_timeline");
    expect(body).toContain(`select ${REPORTER} as reporter, r.created_at`);
    expect(body).toContain("'total', (select count(distinct live.reporter) from live),");
    expect(body).toContain("'first_day', (select count(distinct early.reporter) from early),");
    expect(body).toContain(
      "'first_hour', (select count(distinct early.reporter) from early where early.h = 0),",
    );
    expect(body).toContain(
      "select early.h, count(distinct early.reporter)::integer as n from early group by early.h",
    );
    expect(body).not.toMatch(/'(total|first_day|first_hour)', \(select count\(\*\)/);
  });

  it("the timeline's window and minutes_to_first are the 0065 lines; nothing personal leaves", () => {
    const body = fn("event_felt_timeline");
    const prev = functionSource(prev65, "event_felt_timeline");
    const part = (code: string, from: string, to: string) =>
      code.slice(code.indexOf(from), code.indexOf(to, code.indexOf(from)));
    expect(part(body, "with ev as", "live as")).toBe(part(prev, "with ev as", "live as"));
    expect(part(body, "'minutes_to_first'", "'hours'")).toBe(
      part(prev, "'minutes_to_first'", "'hours'"),
    );
    expect(body).toContain("live.created_at < ev.t0 + interval '24 hours'");
    const output = body.slice(body.indexOf("select case when not exists"));
    expect(output).not.toMatch(/report_id|user_id|device_id|geohash|\blat\b|\blon\b/);
  });
});

describe("the app copes without a change", () => {
  const transport = readFileSync(
    join(__dirname, "../../../src/features/felt/supabase-transport.ts"),
    "utf8",
  );

  it("signs in anonymously before the report insert", () => {
    const submit = transport.slice(transport.indexOf("async submitTier1("));
    const signIn = submit.indexOf("await ensureAnonymousUserId(client)");
    const insert = submit.indexOf('.from("felt_reports")');
    expect(signIn).toBeGreaterThan(0);
    expect(signIn).toBeLessThan(insert);
  });

  it("retries every insert error except a duplicate, so a refused write waits for a session", () => {
    expect(transport).toContain('const POSTGRES_UNIQUE_VIOLATION = "23505";');
    expect(transport).toContain("return errorCode !== POSTGRES_UNIQUE_VIOLATION;");
    const queue = readFileSync(
      join(__dirname, "../../../src/features/felt/queue.ts"),
      "utf8",
    );
    expect(queue).toContain("const MAX_BACKOFF_MS = 10 * 60_000;");
  });

  it("never asks for the inserted row back (no select policy needed on insert)", () => {
    expect(transport).not.toMatch(/\.insert\([^)]*\)\s*\.select\(/);
    expect(transport).not.toMatch(/\.from\("felt_(reports|comments|photos|report_details)"\)\s*\.upsert\(/);
  });
});

describe("aggregate-felt-cells counts one report per reporter per event", () => {
  const fnDir = join(__dirname, "../../functions/aggregate-felt-cells");
  const read = (file: string) => readFileSync(join(fnDir, file), "utf8");

  it("reads the account and the time of every report", () => {
    expect(read("db.ts")).toContain(
      '.select("report_id, device_id, user_id, event_id, created_at, cartoon_level, lat, lon, geohash_p5")',
    );
  });

  it("dedupes per event before the cells are built", () => {
    expect(read("index.ts")).toContain(
      "const cellReports = onePerReporter(joinReportsAndDetails(reports, details));\n  const groups = groupIntoCells(cellReports);",
    );
    expect(read("aggregate-event.ts")).toContain(
      "deviceId: report.user_id ?? report.device_id,",
    );
  });
});
