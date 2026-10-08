import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0061 (activity list, mute, download my data,
 * home trash, unblock restores follows). Pasted into the SQL editor as one
 * line, so the paste rules are pinned, and so are the privacy promises: no
 * place in any new table, activity only through the fixed functions with
 * blocks and mutes applied, moderators never named, the export limited to the
 * caller's own data, a trashed home closed for every member. The behaviour was
 * exercised against a real Postgres (PGlite) when it was written; these keep
 * it from being edited away.
 */
const raw = readMigration("0061_activity_mute_export_trash.sql");
const sql = readCode("0061_activity_mute_export_trash.sql");
const fn = (name: string) => functionSource(sql, name);

function tableBody(name: string): string {
  const start = sql.search(
    new RegExp(`create table if not exists public\\.${name}\\s*\\(`, "i"),
  );
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf(");", start));
}

describe("0061 can be pasted into the SQL editor as one line", () => {
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
    expect(sql).not.toMatch(/create index (?!if not exists)/i);
    expect(sql).not.toMatch(/create function/i);
    expect(sql).not.toMatch(/add column (?!if not exists)/i);
    for (const constraint of ["activity_items_kind_check", "home_tags_status_check"]) {
      expect(sql).toContain(`drop constraint if exists ${constraint};`);
    }
    for (const [trigger, table] of [
      ["activity_on_follows", "follows"],
      ["activity_on_comments", "event_comments"],
      ["activity_on_comment_helpful", "comment_reactions"],
      ["activity_on_post_helpful", "post_helpful"],
      ["activity_on_moderation", "moderation_log"],
      ["activity_on_roles", "user_roles"],
      ["activity_on_home_members", "home_members"],
      ["activity_on_checkins", "safety_checkins"],
      ["home_tags_after_delete", "home_tags"],
    ] as const) {
      expect(sql).toContain(`drop trigger if exists ${trigger} on public.${table};`);
    }
  });

  it("never uses CASE inside an IF condition (PL/pgSQL takes its THEN as the IF's)", () => {
    expect(sql).not.toMatch(/\bif\b[^;]*\bcase\b[^;]*\bthen\b/i);
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0061:/);
  });
});

describe("stays out of the parallel batches' way", () => {
  it("redefines none of 0059's and 0060's functions, nor account deletion or the 0058 purge", () => {
    const created = createdFunctions(sql);
    for (const name of [
      "event_comments_before_insert",
      "profile_posts_before_insert",
      "profile_posts_before_update",
      "moderate_comment",
      "admin_delete_comment",
      "admin_remove_post",
      "admin_restore_comment",
      "admin_restore_post",
      "write_audit",
      "feedback_client_category_guard",
      "request_restriction_review",
      "delete_my_account",
      "purge_expired_social",
    ]) {
      expect([name, created.includes(name)]).toEqual([name, false]);
    }
    expect(sql).not.toMatch(/role_permissions/);
    expect(sql).not.toMatch(/policy event_comments_read|policy profile_posts_read/);
  });

  it("hooks only with AFTER triggers", () => {
    const triggers = [...sql.matchAll(/create trigger (\w+)\s+(\w+)/g)];
    expect(triggers.length).toBe(9);
    for (const match of triggers) {
      expect([match[1], match[2]]).toEqual([match[1], "after"]);
    }
  });
});

describe("no place of the person anywhere new", () => {
  it("adds only the expected tables and columns, none of them coordinates", () => {
    expect(createdTables(sql).sort()).toEqual(
      ["activity_items", "home_photo_purge", "mutes"].sort(),
    );
    const added = [...sql.matchAll(/add column if not exists (\w+)/g)].map((m) => m[1]);
    expect(added.sort()).toEqual(["removed_follows", "trashed_at"]);
    for (const table of ["activity_items", "mutes", "home_photo_purge"]) {
      expect(tableBody(table)).not.toMatch(
        /\b(lat|lon|latitude|longitude|geohash\w*|geom\w*|location\w*|accuracy|device_id|ip\w*|address)\b/i,
      );
    }
  });

  it("the activity list returns no coordinates, only public fields of other people", () => {
    const list = fn("my_activity");
    const returns = list.slice(0, list.indexOf("language plpgsql"));
    expect(returns).not.toMatch(/\blat\b|\blon\b|geohash|email|device/i);
    expect(list).toMatch(
      /p\.username::text, p\.display_name::text, p\.avatar_path::text/,
    );
    expect(list).not.toMatch(/t\.lat|t\.lon|e\.lat|e\.lon/);
  });
});

describe("activity: written by triggers, read through fixed functions", () => {
  it("closed table: RLS on, no policy, no client privilege", () => {
    expect(sql).toContain("alter table public.activity_items enable row level security;");
    expect(sql).toContain(
      "revoke all on public.activity_items from public, anon, authenticated;",
    );
    expect(sql).not.toMatch(/create policy/i);
  });

  it("one writer that skips self, blocks either way, mutes (except family check-ins) and silent restores", () => {
    const add = fn("activity_add");
    expect(add).toMatch(/public\.activity_silent\(\)/);
    expect(add).toMatch(/p_actor = p_user or public\.blocked_between\(p_user, p_actor\)/);
    expect(add).toMatch(
      /p_kind <> 'family_safe' and public\.has_muted\(p_user, p_actor\)/,
    );
    expect(fn("activity_helpful")).toMatch(
      /public\.blocked_between\(p_user, p_actor\) or public\.has_muted\(p_user, p_actor\)/,
    );
  });

  it("the read filter: 90 days, blocks, mutes and suspensions, active homes, still-visible content", () => {
    const visible = fn("activity_visible");
    expect(visible).toMatch(/a\.created_at > now\(\) - interval '90 days'/);
    expect(visible).toMatch(/not public\.blocked_between\(p_user, a\.actor_id\)/);
    expect(visible).toMatch(
      /a\.kind = 'family_safe'\s+or \(not public\.has_muted\(p_user, a\.actor_id\) and not public\.is_suspended\(a\.actor_id\)\)/,
    );
    expect(visible).toMatch(/t\.status = 'active'/);
    expect(visible).toMatch(/s\.status = 'approved' and s\.share_checkins/);
    expect(fn("my_activity")).toMatch(/from public\.activity_visible\(v_uid\) a/);
    expect(fn("my_activity_unread")).toMatch(/public\.activity_visible\(auth\.uid\(\)\)/);
  });

  it("moderation and ranks never name who acted", () => {
    const moderation = fn("activity_on_moderation");
    for (const call of moderation.match(/activity_add\([^;]*/g) ?? []) {
      expect(call).toMatch(/'content_removed', null,/);
    }
    expect(moderation).not.toMatch(/new\.actor_id/);
    expect(fn("activity_reviewed")).toMatch(/'report_reviewed', null,/);
    expect(fn("activity_on_roles")).toMatch(/'badge_granted', null,/);
    expect(fn("activity_on_roles")).not.toMatch(/granted_by|note/);
  });

  it("a reporter hears 'reviewed' only, with no link to the content", () => {
    const reviewed = fn("activity_reviewed");
    expect(reviewed).toMatch(/jsonb_build_object\('target', p_target\)/);
    expect(reviewed).not.toMatch(/p_comment|p_post =>|comment_id|post_id/);
  });

  it("an undo or approval takes the removal notice back; reopening takes 'reviewed' back", () => {
    const moderation = fn("activity_on_moderation");
    expect(moderation).toMatch(/new\.action in \('comment_approve', 'comment_restore'\)/);
    expect(moderation).toMatch(/new\.action = 'post_restore'/);
    expect(moderation).toMatch(/new\.action = 'report_reopen'/);
  });

  it("family check-ins follow 0057: active home, approved, sharing, joined before; retract takes back", () => {
    const c = fn("activity_on_checkins");
    expect(c).toMatch(/t\.status = 'active'/);
    expect(c).toMatch(/me\.share_checkins/);
    expect(c).toMatch(
      /coalesce\(reader\.decided_at, reader\.requested_at\) <= new\.created_at/,
    );
    expect(c).toMatch(/new\.status = 'retracted'/);
    expect(c).not.toMatch(/\blat\b|\blon\b|geohash/);
  });

  it("an appeal is a feedback row of category appeal, once per removal", () => {
    const appeal = fn("request_content_review");
    expect(appeal).toMatch(/i\.user_id = v_uid and i\.kind = 'content_removed'/);
    expect(appeal).toMatch(/already_requested/);
    expect(appeal).toMatch(/update public\.feedback set category = 'appeal'/);
    expect(appeal).not.toMatch(/\bscreen\b/);
  });

  it("kept 90 days by its own nightly job", () => {
    expect(fn("purge_activity_and_home_trash")).toMatch(
      /delete from public\.activity_items where created_at < now\(\) - interval '90 days'/,
    );
    expect(sql).toMatch(
      /cron\.schedule\('purge_activity_and_home_trash', '45 3 \* \* \*'/,
    );
  });
});

describe("mute", () => {
  it("is quiet: closed table, the muted person reads nothing", () => {
    expect(sql).toContain("revoke all on public.mutes from public, anon, authenticated;");
    expect(fn("my_mutes")).toMatch(/where m\.muter_id = auth\.uid\(\)/);
    expect(tableBody("mutes")).toMatch(/check \(muter_id <> muted_id\)/);
    expect(fn("mute_user")).toMatch(/>= 500/);
  });
});

describe("block and unblock", () => {
  it("block remembers the follows it removed and clears activity between the two", () => {
    const block = fn("block_user");
    expect(block).toMatch(/returning follower_id, followee_id, status, created_at/);
    expect(block).toMatch(
      /insert into public\.blocks \(blocker_id, blocked_id, removed_follows\)/,
    );
    expect(block).toMatch(/delete from public\.activity_items/);
  });

  it("unblock restores within 24 hours, only between the two, not across the other's block, silently", () => {
    const unblock = fn("unblock_user");
    expect(unblock).toMatch(/v_created < now\(\) - interval '24 hours'/);
    expect(unblock).toMatch(/public\.blocked_between\(v_uid, p_user\)/);
    expect(unblock).toMatch(/f\.follower_id not in \(v_uid, p_user\)/);
    expect(unblock).toMatch(/set_config\('bumelerze\.activity_silent', 'on', true\)/);
  });
});

describe("home trash", () => {
  it("a trashed home is closed for every member through the two membership tests", () => {
    for (const name of ["is_home_member", "is_home_owner"]) {
      expect(fn(name)).toMatch(/t\.status <> 'trashed'/);
    }
    expect(sql).toMatch(/check \(status in \('active', 'archived', 'trashed'\)\)/);
  });

  it("owners only; restore within 14 days within the 5-home limit; no coordinates in the list", () => {
    expect(fn("trash_home_tag")).toMatch(/not public\.is_home_owner\(p_tag\)/);
    const restore = fn("restore_home_tag");
    expect(restore).toMatch(/owns_home_any_state\(p_tag\)/);
    expect(restore).toMatch(/interval '14 days'/);
    expect(restore).toMatch(/>= 5/);
    const list = fn("my_trashed_homes");
    expect(list).not.toMatch(/\blat\b|\blon\b|answers/);
  });

  it("purged after 14 days the way delete_home_tag deletes; photo files queued on every delete", () => {
    expect(fn("purge_activity_and_home_trash")).toMatch(
      /t\.status = 'trashed' and t\.trashed_at < now\(\) - interval '14 days'/,
    );
    expect(fn("hard_delete_home")).toMatch(/delete from public\.building_complexes/);
    expect(fn("home_tags_after_delete")).toMatch(/o\.bucket_id = 'home-photos'/);
    expect(sql).toMatch(
      /create trigger home_tags_after_delete\s+after delete on public\.home_tags/,
    );
    expect(sql).toContain(
      "revoke all on public.home_photo_purge from public, anon, authenticated;",
    );
    expect(sql).toMatch(/functions\/v1\/purge-home-photos/);
  });
});

describe("download my data", () => {
  const exp = fn("export_my_data");

  it("signed-in callers only, their own rows only", () => {
    expect(exp).toMatch(/if v_uid is null then/);
    for (const where of [
      "from public.felt_reports fr where fr.user_id = v_uid",
      "from public.event_comments c where c.user_id = v_uid",
      "from public.profile_posts po where po.user_id = v_uid",
      "from public.feedback fb where fb.user_id = v_uid",
      "from public.safety_checkins sc where sc.user_id = v_uid",
      "from public.activity_items a where a.user_id = v_uid",
      "s.user_id = v_uid",
      "hp.user_id = v_uid",
    ]) {
      expect([where, exp.includes(where)]).toEqual([where, true]);
    }
  });

  it("coordinates and assessments only for homes the person owns", () => {
    expect(exp).toMatch(
      /case when t\.owner_user_id = v_uid then jsonb_build_object\(\s*'lat', t\.lat, 'lon', t\.lon/,
    );
  });

  it("other people only by public id, @username and name; no admin, triage or moderator fields", () => {
    expect(fn("export_person")).not.toMatch(/email|is_private|lat|lon/);
    expect(exp).not.toMatch(
      /triage_note|removed_by|granted_by|created_by|lifted_by|moderated_by|admin_person_notes|moderation_log|moderation_evidence/,
    );
    expect(exp).not.toMatch(/ar\.note|r\.note,\s*'granted/);
    expect(exp).not.toMatch(/join_key|home_tag_secrets/);
  });
});

describe("grants", () => {
  const userFunctions = [
    "my_activity(integer, timestamptz)",
    "my_activity_unread()",
    "mark_activity_read(uuid[])",
    "request_content_review(uuid, text)",
    "mute_user(uuid)",
    "unmute_user(uuid)",
    "my_mutes()",
    "block_user(uuid)",
    "unblock_user(uuid)",
    "trash_home_tag(uuid)",
    "restore_home_tag(uuid)",
    "delete_home_now(uuid)",
    "my_trashed_homes()",
    "export_my_data()",
  ];
  const internal = [
    "blocked_between(uuid, uuid)",
    "has_muted(uuid, uuid)",
    "activity_silent()",
    "activity_add(uuid, text, uuid, text, uuid, uuid, uuid, uuid, uuid, jsonb, boolean)",
    "activity_helpful(uuid, uuid, text, uuid, uuid, integer)",
    "activity_reviewed(text, text, uuid[])",
    "activity_visible(uuid)",
    "hard_delete_home(uuid)",
    "owns_home_any_state(uuid)",
    "home_tags_after_delete()",
    "export_person(uuid)",
    "purge_activity_and_home_trash()",
  ];

  it("every function but the silent-flag read is security definer with a pinned search path", () => {
    for (const name of createdFunctions(sql)) {
      expect([name, fn(name)]).toEqual([
        name,
        expect.stringMatching(/set search_path = public, (storage, )?pg_temp/),
      ]);
      if (name !== "activity_silent") {
        expect([name, fn(name)]).toEqual([
          name,
          expect.stringMatching(/security definer/),
        ]);
      }
    }
  });

  it("user functions for signed-in users only; internals for nobody", () => {
    for (const signature of userFunctions) {
      expect(sql).toContain(
        `revoke all on function public.${signature} from public, anon;`,
      );
      expect(sql).toContain(
        `grant execute on function public.${signature} to authenticated;`,
      );
    }
    for (const signature of internal) {
      expect(sql).toContain(
        `revoke all on function public.${signature} from public, anon, authenticated;`,
      );
      expect(sql).not.toContain(
        `grant execute on function public.${signature} to authenticated;`,
      );
    }
    for (const name of createdFunctions(sql).filter((n) =>
      n.startsWith("activity_on_"),
    )) {
      expect(sql).toContain(
        `revoke all on function public.${name}() from public, anon, authenticated;`,
      );
    }
  });
});
