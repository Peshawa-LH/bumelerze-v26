import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0067 (operations and hygiene: the feed
 * watchdog, the cron history purge, 400-class RPC error codes, the grants
 * clean-up, the owner-checked tier-2 RPC, the Government official rank in
 * the People filter). Pasted into the SQL editor as one line, so the paste
 * rules are pinned; so are the promises: no client ever reads or writes the
 * two new tables directly, one open alert per feed, withdraw_felt_report
 * keeps its P0002 until the app changes with it, the felt flow keeps the
 * privileges its policies need and nothing more. The behaviour was exercised
 * against a real Postgres (PGlite: 0035-0066 then 0067 twice; the 0066,
 * 0065 and 0064 suites again on top) when it was written; these keep it
 * from being edited away.
 */
const raw = readMigration("0067_ops_and_hygiene.sql");
const sql = readCode("0067_ops_and_hygiene.sql");
const fn = (name: string) => functionSource(sql, name);

describe("0067 can be pasted into the SQL editor as one line", () => {
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
    expect(sql).not.toMatch(/add column (?!if not exists)/i);
    expect(sql).toContain("on conflict do nothing;");
    // the cron jobs are unscheduled by name before being scheduled again
    for (const job of ["ops_check_feeds", "purge_cron_history"]) {
      expect(sql).toContain(
        `if exists (select 1 from cron.job where cron.job.jobname = '${job}') then`,
      );
      expect(sql).toContain(`perform cron.unschedule('${job}');`);
    }
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0067:/);
  });

  it("creates exactly two tables, both closed behind RLS with no client grant", () => {
    expect(createdTables(sql)).toEqual(["feed_heartbeats", "ops_alerts"]);
    for (const table of ["feed_heartbeats", "ops_alerts"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(
        `revoke all on public.${table} from public, anon, authenticated;`,
      );
      expect(sql).not.toMatch(new RegExp(`create policy \\w+ on public\\.${table}`));
    }
    expect(sql).toContain(
      "grant select, insert, update on public.feed_heartbeats to service_role;",
    );
  });

  it("creates the expected functions and nothing else", () => {
    expect(createdFunctions(sql).sort()).toEqual(
      [
        "admin_ops_alerts",
        "admin_people_search",
        "alerts_send_test",
        "ops_check_feeds",
        "restore_felt_report",
        "submit_felt_report_details",
      ].sort(),
    );
    for (const name of createdFunctions(sql)) {
      expect(fn(name)).toContain("security definer");
      expect(fn(name)).toContain("set search_path = public, pg_temp");
    }
  });
});

describe("the feed watchdog (D-2) and the cron purge (D-7)", () => {
  it("seeds a heartbeat per channel once and keeps the function's writes to the service role", () => {
    expect(sql).toMatch(
      /insert into public\.feed_heartbeats \(provider, last_ok_at\)\s+values \('usgs', now\(\)\), \('emsc', now\(\)\), \('geofon', now\(\)\), \('isc', now\(\)\)\s+on conflict do nothing;/,
    );
    expect(sql).toContain("check (provider in ('usgs', 'emsc', 'geofon', 'isc'))");
  });

  it("allows one open alert per feed", () => {
    expect(sql).toContain(
      "create unique index if not exists ops_alerts_open_uq\n  on public.ops_alerts (kind, (details ->> 'provider')) where closed_at is null;",
    );
  });

  it("watches usgs and emsc with a 60 minute threshold, opens once and closes on recovery", () => {
    const body = fn("ops_check_feeds");
    expect(body).toContain("foreach v_provider in array array['usgs', 'emsc'] loop");
    expect(body).toContain("v_threshold interval := interval '60 minutes';");
    expect(body).toContain("v_stale := v_last is null or v_last < now() - v_threshold;");
    expect(body).toContain("if v_stale and v_open is null then");
    expect(body).toContain("elsif not v_stale and v_open is not null then");
    expect(body).toContain("set closed_at = now(),");
    expect(sql).toContain(
      "revoke all on function public.ops_check_feeds() from public, anon, authenticated;",
    );
    expect(sql).not.toMatch(/grant execute on function public\.ops_check_feeds/);
  });

  it("runs the watchdog every 15 minutes and the purge daily, keeping 7 days", () => {
    expect(sql).toContain(
      "perform cron.schedule('ops_check_feeds', '*/15 * * * *', $cron$select public.ops_check_feeds();$cron$);",
    );
    expect(sql).toContain(
      "perform cron.schedule('purge_cron_history', '50 4 * * *', $cron$delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '7 days';$cron$);",
    );
  });

  it("shows alerts to the statistics ranks only", () => {
    const body = fn("admin_ops_alerts");
    expect(body).toContain("public.has_permission(v_uid, 'stats.read')");
    expect(body).toContain(
      "raise exception 'admin_ops_alerts: not_allowed' using errcode = '42501';",
    );
    expect(body).toContain("where a.closed_at is null), '[]'::jsonb),");
    expect(sql).toContain(
      "revoke all on function public.admin_ops_alerts() from public, anon;",
    );
    expect(sql).toContain(
      "grant execute on function public.admin_ops_alerts() to authenticated;",
    );
  });
});

describe("RPC error codes (D-10)", () => {
  it("alerts_send_test answers 400-class codes with the same message tokens", () => {
    const body = fn("alerts_send_test");
    expect(body).toContain(
      "raise exception 'alerts_send_test: no_device' using errcode = '22023',",
    );
    expect(
      body.match(
        /raise exception 'alerts_send_test: too_soon' using errcode = 'P0001',/g,
      ),
    ).toHaveLength(2);
    expect(body).not.toContain("P0002");
    expect(body).not.toContain("54000");
    expect(body).toContain("public.alerts_require_enabled('alerts_send_test')");
    expect(sql).toContain(
      "grant execute on function public.alerts_send_test() to authenticated;",
    );
  });

  it("restore_felt_report's not_found is 22023, the rest of the 0064 body unchanged", () => {
    const body = fn("restore_felt_report");
    expect(body).toContain(
      "raise exception 'restore_felt_report: not_found' using errcode = '22023';",
    );
    expect(body).toContain(
      "raise exception 'restore_felt_report: expired' using errcode = '22023';",
    );
    expect(body).toContain(
      "raise exception 'restore_felt_report: conflict' using errcode = '22023';",
    );
    expect(body).toContain(
      "set withdrawn_at = null, withdrawn_by = null, restored_at = now()",
    );
    expect(sql).toContain(
      "grant execute on function public.restore_felt_report(uuid, text) to anon, authenticated;",
    );
  });

  it("leaves withdraw_felt_report alone: the app reads its P0002", () => {
    expect(sql).not.toMatch(/create or replace function public\.withdraw_felt_report/);
  });
});

describe("grants hygiene (D-12)", () => {
  it("takes every write privilege off the read-only tables", () => {
    expect(sql).toMatch(
      /revoke insert, update, delete, truncate, references, trigger on\s+public\.events, public\.event_source_records, public\.felt_cells, public\.user_roles,\s+public\.building_complexes, public\.bumelerze_id_counters, public\.event_merges,\s+public\.home_join_attempts, public\.reserved_display_terms, public\.reserved_usernames\s+from anon, authenticated;/,
    );
  });

  it("keeps insert on the felt report tables and insert plus update on the upserted ones", () => {
    expect(sql).toMatch(
      /revoke update, delete, truncate, references, trigger on\s+public\.felt_reports, public\.felt_report_details\s+from anon, authenticated;/,
    );
    expect(sql).toMatch(
      /revoke delete, truncate, references, trigger on\s+public\.felt_photos, public\.profiles\s+from anon, authenticated;/,
    );
    // never a blanket revoke that would take the policies' inserts away
    expect(sql).not.toMatch(
      /revoke all on public\.(felt_reports|felt_report_details|felt_photos|profiles)/,
    );
    expect(sql).not.toMatch(/revoke select/);
  });

  it("stops future tables from receiving write privileges by default", () => {
    expect(sql).toMatch(
      /alter default privileges in schema public\s+revoke insert, update, delete, truncate, references, trigger on tables from anon, authenticated;/,
    );
  });

  it("drops no policy", () => {
    expect(sql).not.toMatch(/drop policy/);
  });
});

describe("tier-2 answers through an owner-checked RPC (D-13)", () => {
  it("checks ownership the way withdraw does and upserts one row per report", () => {
    const body = fn("submit_felt_report_details");
    expect(body).toContain(
      "if p_report_id is null or not public.owns_felt_report(p_report_id, p_device_id) then",
    );
    expect(body).toContain(
      "raise exception 'submit_felt_report_details: not_found' using errcode = '22023';",
    );
    expect(body).toContain(
      "if p_details is null or jsonb_typeof(p_details) <> 'object' then",
    );
    expect(body).toContain("on conflict (felt_report_id) do update");
    expect(body).toContain("coalesce(p_details -> 'raw_answers', p_details))");
    for (const column of [
      "situation",
      "felt_answer",
      "others_felt_answer",
      "motion_answer",
      "reaction_answer",
      "stand_answer",
      "shelf_answer",
      "picture_answer",
      "furniture_answer",
      "building_damage_level",
      "damage_typology",
      "road_damage_level",
    ]) {
      expect(body).toContain(`${column} = excluded.${column}`);
    }
    expect(sql).toContain(
      "grant execute on function public.submit_felt_report_details(uuid, text, jsonb) to anon, authenticated;",
    );
  });
});

describe("the People filter and the Government official rank", () => {
  it("accepts and orders the authority rank, body otherwise the 0055 one", () => {
    const body = fn("admin_people_search");
    expect(body).toContain(
      "'official', 'moderator', 'authority', 'seismologist', 'professor', 'researcher', 'engineer', 'partner') then",
    );
    expect(body).toContain(
      "array['official', 'moderator', 'authority', 'seismologist', 'professor',",
    );
    expect(body).toContain("public.has_permission(v_uid, 'people.view')");
    expect(sql).toContain(
      "grant execute on function public.admin_people_search(text, text, jsonb, text, jsonb, integer) to authenticated;",
    );
    // the same body as 0055 apart from the two rank lists
    const before = readCode("0055_social_p1_people_directory.sql");
    const original = functionSource(before, "admin_people_search")
      .replace(
        "'official', 'moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner') then",
        "'official', 'moderator', 'authority', 'seismologist', 'professor', 'researcher', 'engineer', 'partner') then",
      )
      .replace(
        "array['official', 'moderator', 'seismologist', 'professor',",
        "array['official', 'moderator', 'authority', 'seismologist', 'professor',",
      );
    expect(body).toBe(original);
  });
});
