import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0070 (the feed watchdog watches usgs, emsc,
 * geofon and isc, pushes a new alert to the admins through the alert sender,
 * and the admin home reads every source's state). Pasted into the SQL editor
 * as one line, so the paste rules are pinned; so are the promises: one
 * threshold per channel in one place, a push only when an alert opens and at
 * most one per device per hour, only to stats.read accounts, nothing callable
 * by the app except the stats.read status read. The behaviour was exercised
 * against a real Postgres (PGlite: 0001-0069 then 0070 twice, 42 checks; the
 * 0068 alert-sender proof again on top, 43 checks) when it was written; these
 * keep it from being edited away.
 */
const raw = readMigration("0070_feed_watchdog_all_sources.sql");
const sql = readCode("0070_feed_watchdog_all_sources.sql");
const fn = (name: string) => functionSource(sql, name);

describe("0070 can be pasted into the SQL editor as one line", () => {
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
    expect(sql).not.toMatch(/create table/i);
    expect(sql).not.toMatch(/create (unique )?index (?!if not exists)/i);
    expect(sql).not.toMatch(/create function/i);
    // the kind check is found by its definition and dropped before it is added
    expect(sql).toContain("pg_get_constraintdef(oid) like '%''summary''%'");
    expect(sql).toContain(
      "execute format('alter table public.alert_deliveries drop constraint %I', c.conname);",
    );
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0070:/);
    expect(raw).toContain("DEPLOY send-alerts BEFORE applying this file");
  });

  it("creates no table and exactly these functions, each security definer with a fixed path", () => {
    expect(createdTables(sql)).toEqual([]);
    expect(createdFunctions(sql).sort()).toEqual(
      ["admin_source_status", "ops_check_feeds", "ops_feed_threshold", "ops_notify_admins"].sort(),
    );
    for (const name of ["admin_source_status", "ops_check_feeds", "ops_notify_admins"]) {
      expect(fn(name)).toContain("security definer");
      expect(fn(name)).toContain("set search_path = public, pg_temp");
    }
  });
});

describe("every ingest channel is watched", () => {
  it("one threshold per channel: an hour for the polled feeds, 49 hours for the daily ISC run", () => {
    const body = fn("ops_feed_threshold");
    expect(body).toContain("when 'isc' then interval '49 hours'");
    expect(body).toContain("else interval '60 minutes'");
  });

  it("watches usgs, emsc, geofon and isc, opens once and closes on recovery", () => {
    const body = fn("ops_check_feeds");
    expect(body).toContain("foreach v_provider in array array['usgs', 'emsc', 'geofon', 'isc'] loop");
    expect(body).toContain("v_threshold := public.ops_feed_threshold(v_provider);");
    expect(body).toContain("v_stale := v_last is null or v_last < now() - v_threshold;");
    expect(body).toContain("if v_stale and v_open is null then");
    expect(body).toContain("elsif not v_stale and v_open is not null then");
    expect(body).toContain("set closed_at = now(),");
    expect(sql).toContain(
      "revoke all on function public.ops_check_feeds() from public, anon, authenticated;",
    );
    expect(sql).not.toMatch(/grant execute on function public\.ops_check_feeds/);
  });

  it("pushes only when an alert opens, and a push failure never loses the alert", () => {
    const body = fn("ops_check_feeds");
    expect(body).toContain("if v_opened > 0 then");
    expect(body).toMatch(
      /begin\s+v_pushed := public\.ops_notify_admins\(\);\s+exception when others then\s+v_pushed := -1;\s+end;/,
    );
  });

  it("matches the channels ingest-events writes heartbeats for", () => {
    const channels = readMigration("../functions/ingest-events/channels.ts");
    for (const provider of ["usgs", "emsc", "geofon", "isc"]) {
      expect(channels).toContain(`provider: "${provider}"`);
    }
  });
});

describe("the admin push rides the alert sender (no new secret)", () => {
  it("allows the delivery kind 'ops' next to the earthquake kinds", () => {
    expect(sql).toContain(
      "check (kind in ('alert', 'upgrade', 'summary', 'test', 'ops'));",
    );
  });

  it("queues one pending delivery per active device of a stats.read account, at most hourly", () => {
    const body = fn("ops_notify_admins");
    expect(body).toContain("select ps.push_subscription_id, 'ops', 'pending'");
    expect(body).toContain("where ps.disabled_at is null");
    expect(body).toContain("public.has_permission(ps.user_id, 'stats.read')");
    expect(body).toContain("and d.created_at > now() - interval '60 minutes'");
    expect(sql).toContain(
      "revoke all on function public.ops_notify_admins() from public, anon, authenticated;",
    );
  });

  it("the sender knows the kind (send-alerts is deployed first)", () => {
    const plan = readMigration("../functions/send-alerts/plan.ts");
    expect(plan).toContain('"ops"');
  });
});

describe("admin_source_status", () => {
  it("is for the statistics ranks only", () => {
    const body = fn("admin_source_status");
    expect(body).toContain("public.has_permission(v_uid, 'stats.read')");
    expect(body).toContain(
      "raise exception 'admin_source_status: not_allowed' using errcode = '42501';",
    );
    expect(sql).toContain("revoke all on function public.admin_source_status() from public, anon;");
    expect(sql).toContain(
      "grant execute on function public.admin_source_status() to authenticated;",
    );
  });

  it("returns every source in feed order with its threshold, lateness and open alert", () => {
    const body = fn("admin_source_status");
    expect(body).toContain(
      "from (values ('usgs', 1), ('emsc', 2), ('geofon', 3), ('isc', 4)) as p(provider, ord)",
    );
    for (const key of [
      "'provider'",
      "'last_ok_at'",
      "'last_error_at'",
      "'last_error', left(h.last_error, 200)",
      "'threshold_minutes'",
      "'late', h.last_ok_at is null or h.last_ok_at < now() - public.ops_feed_threshold(p.provider)",
      "'alert_opened_at'",
      "'open_alerts'",
    ]) {
      expect(body).toContain(key);
    }
  });
});
