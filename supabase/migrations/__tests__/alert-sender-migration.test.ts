import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0062 (the earthquake alert sender behind a
 * rollout switch, D83). The behaviour was exercised against a real Postgres
 * (PGlite: the gate, tiers and places, dedupe, revisions, the aftershock guard,
 * the hourly cap, summaries, retries, deletion); these pin the promises so
 * they cannot be edited away: the public gets nothing while the mode is
 * "testers", the default is "testers" and a re-run never flips a live mode,
 * the edge function takes no targeting input, no exact location is stored,
 * every table is closed to the app, and the paste rules hold.
 */
const raw = readMigration("0062_alert_sender.sql");
const sql = readCode("0062_alert_sender.sql");
const fn = (name: string) => functionSource(sql, name);

const TABLES = [
  "alert_settings",
  "alert_testers",
  "push_subscriptions",
  "alert_queue",
  "alert_runs",
  "alert_deliveries",
];

function tableBody(name: string): string {
  const start = sql.search(new RegExp(`create table if not exists public\\.${name}\\s*\\(`, "i"));
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf(");\n", start));
}

describe("0062 can be pasted into the SQL editor as one line", () => {
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
    expect(sql).not.toContain("?");
  });

  it("is idempotent", () => {
    expect(sql).not.toMatch(/create table (?!if not exists)/i);
    expect(sql).not.toMatch(/create (unique )?index (?!if not exists)/i);
    expect(sql).not.toMatch(/create function/i);
    for (const [trigger, table] of [
      ["notification_subscriptions_coarse", "notification_subscriptions"],
      ["events_alert_enqueue", "events"],
    ] as const) {
      expect(sql).toContain(`drop trigger if exists ${trigger} on public.${table};`);
    }
  });

  it("never uses CASE inside an IF condition (PL/pgSQL takes its THEN as the IF's)", () => {
    expect(sql).not.toMatch(/\bif\b[^;]*\bcase\b[^;]*\bthen\b/i);
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0062:/);
  });
});

describe("the rollout switch", () => {
  it("starts at testers and a re-run never changes a live setting", () => {
    expect(tableBody("alert_settings")).toMatch(/mode text not null default 'testers'/);
    expect(sql).toContain(
      "insert into public.alert_settings (key, mode) values ('rollout', 'testers') on conflict (key) do nothing;",
    );
    expect(sql).not.toMatch(/update public\.alert_settings/i);
  });

  it("the gate: testers mode means alerts.test or the allowlist; off means nobody", () => {
    const gate = fn("alert_user_eligible");
    expect(gate).toContain("when 'public' then p_user is not null");
    expect(gate).toContain("when 'testers' then public.alert_is_tester(p_user)");
    expect(gate).toContain("else false");
    const tester = fn("alert_is_tester");
    expect(tester).toContain("public.alert_testers");
    expect(tester).toContain("has_permission(p_user, 'alerts.test')");
  });

  it("the gate is applied when planning, again when claiming, and for summaries", () => {
    expect(fn("alert_plan_event")).toContain("public.alert_user_eligible(ps.user_id, p_mode)");
    expect(fn("alert_plan_summaries")).toContain("public.alert_user_eligible(ps.user_id, p_mode)");
    const run = fn("alert_plan_run");
    expect(run).toContain("not public.alert_user_eligible(ps.user_id, v_mode)");
    expect(run).toMatch(/if v_mode = 'off' then\s+update public\.alert_queue set processed_at = now\(\), outcome = 'off'/);
  });

  it("only the alerts.manage permission changes the mode or the testers, audited", () => {
    for (const name of ["admin_alerts_set_mode", "admin_alert_tester_add", "admin_alert_tester_remove"]) {
      expect(fn(name)).toContain("has_permission(v_uid, 'alerts.manage')");
      expect(fn(name)).toContain("perform public.write_audit(");
    }
    expect(fn("admin_alerts_overview")).toContain("has_permission(v_uid, 'alerts.test')");
  });

  it("alerts.test and alerts.manage go to official, and to admin only if the rank exists", () => {
    expect(sql).toContain("('official', 'alerts.test')");
    expect(sql).toContain("('official', 'alerts.manage')");
    expect(sql).toMatch(/pg_get_constraintdef\(oid\) like '%''admin''%'[\s\S]*\('admin', 'alerts\.test'\)/);
    expect(sql).not.toMatch(/\('moderator', 'alerts\./);
  });

  it("the log actions are rebuilt as a union with what is live", () => {
    expect(sql).toContain("'alerts_mode', 'alert_tester_add', 'alert_tester_remove'");
    expect(sql).toContain("v_actions := v_actions || v_found;");
    expect(sql).toContain("like '%comment_approve%'");
  });
});

describe("what alerts", () => {
  it("only confirmed events: published, not merged or deleted, a verified source", () => {
    const confirmed = fn("alert_event_confirmed");
    expect(confirmed).toContain("e.status = 'published'");
    expect(confirmed).toContain("e.merged_into is null");
    expect(confirmed).toContain("e.review_status <> 'deleted'");
    expect(confirmed).toContain("esr.verified_at is not null");
    expect(fn("alert_plan_run")).toContain("if not public.alert_event_confirmed(q.event_id) then");
  });

  it("the trigger queues recent regional published events only, and never breaks ingestion", () => {
    const trigger = fn("events_alert_enqueue");
    expect(trigger).toContain("new.status = 'published'");
    expect(trigger).toContain("new.region_flag");
    expect(trigger).toContain("new.origin_time > now() - interval '6 hours'");
    expect(trigger).toMatch(/exception when others then\s+raise warning/);
  });

  it("near = 100 km or predicted felt (AWW2012 MMI >= 2.0, depth default 10 km)", () => {
    const context = fn("alert_context_min");
    expect(context).toContain("if v_km <= 100 then");
    expect(context).toContain("public.ipe_aww2012_mmi(");
    expect(context).toContain("coalesce(p_depth_km, 10)");
    expect(context).toContain(">= 2.0 then");
  });

  it("tiers: all, M3, M4, M5; revisions re-alert only across 3, 4 and 5", () => {
    expect(fn("alert_tier_min")).toContain("when 'all' then 0 when 'm3' then 3 when 'm4' then 4 when 'm5' then 5 else null");
    expect(fn("alert_band")).toContain("(p_magnitude >= 3)::int + (p_magnitude >= 4)::int + (p_magnitude >= 5)::int");
    expect(fn("alert_plan_event")).toContain("if v_prev is not null and v_band <= v_prev then");
  });

  it("one alert per event per device, enforced by a unique index", () => {
    expect(sql).toContain(
      "create unique index if not exists alert_deliveries_once_idx\n  on public.alert_deliveries (push_subscription_id, event_id, mag_band)\n  where kind in ('alert', 'upgrade');",
    );
  });

  it("D16: aftershock guard, 3 an hour except a new mainshock, 12 h summaries", () => {
    const plan = fn("alert_plan_event");
    expect(plan).toContain("m.magnitude >= 5.0");
    expect(plan).toContain("m.origin_time >= ev.origin_time - interval '72 hours'");
    expect(plan).toContain("ev.magnitude < greatest(v_main - 0.5, v_floor + 1.0)");
    expect(plan).toContain("if v_recent >= 3 then");
    expect(plan).toContain("v_new_main := ev.magnitude >= 5.0 and (v_main is null or ev.magnitude >= v_main);");
    expect(fn("alert_plan_summaries")).toContain("having min(d.created_at) <= now() - interval '12 hours'");
  });

  it("first alerts within 60 minutes, upgrades within 6 hours", () => {
    const plan = fn("alert_plan_event");
    expect(plan).toContain("if v_kind = 'alert' and v_age > interval '60 minutes' then");
    expect(plan).toContain("if v_age > interval '6 hours' then");
  });
});

describe("privacy and access", () => {
  it("every new table has RLS on, no policy, and is closed to anon and authenticated", () => {
    expect(createdTables(sql).sort()).toEqual([...TABLES].sort());
    for (const table of TABLES) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`revoke all on public.${table} from public, anon, authenticated;`);
      expect(sql).not.toMatch(new RegExp(`create policy \\w+\\s+on public\\.${table}`, "i"));
    }
  });

  it("no new table has a place column; stored points are snapped to 0.05 degree", () => {
    for (const table of TABLES) {
      expect(tableBody(table)).not.toMatch(/\b(lat|lon|latitude|longitude|geohash|geom|location|accuracy)\b/i);
    }
    const coarse = fn("notification_subscriptions_coarse");
    for (const column of ["near_me_lat", "near_me_lon", "homebase_lat", "homebase_lon"]) {
      expect(coarse).toContain(`new.${column} := (round((new.${column} * 20)::numeric) / 20)::double precision;`);
    }
    expect(sql).toContain("before insert or update on public.notification_subscriptions");
  });

  it("devices cascade with the account; the shape of a web or Expo device is enforced", () => {
    const body = tableBody("push_subscriptions");
    expect(body).toContain("user_id uuid not null references auth.users (id) on delete cascade");
    expect(body).toContain("endpoint text unique");
    expect(body).toContain("expo_token text unique");
    expect(tableBody("alert_deliveries")).toContain(
      "references public.push_subscriptions (push_subscription_id) on delete cascade",
    );
  });

  it("only known push services are accepted as endpoints", () => {
    const register = fn("alerts_register_web_push");
    expect(register).toContain("fcm\\.googleapis\\.com");
    expect(register).toContain("push\\.apple\\.com");
    expect(register).toContain("notify\\.windows\\.com");
    expect(register).toContain("push\\.services\\.mozilla\\.com");
    expect(register).toMatch(/p_endpoint !~ '\^https:\/\//);
  });

  it("app RPCs: authenticated only; the sender's two functions: service role only", () => {
    const app = [
      "alerts_my_access()",
      "alerts_register_web_push(text, text, text, text)",
      "alerts_register_expo_push(text, text)",
      "alerts_unregister_push(text, text)",
      "alerts_my_devices()",
      "alerts_send_test()",
      "admin_alerts_overview()",
      "admin_alerts_set_mode(text)",
      "admin_alert_tester_add(text)",
      "admin_alert_tester_remove(uuid)",
    ];
    for (const signature of app) {
      expect(sql).toContain(`revoke all on function public.${signature} from public, anon;`);
      expect(sql).toContain(`grant execute on function public.${signature} to authenticated;`);
    }
    for (const signature of ["alert_plan_run(integer)", "alert_record_results(uuid, jsonb)"]) {
      expect(sql).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${signature} to service_role;`);
      expect(sql).not.toContain(`grant execute on function public.${signature} to authenticated;`);
    }
  });

  it("every function is either revoked from the app roles or explicitly granted", () => {
    for (const name of createdFunctions(sql)) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\(`));
    }
  });

  it("every security definer function pins its search_path", () => {
    const blocks = sql.split(/create or replace function /i).slice(1);
    for (const block of blocks) {
      const header = block.slice(0, block.indexOf("$$"));
      if (/security definer/i.test(header)) {
        expect(header).toMatch(/set search_path = public, pg_temp/);
      }
    }
  });

  it("the test alert goes to the caller's own devices only, rate limited", () => {
    const test = fn("alerts_send_test");
    expect(test).toContain("insert into public.alert_queue (kind, user_id) values ('test', v_uid);");
    expect(test).toContain("interval '60 seconds'");
    expect(fn("alert_plan_run")).toContain("where ps.user_id = q.user_id and ps.disabled_at is null;");
  });
});

describe("the schedule", () => {
  it("calls send-alerts every minute only when there is work, with the publishable key", () => {
    expect(sql).toContain("perform cron.schedule('send_alerts', '* * * * *'");
    expect(sql).toContain("/functions/v1/send-alerts', body := '{}'::jsonb");
    expect(sql).toContain("WHERE public.alert_work_pending();");
    expect(sql).toContain("sb_publishable_");
    expect(sql).not.toMatch(/service_role_key|sb_secret_|eyJ[A-Za-z0-9]/);
  });

  it("keeps 90 days", () => {
    expect(fn("alert_purge_old")).toContain("interval '90 days'");
    expect(sql).toContain("perform cron.schedule('alert_purge', '40 4 * * *'");
  });
});
