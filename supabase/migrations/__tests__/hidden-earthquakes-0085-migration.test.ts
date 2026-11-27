import { readdirSync } from "fs";
import { join } from "path";

import { createdFunctions, functionSource, readCode, readMigration } from "../sql-test-utils";

/**
 * Static checks of migration 0085 (pre-launch checklist B2.6 stage 2): hide
 * an earthquake. Exercised against PGlite when it was written (live order
 * 0001-0075, 0077-0083, 0076, 0084, then 0085 twice in its one-line form,
 * 131 checks; the 0073, 0074, 0076, 0077, 0078, 0079, 0083 and 0084 suites
 * again on a chain ending in 0085, results identical to the chain ending in
 * 0084):
 * only the admin rank in a two-step session may list, search, hide or show
 * again (guests, plain accounts, moderators, officials and an admin without
 * two-step get 42501); every bad input answers 22023 with its name; a
 * duplicate hide moves live felt reports and safe check-ins to the card that
 * stays except for a person already there, records them, and Show again
 * moves back exactly those still there, skipping a clash; a hide takes the
 * earthquake off Home; home_extras() lists every hidden earthquake and never
 * pins one; a hidden earthquake starts no SHAKEmap run, no alert and no busy
 * time, gets no assigned report, and a new report naming it goes to the card
 * that stays (or loses its link when removed); moved felt maps are rebuilt
 * through the per-event call. These keep it from being edited away.
 */
const FILE = "0085_hidden_earthquakes.sql";
const raw = readMigration(FILE);
const sql = readCode(FILE);
const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const line = flat(sql);
const fn = (name: string) => flat(functionSource(sql, name));

const ADMIN_FUNCTIONS = [
  "admin_hidden_events",
  "admin_hide_find_events",
  "admin_hide_candidates",
  "admin_hide_impact",
  "admin_hide_event",
  "admin_unhide_event",
];

const HIDDEN = (alias: string) =>
  `not exists (select 1 from public.hidden_events h where h.event_id = ${alias})`;

/** Every function 0085 replaces, and exactly what it adds to the live body. */
const REPLACED: Record<string, { from: string; added: string[] }> = {
  home_extras: {
    from: "0084_home_screen_tools.sql",
    added: [
      ` and ${HIDDEN("p.event_id")}`,
      ", 'hidden', coalesce(( select jsonb_agg(jsonb_build_object( 'bumelerze_id', e.bumelerze_id, 'provider_ids', public.event_provider_ids(h.event_id), 'reason_kind', case when h.reason = 'duplicate' then 'duplicate' else 'removed' end, 'kept', case when h.reason = 'duplicate' and k.event_id is not null then jsonb_build_object( 'bumelerze_id', k.bumelerze_id, 'provider_ids', public.event_provider_ids(k.event_id)) end) order by h.hidden_at desc, h.event_id) from public.hidden_events h join public.events e on e.event_id = h.event_id left join public.events k on k.event_id = h.kept_event_id), '[]'::jsonb)",
    ],
  },
  admin_tool_counts: {
    from: "0066_admin_authority.sql",
    added: [
      " if public.has_permission(v_uid, 'events.hide') then v_out := v_out || jsonb_build_object('hidden_events', (select count(*) from public.hidden_events h)); end if;",
    ],
  },
  admin_pin_home_event: {
    from: "0084_home_screen_tools.sql",
    added: [` and ${HIDDEN("e.event_id")}`],
  },
  events_request_shake_worker: {
    from: "0077_events_and_public_data.sql",
    added: [" or exists (select 1 from public.hidden_events h where h.event_id = new.event_id)"],
  },
  events_alert_enqueue: {
    from: "0062_alert_sender.sql",
    added: [` and ${HIDDEN("new.event_id")}`],
  },
  alert_event_confirmed: {
    from: "0062_alert_sender.sql",
    added: [` and ${HIDDEN("e.event_id")}`],
  },
  alert_plan_event: {
    from: "0062_alert_sender.sql",
    added: [` and ${HIDDEN("m.event_id")}`],
  },
  alert_plan_run: {
    from: "0062_alert_sender.sql",
    added: [
      ` and ${HIDDEN("e.event_id")}`,
      " update public.alert_deliveries d set status = 'skipped' where d.kind in ('alert', 'upgrade') and (d.status in ('pending', 'retry') or (d.status = 'suppressed' and d.summarized_by is null)) and exists (select 1 from public.hidden_events h where h.event_id = d.event_id);",
    ],
  },
  surge_state: {
    from: "0077_events_and_public_data.sql",
    added: [` and ${HIDDEN("e.event_id")}`],
  },
  assign_unassigned_felt_reports: {
    from: "0064_share_safe_withdraw.sql",
    added: [` and ${HIDDEN("e.event_id")}`],
  },
  crowd_match_ok: {
    from: "0034_crowd_detection_v2.sql",
    added: [` and ${HIDDEN("p_target")}`],
  },
  felt_reports_server_times: {
    from: "0077_events_and_public_data.sql",
    added: [
      " v_hidden_reason text; v_kept uuid;",
      " for v_hop in 1..3 loop exit when v_target is null; select h.reason, h.kept_event_id into v_hidden_reason, v_kept from public.hidden_events h where h.event_id = v_target; exit when not found; if v_hidden_reason = 'duplicate' and v_hop < 3 then select e.event_id, e.status, e.review_status, e.magnitude, e.origin_time into v_target, v_status, v_review, v_magnitude, v_origin from public.events e where e.event_id = v_kept; else v_target := null; end if; end loop;",
    ],
  },
};

function migrationFiles(): string[] {
  return readdirSync(join(__dirname, ".."))
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && !f.startsWith("0041_"))
    .sort();
}

/** The last definition of a function in the files before 0085. */
function latestBefore(name: string): { file: string; text: string } {
  let found: { file: string; text: string } | null = null;
  for (const file of migrationFiles().filter((f) => f < FILE)) {
    const code = readCode(file);
    if (new RegExp(`create or replace function public\\.${name}\\s*\\(`, "i").test(code)) {
      found = { file, text: flat(functionSource(code, name)) };
    }
  }
  if (!found) {
    throw new Error(`function ${name} not defined before ${FILE}`);
  }
  return found;
}

describe("0085 can be pasted into the SQL editor as one line", () => {
  it("has no transaction statements, only full-line comments, ASCII, no question marks", () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    for (const text of sql.split("\n")) {
      expect(text).not.toContain("--");
    }
    expect(raw).not.toMatch(/[^\x00-\x7f]/);
    expect(raw).not.toContain("?");
    expect(raw).not.toContain("/*");
    expect(raw.split("\n")[0]).toMatch(/^-- 0085:/);
  });

  it("is idempotent", () => {
    for (const table of ["hidden_events", "hidden_event_moves", "felt_cells_refresh"]) {
      expect(sql).toContain(`create table if not exists public.${table} (`);
    }
    expect(sql).not.toMatch(/create (unique )?index (?!if not exists)/i);
    expect(line).toContain(
      "insert into public.role_permissions (role, permission) values ('admin', 'events.hide') on conflict do nothing;",
    );
    expect(sql).not.toMatch(/create function /i);
    expect(sql).not.toMatch(/create policy /i);
    expect(sql).not.toMatch(/create trigger /i);
  });

  it("ends with a check that fails the whole paste when a part is missing", () => {
    expect(line).toContain("raise exception '0085: not in place: %'");
    for (const name of Object.keys(REPLACED)) {
      expect(line).toContain(`'${name}'`);
    }
  });
});

describe("the three tables", () => {
  it("are closed to clients, with row level security on", () => {
    for (const table of ["hidden_events", "hidden_event_moves", "felt_cells_refresh"]) {
      expect(line).toContain(`alter table public.${table} enable row level security;`);
      expect(line).toContain(`revoke all on public.${table} from public, anon, authenticated;`);
    }
  });

  it("hold one row per hidden earthquake with a reason, a kept card only for a duplicate, a short note", () => {
    expect(line).toContain(
      "event_id uuid primary key references public.events (event_id) on delete cascade",
    );
    expect(line).toContain("check (reason in ('duplicate', 'not_real', 'other'))");
    expect(line).toContain("check ((reason = 'duplicate') = (kept_event_id is not null))");
    expect(line).toContain("check (kept_event_id <> event_id)");
    expect(line).toContain("check (note is null or char_length(note) between 1 and 200)");
    expect(line).toContain("check (reason <> 'other' or note is not null)");
    expect(line).toContain("hidden_by uuid references auth.users (id) on delete set null");
  });

  it("record each moved row once per hide, and lose the record with the row", () => {
    expect(line).toContain(
      "report_id uuid references public.felt_reports (report_id) on delete cascade",
    );
    expect(line).toContain(
      "checkin_id uuid references public.safety_checkins (checkin_id) on delete cascade",
    );
    expect(line).toContain("check (num_nonnulls(report_id, checkin_id) = 1)");
    expect(line).toContain(
      "hidden_event_id uuid not null references public.hidden_events (event_id) on delete cascade",
    );
  });
});

describe("the permission and the activity log", () => {
  it("gives events.hide to the admin rank only (owner choice 1)", () => {
    expect(line).not.toMatch(/\('(official|moderator|authority)', 'events\.hide'\)/);
  });

  it("adds event_hide and event_unhide to the live action list", () => {
    expect(line).toContain("v_actions text[] := array['event_hide', 'event_unhide'];");
    expect(line).toContain("pg_get_constraintdef(oid) like '%comment_approve%'");
  });
});

describe("the admin functions", () => {
  it.each(ADMIN_FUNCTIONS)("%s needs events.hide (two-step since 0076)", (name) => {
    const body = fn(name);
    expect(body).toContain(
      "if v_uid is null or not public.has_permission(v_uid, 'events.hide') then",
    );
    expect(body).toContain(`raise exception '${name}: not_allowed' using errcode = '42501';`);
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public, pg_temp");
  });

  it.each(ADMIN_FUNCTIONS)("%s is for signed-in callers only", (name) => {
    expect(line).toMatch(
      new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon;`),
    );
    expect(line).toMatch(
      new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated;`),
    );
  });

  it("hide refuses every bad input with its own name (22023)", () => {
    const hide = fn("admin_hide_event");
    for (const code of [
      "bad_reason",
      "event_not_found",
      "already_hidden",
      "kept_required",
      "kept_is_same",
      "kept_not_found",
      "kept_hidden",
      "note_required",
      "note_too_long",
    ]) {
      expect(hide).toContain(`raise exception 'admin_hide_event: ${code}' using errcode = '22023';`);
    }
    expect(hide).toContain("v_note text := public.home_notice_clean(p_note);");
    expect(hide).toContain("perform pg_advisory_xact_lock(hashtext('hidden_events'));");
    expect(fn("admin_unhide_event")).toContain(
      "raise exception 'admin_unhide_event: not_hidden' using errcode = '22023';",
    );
  });

  it("a hidden or merged earthquake, and an unpublished one, can be neither hidden nor kept", () => {
    const hide = fn("admin_hide_event");
    expect(hide.split("and e.status in ('published', 'possible');").length).toBe(3);
    expect(hide).toContain("if exists (select 1 from public.hidden_events h where h.event_id = p_kept_event_id) then");
  });

  it("moves only live felt reports and safe check-ins, never a person already on the kept card", () => {
    const hide = fn("admin_hide_event");
    expect(hide).toContain(
      "where fr.event_id = p_event_id and fr.withdrawn_at is null and not exists ( select 1 from public.felt_reports o where o.event_id = v_kept and o.withdrawn_at is null and (o.device_id = fr.device_id or (fr.user_id is not null and o.user_id = fr.user_id)))",
    );
    expect(hide).toContain(
      "where c.event_id = p_event_id and c.status = 'safe' and not exists ( select 1 from public.safety_checkins o where o.event_id = v_kept and o.user_id = c.user_id and o.status = 'safe')",
    );
    expect(hide).toContain("insert into public.hidden_event_moves (hidden_event_id, kept_event_id, report_id)");
    expect(hide).toContain("insert into public.hidden_event_moves (hidden_event_id, kept_event_id, checkin_id)");
    expect(hide).toContain("dedupe_key = 'safe:' || u.user_id::text || ':' || v_kept::text");
  });

  it("takes the earthquake off Home and writes the activity log", () => {
    const hide = fn("admin_hide_event");
    expect(hide).toContain(
      "update public.home_pins set removed_at = now(), removed_by = v_uid where event_id = p_event_id and removed_at is null and ends_at > now(); v_unpinned := found;",
    );
    expect(hide).toContain("perform public.write_audit( v_uid, 'event_hide', 'event', p_event_id::text,");
    expect(fn("admin_unhide_event")).toContain(
      "perform public.write_audit( v_uid, 'event_unhide', 'event', p_event_id::text,",
    );
  });

  it("Show again moves back only recorded rows still on the kept card, skipping a clash", () => {
    const show = fn("admin_unhide_event");
    expect(show).toContain(
      "where m.hidden_event_id = p_event_id and m.report_id = fr.report_id and fr.event_id = m.kept_event_id and (fr.withdrawn_at is not null or not exists (",
    );
    expect(show).toContain(
      "where m.hidden_event_id = p_event_id and m.checkin_id = c.checkin_id and c.event_id = m.kept_event_id and (c.status <> 'safe' or not exists (",
    );
    expect(show).toContain("delete from public.hidden_events where event_id = p_event_id;");
  });

  it("returns the agreed keys", () => {
    expect(fn("admin_hide_event")).toContain(
      "return jsonb_build_object('moved_felt_reports', v_felt, 'moved_checkins', v_checkins, 'unpinned', v_unpinned);",
    );
    expect(fn("admin_unhide_event")).toContain(
      "return jsonb_build_object('moved_back_felt_reports', v_felt, 'moved_back_checkins', v_checkins);",
    );
    const impact = fn("admin_hide_impact");
    for (const key of ["'felt_reports'", "'safety_checkins'", "'on_home'"]) {
      expect(impact).toContain(key);
    }
    expect(impact).toContain("fr.withdrawn_at is null");
    const list = fn("admin_hidden_events");
    for (const key of [
      "'event_id'", "'bumelerze_id'", "'place'", "'magnitude'", "'origin_time'", "'status'",
      "'reason'", "'note'", "'hidden_at'", "'hidden_by_name'", "'kept'",
    ]) {
      expect(list).toContain(key);
    }
    expect(list).toContain("order by h.hidden_at desc");
    const near = fn("admin_hide_candidates");
    expect(near).toContain("'distance_km', round(x.km::numeric, 1)");
    expect(near).toContain("'minutes_apart', round(x.minutes::numeric, 1)");
    expect(near).toContain("interval '10 minutes'");
    expect(near).toContain("where y.km <= 300 order by y.km, y.minutes, y.event_id");
    expect(near).toContain(HIDDEN("c.event_id"));
    const find = fn("admin_hide_find_events");
    expect(find).toContain("and e.status in ('published', 'possible')");
    expect(find).toContain("'hidden', exists (select 1 from public.hidden_events h where h.event_id = e.event_id)");
  });

  it("queues both felt maps for a rebuild when felt reports moved", () => {
    for (const name of ["admin_hide_event", "admin_unhide_event"]) {
      expect(fn(name)).toMatch(
        /if v_felt > 0 then insert into public\.felt_cells_refresh \(event_id, requested_at\) values \(p_event_id, now\(\)\), \((v_kept|v_row\.kept_event_id), now\(\)\) on conflict \(event_id\) do update set requested_at = excluded\.requested_at; end if;/,
      );
    }
  });
});

describe("the felt map rebuild", () => {
  it("calls the existing per-event mode of aggregate-felt-cells for 10 minutes", () => {
    const run = fn("felt_cells_refresh_run");
    expect(run).toContain(
      "delete from public.felt_cells_refresh where requested_at < now() - interval '10 minutes';",
    );
    expect(run).toContain(
      "perform public.call_edge_function('aggregate-felt-cells', jsonb_build_object('eventId', r.event_id), 30000);",
    );
    expect(run).toContain("exception when others then");
    expect(line).toContain(
      "select cron.schedule('felt_cells_refresh', '*/2 * * * *', $cron$select public.felt_cells_refresh_run() where exists (select 1 from public.felt_cells_refresh);$cron$);",
    );
    expect(line).toContain(
      "revoke all on function public.felt_cells_refresh_run() from public, anon, authenticated;",
    );
  });
});

describe("what phones read", () => {
  const extras = fn("home_extras");
  it("is still one read for everyone, with the hidden list", () => {
    expect(line).toContain("grant execute on function public.home_extras() to anon, authenticated;");
    expect(extras).toContain("'hidden', coalesce((");
    expect(extras).toContain(
      "'reason_kind', case when h.reason = 'duplicate' then 'duplicate' else 'removed' end",
    );
  });

  it("never pins a hidden earthquake", () => {
    expect(extras).toContain(`and ${HIDDEN("p.event_id")} order by p.pinned_at desc limit 3`);
  });

  it("names neither the admin nor the note", () => {
    expect(extras).not.toContain("hidden_by");
    expect(extras).not.toContain("h.note");
    expect(line).toContain(
      "revoke all on function public.event_provider_ids(uuid) from public, anon, authenticated;",
    );
  });
});

describe("every replaced function is its live body plus the hidden check", () => {
  it("replaces exactly these functions and adds only the new ones", () => {
    const created = createdFunctions(sql).sort();
    expect(created).toEqual(
      [
        ...Object.keys(REPLACED),
        ...ADMIN_FUNCTIONS,
        "event_provider_ids",
        "felt_cells_refresh_run",
      ].sort(),
    );
    for (const name of [...ADMIN_FUNCTIONS, "event_provider_ids", "felt_cells_refresh_run"]) {
      expect(() => latestBefore(name)).toThrow();
    }
  });

  it.each(Object.entries(REPLACED))("%s", (name, { from, added }) => {
    const before = latestBefore(name);
    expect(before.file).toBe(from);
    let body = fn(name);
    for (const text of added) {
      expect(body).toContain(text);
      body = body.split(text).join("");
    }
    expect(body).toBe(before.text);
  });
});
