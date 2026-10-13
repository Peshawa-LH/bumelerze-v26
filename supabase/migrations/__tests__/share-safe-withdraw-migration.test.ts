import {
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0064 ("I'm safe" told inside the app, and
 * withdrawing a felt report). Pasted into the SQL editor as one line, so the
 * paste rules are pinned; so are the promises: a check-in carries no place,
 * reaches only the people the sender chose (family, mutual follows or
 * followers; never across a block, never a suspended reader or a guest), is
 * one per earthquake, goes after 30 days and pushes nothing yet; a withdrawn
 * report leaves every public or personal count, map, photo and comment, but
 * stays for admins and in the person's own export. The behaviour was
 * exercised against a real Postgres (PGlite: 0035-0063 then 0064 twice, 102
 * checks; the 0063 suite again on top of 0064; an upgrade with 0057 check-ins
 * already in place) when it was written; these keep it from being edited
 * away.
 */
const raw = readMigration("0064_share_safe_withdraw.sql");
const sql = readCode("0064_share_safe_withdraw.sql");
const fn = (name: string) => functionSource(sql, name);

function tableBody(name: string): string {
  const start = sql.search(
    new RegExp(`create table if not exists public\\.${name}\\s*\\(`, "i"),
  );
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf(");", start));
}

describe("0064 can be pasted into the SQL editor as one line", () => {
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
    expect(sql).not.toMatch(/add column (?!if not exists)/i);
    for (const [policy, table] of [
      ["felt_photos_select_approved", "felt_photos"],
      ["felt_comments_select_approved", "felt_comments"],
      ["felt_cells_public_select", "felt_cells"],
    ] as const) {
      expect(sql).toContain(`drop policy if exists ${policy} on public.${table};`);
    }
    expect(sql).toContain(
      "drop trigger if exists activity_on_checkins on public.safety_checkins;",
    );
    expect(sql).toContain(
      "alter table public.safety_checkins drop constraint if exists safety_checkins_target_check;",
    );
    // changed signatures and return shapes are dropped first, exactly
    for (const signature of [
      "public.check_in(uuid, uuid, timestamptz)",
      "public.my_activity(integer, timestamptz)",
      "public.admin_felt_photo_queue(text, timestamptz, integer)",
    ]) {
      expect(sql).toContain(`drop function if exists ${signature};`);
    }
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0064:/);
  });

  it("grows the activity kinds as a union (0062 and 0063 kinds stay)", () => {
    const call = sql.slice(
      sql.indexOf("'public.activity_items'::regclass, '%new_follower%'"),
    );
    expect(call.slice(0, 200)).toContain("'safe_checkin'");
    expect(sql).not.toMatch(/add constraint activity_items_kind_check/i);
  });
});

describe("I'm safe reaches chosen people in the app", () => {
  it("keeps the setting in a closed table, without any place, defaulting to mutual follows", () => {
    expect(createdTables(sql)).toEqual(["safety_settings"]);
    const body = tableBody("safety_settings");
    expect(body).toContain("references auth.users (id) on delete cascade");
    expect(body).toContain("check (audience in ('family', 'mutual', 'followers'))");
    expect(body).not.toMatch(/\b(lat|lon|geohash|device|coord)/i);
    expect(sql).toContain(
      "alter table public.safety_settings enable row level security;",
    );
    expect(sql).toContain(
      "revoke all on public.safety_settings from public, anon, authenticated;",
    );
    expect(fn("safe_audience_of")).toContain("'mutual')");
  });

  it("adds no place to a check-in: only the report it may be tied to", () => {
    const added = [
      ...sql.matchAll(
        /alter table public\.safety_checkins add column if not exists (\w+)/g,
      ),
    ].map((m) => m[1]);
    expect(added).toEqual(["report_id"]);
    expect(sql).toContain(
      "check (status = 'retracted' or event_id is not null or report_id is not null)",
    );
  });

  it("names its readers by the family rules of 0057 and the follow rules of the brief", () => {
    const r = fn("safe_recipients");
    // family: approved members of an active home the sender shares with,
    // approved before the check-in, no block
    expect(r).toContain("t.status = 'active'");
    expect(r).toContain("me.share_checkins");
    expect(r).toContain("coalesce(reader.decided_at, reader.requested_at) <= p_at");
    // follows: accepted only, both ways for mutual, no block, no suspended
    // reader, no guest; a family member is told once, as family
    expect(r).toContain("f.status = 'accepted'");
    expect(r).toContain("b.status = 'accepted'");
    expect(r.match(/not public\.blocked_between/g)?.length).toBe(2);
    expect(r).toContain("not public.is_suspended(f.follower_id)");
    expect(r).toContain("not coalesce(u.is_anonymous, false)");
    expect(r).toContain("not exists (select 1 from fam where fam.user_id = fol.user_id)");
    expect(r).toContain("public.safe_audience_of(p_user) <> 'family'");
  });

  it("lets only accounts read and change the choice", () => {
    for (const name of ["my_safe_audience", "set_safe_audience"]) {
      expect(fn(name)).toContain("raise exception '" + name + ": not_account'");
    }
    expect(fn("set_safe_audience")).toContain(
      "p_audience not in ('family', 'mutual', 'followers')",
    );
  });

  it("takes a felt report as the anchor: the caller's, live and under 24 hours", () => {
    const c = fn("check_in");
    expect(c).toContain("p_report_id uuid default null");
    expect(c).toContain(
      "where r.report_id = p_report_id and r.user_id = v_uid and r.withdrawn_at is null",
    );
    expect(c).toContain(
      "raise exception 'check_in: report_not_found' using errcode = 'P0002'",
    );
    expect(c).toContain("v_report_at < now() - interval '24 hours'");
    // without a report the 0057 rule stands
    expect(c).toContain("v_origin < now() - interval '72 hours'");
    expect(c).toContain("raise exception 'check_in: not_account'");
  });

  it("keeps one check-in per earthquake (or report): a new tap moves the time", () => {
    const c = fn("check_in");
    expect(c).toContain("v_repeat := true;");
    expect(c).toContain("checked_in_at = greatest(checked_in_at, v_at)");
    expect(c).toContain("if v_recent >= 10 then");
    expect(c).toContain("'told'");
    const t = fn("activity_on_checkins");
    expect(t).toContain(
      "set meta = meta || jsonb_build_object('checked_in_at', new.checked_in_at)",
    );
    expect(t).not.toMatch(/read_at\s*=/);
    expect(sql).toContain(
      "after insert or update of status, checked_in_at on public.safety_checkins",
    );
  });

  it("tells family as family_safe and everyone else as safe_checkin, and takes both back", () => {
    const t = fn("activity_on_checkins");
    expect(t).toContain("public.safe_recipients(new.user_id, new.created_at)");
    expect(t).toContain("'family_safe', new.user_id, v_key");
    expect(t).toContain("'safe_checkin', new.user_id, v_key");
    expect(t).toContain("where kind in ('family_safe', 'safe_checkin')");
    // 0061's key for an earthquake, so older rows are still taken back
    expect(t).toContain("coalesce(new.event_id::text, 'r:' || new.report_id::text)");
  });

  it("pushes nothing yet, but marks where the push goes (D83)", () => {
    expect(raw).toContain("PUSH HOOK (D83)");
    expect(sql).not.toMatch(/net\.http_post|send-alerts|push_subscriptions|alert_queue/);
  });

  it("shows a suspended sender's check-in (D81) but not one from a muted person, and only for 30 days", () => {
    const v = fn("activity_visible");
    expect(v).toContain(
      "and (a.kind = 'safe_checkin' or not public.is_suspended(a.actor_id))",
    );
    expect(v).toContain(
      "(a.kind not in ('family_safe', 'safe_checkin') or a.created_at > now() - interval '30 days')",
    );
    const p = fn("purge_safety_checkins");
    expect(p).toContain(
      "where kind in ('family_safe', 'safe_checkin') and created_at < now() - interval '30 days'",
    );
  });

  it("reads report-only check-ins on the family card, and gives the times to the list", () => {
    expect(fn("family_checkins")).toContain(
      "left join public.events e0 on e0.event_id = c.event_id",
    );
    const a = fn("my_activity");
    expect(a).toContain("event_time timestamptz");
    expect(a).toContain("coalesce(e.origin_time, (a.meta ->> 'felt_at')::timestamptz)");
  });
});

describe("withdrawing a felt report", () => {
  it("is a soft delete with who and when", () => {
    expect(sql).toContain(
      "alter table public.felt_reports add column if not exists withdrawn_at timestamptz;",
    );
    expect(sql).toContain(
      "add column if not exists withdrawn_by uuid references auth.users (id) on delete set null;",
    );
    expect(sql).not.toMatch(/delete from public\.felt_reports/i);
  });

  it("is done by the owner only: the account, or the phone with its report and device id", () => {
    const o = fn("owns_felt_report");
    expect(o).toContain("r.user_id = auth.uid()");
    expect(o).toContain("char_length(p_device_id) >= 8 and r.device_id = p_device_id");
    for (const name of ["withdraw_felt_report", "restore_felt_report"]) {
      expect(fn(name)).toContain("not public.owns_felt_report(p_report_id, p_device_id)");
    }
    expect(fn("restore_felt_report")).toContain("interval '10 minutes'");
    // the aggregation sweep finds a restore by its time
    expect(fn("restore_felt_report")).toContain("restored_at = now()");
    expect(fn("restore_felt_report")).toContain(
      "raise exception 'restore_felt_report: conflict'",
    );
  });

  it("lets the same phone report the same earthquake again", () => {
    expect(sql).toContain("drop index if exists public.felt_reports_device_event_uq;");
    expect(sql).toContain("where event_id is not null and withdrawn_at is null;");
  });

  it("leaves withdrawn reports out of every public or personal reader", () => {
    for (const name of [
      "existing_report_ids",
      "event_hub_summary",
      "my_stats",
      "public_profile",
      "surge_state",
      "assign_unassigned_felt_reports",
      "detect_possible_events",
      "merge_possible_event",
      "event_comments_before_insert",
    ]) {
      expect([name, fn(name)]).toEqual([
        name,
        expect.stringContaining("withdrawn_at is null"),
      ]);
    }
    expect(fn("event_hub_summary").match(/withdrawn_at is null/g)?.length).toBe(4);
    expect(fn("detect_possible_events").match(/withdrawn_at is null/g)?.length).toBe(2);
  });

  it("hides the photos and comments of a withdrawn report from the public", () => {
    expect(fn("felt_report_is_live")).toContain("r.withdrawn_at is null");
    for (const table of ["felt_photos", "felt_comments"]) {
      const policy = sql.slice(sql.indexOf(`create policy ${table}_select_approved`));
      expect(policy.slice(0, 250)).toContain(
        "using (moderation_status = 'approved' and public.felt_report_is_live(report_id))",
      );
    }
  });

  it("makes a felt-map cell public in its latest version only", () => {
    expect(sql).toContain(
      "using (n_reports >= 3 and public.felt_cell_is_latest(event_id, geohash, version))",
    );
    const view = sql.slice(
      sql.indexOf("create or replace view public.felt_cells_public"),
    );
    expect(view).toMatch(
      /^create or replace view public\.felt_cells_public with \(security_invoker = on\)/,
    );
    expect(
      view.indexOf("order by fc.event_id, fc.geohash, fc.version desc"),
    ).toBeLessThan(view.indexOf("where x.n_reports >= 3"));
  });

  it("keeps them for admins, marked", () => {
    expect(fn("admin_person")).toContain("'withdrawn_at', r.withdrawn_at");
    expect(fn("admin_felt_photo_queue")).toContain("report_withdrawn_at timestamptz");
    expect(fn("admin_felt_photo_queue")).toContain(
      "has_permission(auth.uid(), 'photos.moderate')",
    );
  });
});

describe("download my data", () => {
  it("wraps the 0063 export instead of replacing it, and adds the setting and check-ins", () => {
    expect(sql).toContain(
      "alter function public.export_my_data() rename to export_my_data_0063;",
    );
    expect(sql).toContain("p.prosrc like '%export_my_data_0063%'");
    const wrapper = fn("export_my_data");
    expect(wrapper).toContain("return public.export_my_data_0063()");
    for (const key of ["'safe_settings'", "'checkins'", "'report_id', sc.report_id"]) {
      expect(wrapper).toContain(key);
    }
    expect(sql).toContain(
      "revoke all on function public.export_my_data_0063() from public, anon, authenticated;",
    );
  });
});

describe("who may call what", () => {
  it("keeps the internal helpers away from every client role", () => {
    for (const signature of [
      "safe_audience_of(uuid)",
      "safe_recipients(uuid, timestamptz)",
      "safe_audience_counts(uuid)",
      "activity_on_checkins()",
      "activity_visible(uuid)",
      "owns_felt_report(uuid, text)",
      "purge_safety_checkins()",
    ]) {
      expect(sql).toContain(
        `revoke all on function public.${signature} from public, anon, authenticated;`,
      );
      expect(sql).not.toMatch(
        new RegExp(
          `grant execute on function public\\.${signature.replace(/[()]/g, "\\$&")} to (anon|authenticated)`,
        ),
      );
    }
  });

  it("opens withdraw and Undo to guests too (they own their reports)", () => {
    for (const name of [
      "withdraw_felt_report(uuid, text)",
      "restore_felt_report(uuid, text)",
    ]) {
      expect(sql).toContain(
        `grant execute on function public.${name} to anon, authenticated;`,
      );
    }
  });

  it("keeps the check-in and the setting for signed-in people", () => {
    for (const name of [
      "check_in(uuid, uuid, timestamptz, uuid)",
      "my_safe_audience()",
      "set_safe_audience(text)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${name} from public, anon;`);
      expect(sql).toContain(`grant execute on function public.${name} to authenticated;`);
    }
  });

  it("runs every new function as its owner with a fixed search path", () => {
    const created = [
      ...sql.matchAll(/create or replace function public\.(\w+)\s*\(/g),
    ].map((m) => m[1] as string);
    expect(created.length).toBeGreaterThan(25);
    for (const name of created) {
      const source = fn(name);
      expect([name, source]).toEqual([
        name,
        expect.stringMatching(/set search_path = public/),
      ]);
    }
  });
});
