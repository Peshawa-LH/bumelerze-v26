import { functionSource, readCode, readMigration } from "../sql-test-utils";

/**
 * Static checks of migration 0084 (pre-launch checklist B2.6 stage 1):
 * Admin > Home screen. Exercised against PGlite when it was written (live
 * order 0001-0075, 0077-0083, 0076, then 0084 twice; 73 checks): phones
 * (anon and signed in) read the message and the chosen earthquakes only
 * through home_extras() and never the tables; only the admin rank in a
 * two-step session may post, remove, choose or unchoose (guests, plain
 * accounts, moderators, officials and an admin without two-step get 42501);
 * empty, over-long, unknown kind and unknown durations are refused; text is
 * cleaned; one message at a time, the replaced one kept; ended items are not
 * shown; at most 3 chosen earthquakes, re-choosing one sets a new end; an
 * unconfirmed, deleted or merged earthquake cannot be chosen and drops out
 * when deleted later; the finder searches by Bumelerze id and place; the
 * activity log keeps its 42 earlier actions and gets the 4 new ones.
 */
const FILE = "0084_home_screen_tools.sql";
const raw = readMigration(FILE);
const sql = readCode(FILE);
const line = sql.replace(/\s+/g, " ").trim();

const ADMIN_FUNCTIONS = [
  "admin_home_screen",
  "admin_home_find_events",
  "admin_post_home_notice",
  "admin_remove_home_notice",
  "admin_pin_home_event",
  "admin_unpin_home_event",
];

describe("0084 can be pasted into the SQL editor as one line", () => {
  it("has no transaction statements, only full-line comments, ASCII, no question marks", () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    for (const text of sql.split("\n")) {
      expect(text).not.toContain("--");
    }
    expect(raw).not.toMatch(/[^\x00-\x7f]/);
    expect(raw).not.toContain("?");
    expect(raw.split("\n")[0]).toMatch(/^-- 0084:/);
  });

  it("is idempotent", () => {
    expect(sql).toContain("create table if not exists public.home_notices (");
    expect(sql).toContain("create table if not exists public.home_pins (");
    expect(sql).toContain("create index if not exists home_notices_shown_idx");
    expect(line).toContain(
      "insert into public.role_permissions (role, permission) values ('admin', 'home.manage') on conflict do nothing;",
    );
    expect(sql).not.toMatch(/create function /i);
    expect(sql).not.toMatch(/create policy /i);
  });

  it("ends with a check that fails the whole paste when a part is missing", () => {
    expect(line).toContain("raise exception '0084: not in place: %'");
  });
});

describe("the two tables", () => {
  it("are closed to clients, with row level security on", () => {
    for (const table of ["home_notices", "home_pins"]) {
      expect(line).toContain(`alter table public.${table} enable row level security;`);
      expect(line).toContain(
        `revoke all on public.${table} from public, anon, authenticated;`,
      );
    }
  });

  it("hold at most 200 characters per language, at least one text, two kinds", () => {
    expect(line).toContain("coalesce(char_length(text_en), 0) <= 200");
    expect(line).toContain("coalesce(char_length(text_ar), 0) <= 200");
    expect(line).toContain("coalesce(text_en, text_ckb, text_kmr, text_ar) is not null");
    expect(line).toContain("check (kind in ('info', 'important'))");
  });

  it("keep their rows when the admin's account is deleted", () => {
    expect(line).toContain(
      "posted_by uuid references auth.users (id) on delete set null",
    );
    expect(line).toContain(
      "pinned_by uuid references auth.users (id) on delete set null",
    );
    expect(line).toContain(
      "event_id uuid primary key references public.events (event_id) on delete cascade",
    );
  });
});

describe("what phones read", () => {
  const extras = functionSource(sql, "home_extras");
  it("is one read for everyone", () => {
    expect(line).toContain(
      "grant execute on function public.home_extras() to anon, authenticated;",
    );
    expect(extras).toContain("security definer");
    expect(extras).toContain("set search_path = public, pg_temp");
  });

  it("shows only what has not ended or been removed, and at most 3 earthquakes", () => {
    const one = extras.replace(/\s+/g, " ");
    expect(one).toContain(
      "n.removed_at is null and n.starts_at <= now() and n.ends_at > now()",
    );
    expect(one).toContain("p.removed_at is null and p.ends_at > now()");
    expect(one).toContain("limit 3");
  });

  it("never shows a merged, deleted or unpublished earthquake", () => {
    const one = extras.replace(/\s+/g, " ");
    expect(one).toContain(
      "e.merged_into is null and e.review_status <> 'deleted' and e.status = 'published'",
    );
  });

  it("names the admin nowhere", () => {
    expect(extras).not.toContain("posted_by");
    expect(extras).not.toContain("pinned_by");
    expect(functionSource(sql, "home_event_json")).not.toContain("_by");
  });
});

describe("the admin functions", () => {
  it.each(ADMIN_FUNCTIONS)("%s needs home.manage (two-step since 0076)", (name) => {
    const body = functionSource(sql, name);
    expect(body).toContain(
      `if v_uid is null or not public.has_permission(v_uid, 'home.manage') then`,
    );
    expect(body).toContain(
      `raise exception '${name}: not_allowed' using errcode = '42501';`,
    );
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public, pg_temp");
  });

  it.each(ADMIN_FUNCTIONS)("%s is for signed-in callers only", (name) => {
    expect(line).toMatch(
      new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon;`),
    );
    expect(line).toMatch(
      new RegExp(
        `grant execute on function public\\.${name}\\([^)]*\\) to authenticated;`,
      ),
    );
  });

  it("gives home.manage to the admin rank only (owner choice 1)", () => {
    expect(line).not.toMatch(/\('(official|moderator|authority)', 'home\.manage'\)/);
  });

  it("posts one message at a time, with the four durations and cleaned text", () => {
    const post = functionSource(sql, "admin_post_home_notice").replace(/\s+/g, " ");
    expect(post).toContain("not in (6, 24, 72, 168)");
    expect(post).toContain("home_notice_empty");
    expect(post).toContain("home_notice_too_long");
    expect(post).toContain(
      "update public.home_notices set removed_at = now(), removed_by = v_uid where removed_at is null and ends_at > now();",
    );
    expect(post).toContain("public.home_notice_clean(p_text_en)");
    const clean = functionSource(sql, "home_notice_clean");
    expect(clean).toContain("strip_bidi_controls");
    expect(clean).toContain("[[:cntrl:]]");
  });

  it("chooses at most 3 earthquakes, for 1, 3, 7 or 30 days", () => {
    const pin = functionSource(sql, "admin_pin_home_event").replace(/\s+/g, " ");
    expect(pin).toContain("not in (1, 3, 7, 30)");
    expect(pin).toContain("if v_shown >= 3 then");
    expect(pin).toContain("too_many");
    expect(pin).toContain("event_not_found");
    expect(pin).toContain("pg_advisory_xact_lock");
  });

  it("writes every change to the activity log", () => {
    expect(functionSource(sql, "admin_post_home_notice")).toContain("'home_notice_post'");
    expect(functionSource(sql, "admin_remove_home_notice")).toContain(
      "'home_notice_remove'",
    );
    expect(functionSource(sql, "admin_pin_home_event")).toContain("'home_pin'");
    expect(functionSource(sql, "admin_unpin_home_event")).toContain("'home_unpin'");
    expect(line).toContain(
      "v_actions text[] := array['home_notice_post', 'home_notice_remove', 'home_pin', 'home_unpin'];",
    );
  });

  it("keeps the helpers away from clients", () => {
    expect(line).toContain(
      "revoke all on function public.home_notice_clean(text) from public, anon, authenticated;",
    );
    expect(line).toContain(
      "revoke all on function public.home_event_json(uuid) from public, anon, authenticated;",
    );
  });
});
