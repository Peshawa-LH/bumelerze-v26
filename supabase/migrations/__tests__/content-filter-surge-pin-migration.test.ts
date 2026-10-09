import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0059 (word filter, busy-time review, pinned
 * notes). Pasted into the SQL editor as one line, so the paste rules are
 * pinned, and so are the promises: matches are HELD, never refused; which
 * term matched is readable by moderators only; the staff are never held; a
 * pinned comment cannot be sent to review by readers' reports; only the
 * official manages the list and the switch. The behaviour was exercised
 * against a real Postgres (PGlite) when it was written; these keep it from
 * being edited away.
 */
const raw = readMigration("0059_content_filter_surge_pin.sql");
const sql = readCode("0059_content_filter_surge_pin.sql");
const fn = (name: string) => functionSource(sql, name);

function tableBody(name: string): string {
  const start = sql.search(
    new RegExp(`create table if not exists public\\.${name}\\s*\\(`, "i"),
  );
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf(");", start));
}

describe("0059 can be pasted into the SQL editor as one line", () => {
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
    expect(sql).toContain("drop constraint if exists profile_posts_status_check;");
    expect(sql).toContain(
      "execute format('alter table public.moderation_log drop constraint %I', c.conname);",
    );
    for (const trigger of [
      "event_comments_hold_check on public.event_comments",
      "event_comments_pin_guard on public.event_comments",
      "profile_posts_hold_check on public.profile_posts",
    ]) {
      expect(sql).toContain(`drop trigger if exists ${trigger};`);
    }
    expect(sql).toContain("on conflict (is_pattern, term_norm) do nothing;");
    expect(sql).toMatch(
      /insert into public\.moderation_settings[^;]*on conflict \(key\) do nothing;/,
    );
  });

  it("never uses CASE inside an IF condition (PL/pgSQL takes its THEN as the IF's)", () => {
    expect(sql).not.toMatch(/\bif\b[^;]*\bcase\b[^;]*\bthen\b/i);
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0059:/);
  });
});

describe("the parallel builders' shared code is left alone", () => {
  it("adds new triggers instead of redefining the existing trigger functions", () => {
    const changed = createdFunctions(sql);
    for (const name of [
      "event_comments_before_insert",
      "profile_posts_before_insert",
      "profile_posts_before_update",
      "profile_posts_after_status",
      "comment_flags_after_insert",
      "moderate_comment",
      "has_permission",
      "purge_expired_social",
      "delete_my_account",
    ]) {
      expect(changed).not.toContain(name);
    }
  });

  it("the new triggers sort after the ones they build on (triggers fire in name order)", () => {
    expect("event_comments_hold_check" > "event_comments_before_insert").toBe(true);
    expect("profile_posts_hold_check" > "profile_posts_before_insert").toBe(true);
    expect("profile_posts_hold_check" > "profile_posts_before_update").toBe(true);
  });

  it("builds the log's action list as the union of the live list and its own", () => {
    const block = sql.slice(
      sql.indexOf("v_actions text[] := array["),
      sql.indexOf("add constraint moderation_log_action_check"),
    );
    expect(block).toContain("regexp_matches(c.def, '''([a-z0-9_]+)''', 'g')");
    expect(block).toContain("array_agg(distinct a order by a)");
    expect(sql).not.toMatch(
      /add constraint moderation_log_action_check\s+check \(action in \('/,
    );
    const actions = [...block.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    for (const action of [
      "comment_approve",
      "comment_hide",
      "comment_remove",
      "comment_restore",
      "role_grant",
      "role_revoke",
      "role_restore",
      "profile_reports_resolve",
      "report_reopen",
      "post_remove",
      "post_restore",
      "post_reports_dismiss",
      "password_reset",
      "profile_reset",
      "profile_restore",
      "restrict",
      "suspend",
      "lift",
      "person_view",
      "email_reveal",
      "purge",
      "post_approve",
      "comment_pin",
      "comment_unpin",
      "filter_term_add",
      "filter_term_update",
      "surge_set",
    ]) {
      expect(actions).toContain(action);
    }
  });

  it("gives filter.manage to the official, and to 0060's admin rank only if it exists", () => {
    expect(sql).toMatch(/\('official', 'filter\.manage'\)/);
    expect(sql).toMatch(
      /pg_get_constraintdef\(oid\) like '%''admin''%'\s*\) then\s*insert into public\.role_permissions \(role, permission\) values \('admin', 'filter\.manage'\)/,
    );
  });
});

describe("held, never refused", () => {
  it("a matching comment goes to 'pending' and the match is recorded", () => {
    const hold = fn("event_comments_hold_check");
    expect(hold).toMatch(/new\.pinned_at := null;/);
    expect(hold).toMatch(/from public\.content_filter_matches\(new\.body\) m/);
    expect(hold).toMatch(/new\.status := 'pending';/);
    expect(hold).not.toMatch(/raise exception/);
  });

  it("posts gain a 'pending' state and the same check, also on the author's edit", () => {
    expect(sql).toMatch(
      /check \(status in \('visible', 'pending', 'removed', 'deleted'\)\)/,
    );
    const hold = fn("profile_posts_hold_check");
    expect(hold).toMatch(/tg_op = 'INSERT'/);
    expect(hold).toMatch(/new\.body is distinct from old\.body/);
    expect(hold).toMatch(/auth\.uid\(\) is not distinct from new\.user_id/);
    expect(hold).toMatch(
      /old\.status = 'deleted'\s+and new\.status = 'visible'\s+and old\.held_at is not null/,
    );
    expect(hold).not.toMatch(/raise exception/);
  });

  it("the staff are never held", () => {
    expect(fn("event_comments_hold_check")).toMatch(
      /public\.has_permission\(new\.user_id, 'comments\.moderate'\)/,
    );
    expect(fn("profile_posts_hold_check")).toMatch(
      /public\.has_permission\(new\.user_id, 'comments\.moderate'\)/,
    );
  });

  it("a broken pattern never blocks a person from writing", () => {
    expect(fn("content_filter_matches")).toMatch(/exception when others then\s+null;/);
  });

  it("a replayed share finds a held post too", () => {
    expect(fn("share_event_to_profile")).toMatch(
      /po\.status in \('visible', 'pending'\)/,
    );
  });

  it("post_queue lists held posts first", () => {
    const q = fn("post_queue");
    expect(q).toMatch(/where po\.status = 'pending'/);
    expect(q).toMatch(/order by \(po\.status = 'pending'\) desc/);
  });
});

describe("privacy of the list and the holds", () => {
  it("adds only these tables, none with a person's location or text", () => {
    expect(createdTables(sql).sort()).toEqual(
      ["content_filter_terms", "content_holds", "moderation_settings"].sort(),
    );
    for (const table of [
      "content_filter_terms",
      "content_holds",
      "moderation_settings",
    ]) {
      expect(tableBody(table)).not.toMatch(
        /\b(lat|lon|geohash\w*|location\w*|device_id|ip\w*|body)\b/i,
      );
    }
  });

  it("no client reads or writes the new tables directly", () => {
    for (const table of [
      "content_filter_terms",
      "content_holds",
      "moderation_settings",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(
        `revoke all on public.${table} from public, anon, authenticated;`,
      );
      expect(sql).not.toMatch(new RegExp(`create policy \\w+ on public\\.${table}`));
    }
  });

  it("holds are for moderators, the list and the switch for filter.manage", () => {
    expect(fn("content_holds_for")).toMatch(
      /has_permission\(auth\.uid\(\), 'comments\.moderate'\)/,
    );
    for (const name of [
      "admin_filter_terms",
      "admin_add_filter_term",
      "admin_set_filter_term",
      "admin_test_filter",
      "admin_surge_status",
      "admin_set_surge_mode",
    ]) {
      expect(fn(name)).toMatch(
        /has_permission\((auth\.uid\(\)|v_uid), 'filter\.manage'\)/,
      );
    }
    expect(sql).toMatch(/\('official', 'filter\.manage'\)/);
    expect(sql).not.toMatch(/\('moderator', 'filter\.manage'\)/);
    expect(sql).not.toMatch(
      /\('(seismologist|professor|researcher|engineer|partner)', 'filter\.manage'\)/,
    );
  });

  it("only the banner flag is open to everyone", () => {
    const anonGrants = [
      ...sql.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to anon/g),
    ].map((m) => m[1]);
    expect(anonGrants).toEqual(["hub_surge_active"]);
  });

  it("the app can add words and phrases, never patterns", () => {
    expect(fn("admin_add_filter_term")).toMatch(
      /insert into public\.content_filter_terms \(term, term_norm, lang, kind, created_by\)/,
    );
    // is_pattern keeps its default (false); it appears only in the conflict target
    expect(
      fn("admin_add_filter_term").replace("on conflict (is_pattern, term_norm)", ""),
    ).not.toMatch(/is_pattern/);
  });
});

describe("busy times", () => {
  const state = fn("surge_state");
  it("uses the agreed thresholds", () => {
    expect(state).toMatch(/e\.region_flag/);
    expect(state).toMatch(/e\.magnitude >= 5\.0/);
    expect(state).toMatch(/interval '24 hours'/);
    expect(state).toMatch(/having count\(\*\) >= 50/);
    expect(state).toMatch(/fr\.created_at < e\.origin_time \+ interval '1 hour'/);
    expect(fn("account_is_new")).toMatch(/interval '7 days'/);
  });

  it("a forced mode lasts 24 hours", () => {
    expect(fn("admin_set_surge_mode")).toMatch(/'until', now\(\) \+ interval '24 hours'/);
    expect(state).toMatch(/v_until <= now\(\)/);
  });
});

describe("pinned notes", () => {
  it("one pin per hub, hubs.feature only, top-level visible comments only", () => {
    expect(sql).toMatch(
      /create unique index if not exists event_comments_one_pin_idx\s+on public\.event_comments \(event_id\) where pinned_at is not null;/,
    );
    const pin = fn("pin_hub_comment");
    expect(pin).toMatch(/has_permission\(v_uid, 'hubs\.feature'\)/);
    expect(pin).toMatch(/not_top_level/);
    expect(pin).toMatch(/not_visible/);
  });

  it("readers' reports cannot send a pinned comment to review; leaving 'visible' unpins", () => {
    const guard = fn("event_comments_pin_guard");
    expect(guard).toMatch(
      /old\.pinned_at is not null and old\.status = 'visible' and new\.status = 'pending'/,
    );
    expect(guard).toMatch(/new\.status := 'visible';/);
    expect(guard).toMatch(/new\.pinned_at := null;/);
  });
});

describe("the starter list", () => {
  const seed = sql.slice(
    sql.indexOf(
      "insert into public.content_filter_terms (term, term_norm, lang, kind, is_pattern, draft)",
    ),
  );
  it("is all drafts, in four languages, hold only", () => {
    expect(seed).toMatch(/v\.lang, v\.kind, v\.pat, true/);
    for (const lang of ["'en'", "'ckb'", "'kmr'", "'ar'"]) {
      expect(seed).toContain(lang);
    }
    expect(sql).toMatch(
      /action text not null default 'hold' check \(action in \('hold'\)\)/,
    );
  });

  it("never lists the prebunk wording itself", () => {
    expect(seed).not.toMatch(/'predict'|'prediction'\s*,\s*'en'|'earthquake'\s*,/);
  });
});
