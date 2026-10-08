import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0054 (social + admin P1, batch 3: restrict and
 * suspend with expiry). It is applied by hand in the SQL editor as one line, so
 * these pin down what must not drift: the paste-ability, the privacy of the
 * table, the permission split, that every social write path is guarded and no
 * safety path is, what a suspension hides, and the idempotency of restrict,
 * lift and the appeal. (The behaviour was exercised against a real Postgres
 * when it was written; these keep it from being edited away.)
 */
const raw = readMigration("0054_social_p1_restrictions.sql");
const sql = readCode("0054_social_p1_restrictions.sql");
const fn = (name: string) => functionSource(sql, name);

describe("0054 can be pasted into the SQL editor as one line", () => {
  it("has no transaction statements", () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });

  it("has only full-line comments (no inline -- that would swallow the rest of the line)", () => {
    for (const line of sql.split("\n")) {
      expect(line).not.toContain("--");
    }
  });

  it("is plain ASCII", () => {
    expect(raw).not.toMatch(/[^\x00-\x7f]/);
  });

  it("is idempotent: if not exists / create or replace / drop if exists everywhere", () => {
    expect(sql).not.toMatch(/create table (?!if not exists)/i);
    expect(sql).not.toMatch(/create index (?!if not exists)/i);
    expect(sql).not.toMatch(/add column (?!if not exists)/i);
    expect(sql).not.toMatch(/create function/i);
    for (const m of sql.matchAll(/create policy (\w+) on ([\w.]+)/gi)) {
      expect(sql).toMatch(new RegExp(`drop policy if exists ${m[1]} on ${m[2]}`, "i"));
    }
    for (const m of sql.matchAll(/create trigger (\w+)/gi)) {
      expect(sql).toMatch(new RegExp(`drop trigger if exists ${m[1]} on`, "i"));
    }
    for (const m of sql.matchAll(/add constraint (\w+)/gi)) {
      expect(sql).toMatch(new RegExp(`drop constraint if exists ${m[1]}`, "i"));
    }
    expect(sql).toMatch(/on conflict do nothing/);
  });

  it("documents itself, the permission split and the error tokens in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0054:/);
    expect(raw).toMatch(/Who may do what:/);
    expect(raw).toMatch(/Error tokens/);
    expect(raw).toMatch(/felt reports, alerts/i);
  });
});

describe("permissions", () => {
  it("gives accounts.restrict to moderator and official, accounts.suspend to official only", () => {
    const insert = sql.match(
      /insert into public\.role_permissions[\s\S]*?on conflict do nothing;/,
    )?.[0];
    expect(insert).toBeDefined();
    expect(insert).toMatch(/\('moderator', 'accounts\.restrict'\)/);
    expect(insert).toMatch(/\('official', 'accounts\.restrict'\)/);
    expect(insert).toMatch(/\('official', 'accounts\.suspend'\)/);
    expect(insert).not.toMatch(/\('moderator', 'accounts\.suspend'\)/);
  });
});

describe("account_restrictions", () => {
  it("is one new table with RLS on", () => {
    expect(createdTables(sql)).toEqual(["account_restrictions"]);
    expect(sql).toMatch(
      /alter table public\.account_restrictions enable row level security/,
    );
  });

  it("has the columns, levels and checks of the spec", () => {
    const table =
      sql.match(
        /create table if not exists public\.account_restrictions \([\s\S]*?\n\);/,
      )?.[0] ?? "";
    for (const column of [
      "id uuid primary key",
      "user_id uuid not null references auth.users \\(id\\) on delete cascade",
      "level text not null check \\(level in \\('warning', 'restrict', 'suspend'\\)\\)",
      "reason text not null check \\(char_length\\(btrim\\(reason\\)\\) between 1 and 200\\)",
      "note text check \\(note is null or char_length\\(note\\) <= 500\\)",
      "starts_at timestamptz not null",
      "ends_at timestamptz",
      "created_by uuid",
      "created_at timestamptz not null",
      "lifted_by uuid",
      "lifted_at timestamptz",
      "appeal_requested_at timestamptz",
      "check \\(ends_at is null or ends_at > starts_at\\)",
    ]) {
      expect(table).toMatch(new RegExp(column));
    }
  });

  it("lets a person read only their own ACTIVE rows, and only the columns that are theirs", () => {
    const policy =
      sql.match(/create policy account_restrictions_read_own[\s\S]*?;\n/)?.[0] ?? "";
    expect(policy).toMatch(/for select to authenticated/);
    expect(policy).toMatch(/user_id = auth\.uid\(\)/);
    expect(policy).toMatch(/lifted_at is null/);
    expect(policy).toMatch(/starts_at <= now\(\)/);
    expect(policy).toMatch(/ends_at is null or ends_at > now\(\)/);
    expect(sql).toMatch(
      /revoke all on public\.account_restrictions from anon, authenticated/,
    );
    const grant =
      sql.match(
        /grant select \(([^)]*)\)\s+on public\.account_restrictions to authenticated/,
      )?.[1] ?? "";
    const columns = grant.split(",").map((c) => c.trim());
    expect(columns).toEqual(expect.arrayContaining(["id", "level", "reason", "ends_at"]));
    expect(columns).not.toContain("note");
    expect(columns).not.toContain("created_by");
    expect(columns).not.toContain("lifted_by");
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*account_restrictions/);
  });

  it("counts a restriction by the clock, no job: not lifted, started, not ended", () => {
    for (const name of ["is_restricted", "is_suspended"]) {
      const body = fn(name);
      expect(body).toMatch(/r\.lifted_at is null/);
      expect(body).toMatch(/r\.starts_at <= now\(\)/);
      expect(body).toMatch(/r\.ends_at is null or r\.ends_at > now\(\)/);
      expect(body).toMatch(/security definer/i);
    }
    expect(fn("is_restricted")).toMatch(/r\.level in \('restrict', 'suspend'\)/);
    expect(fn("is_suspended")).toMatch(/r\.level = 'suspend'/);
    expect(sql).not.toMatch(/cron\.schedule/);
  });

  it("keeps the helper that clients must not probe closed, and opens only is_suspended", () => {
    expect(sql).toMatch(
      /revoke all on function public\.is_restricted\(uuid\) from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.holds_admin_permission\(uuid\) from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.assert_not_restricted\(uuid, text\) from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.is_suspended\(uuid\) to anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.my_is_restricted\(\) to authenticated;/,
    );
  });

  it("raises a stable token with the permission SQLSTATE", () => {
    expect(fn("assert_not_restricted")).toMatch(
      /'%: account_restricted', p_where using errcode = '42501'/,
    );
  });
});

describe("every social write path is guarded", () => {
  const guarded: [string, string][] = [
    ["event_comments_before_insert", "event_comments"],
    ["comment_reactions_before_insert", "comment_reactions"],
    ["comment_flags_before_insert", "comment_flags"],
    ["profile_posts_before_insert", "profile_posts"],
    ["follow_user", "follow_user"],
    ["undo_unfollow_user", "undo_unfollow_user"],
    ["report_profile", "report_profile"],
    ["report_post", "report_post"],
  ];

  it.each(guarded)(
    "%s calls the guard first, before it changes anything",
    (name, where) => {
      const body = fn(name);
      expect(body).toContain(`assert_not_restricted(`);
      expect(body).toContain(`'${where}'`);
      // the guard comes before any write or any other check that could mask it
      const guardAt = body.indexOf("assert_not_restricted(");
      for (const write of [
        /\binsert into\b/,
        /\bupdate public\./,
        /\bdelete from\b/,
        /new\.status :=/,
      ]) {
        const at = body.search(write);
        if (at >= 0) {
          expect(guardAt).toBeLessThan(at);
        }
      }
    },
  );

  it("guards a post's text edit by its author only, never an admin's remove or restore", () => {
    const body = fn("profile_posts_before_update");
    expect(body).toMatch(/new\.body is distinct from old\.body/);
    expect(body).toMatch(/old\.status = 'visible'/);
    expect(body).toMatch(/new\.status = 'visible'/);
    expect(body).toMatch(/auth\.uid\(\) is not distinct from new\.user_id/);
    expect(body).toMatch(/assert_not_restricted\(new\.user_id, 'profile_posts'\)/);
  });

  it("guards the owner's name, photo, @username and privacy, but not an unchanged re-save or an admin's edit", () => {
    const body = fn("profiles_integrity_guard");
    const guard =
      body.match(
        /if auth\.uid\(\) is not distinct from new\.user_id[\s\S]*?perform public\.assert_not_restricted/,
      )?.[0] ?? "";
    expect(guard).toMatch(/new\.display_name is distinct from old\.display_name/);
    expect(guard).toMatch(/new\.avatar_path is distinct from old\.avatar_path/);
    expect(guard).toMatch(/new\.username is distinct from old\.username/);
    expect(guard).toMatch(/new\.is_private is distinct from old\.is_private/);
    // creating the profile while making an account is not blocked
    expect(body).toMatch(
      /else\s+new\.user_id := old\.user_id;[\s\S]*assert_not_restricted/,
    );
    // 0052's rules are all still there
    expect(body).toMatch(/profiles: avatar_path_invalid/);
    expect(body).toMatch(/profiles: display_name_reserved/);
    expect(body).toMatch(/new\.created_at := old\.created_at/);
  });

  it("guards avatar uploads (public bucket) through the caller-side helper", () => {
    for (const name of ["avatars_insert_own", "avatars_update_own"]) {
      const policy =
        sql.match(
          new RegExp(`create policy ${name} on storage\\.objects[\\s\\S]*?;\\n`),
        )?.[0] ?? "";
      expect(policy).toMatch(/not public\.my_is_restricted\(\)/);
      expect(policy).toMatch(/bucket_id = 'avatars'/);
    }
    // deleting one's own file stays allowed
    expect(sql).not.toMatch(/create policy avatars_delete_own/);
  });

  it("leaves every safety and exit path alone", () => {
    const touched = createdFunctions(sql);
    for (const name of [
      "delete_my_account",
      "claim_device_reports",
      "block_user",
      "unblock_user",
      "unfollow_user",
      "accept_follow_request",
      "decline_follow_request",
      "delete_my_comment",
      "restore_my_comment",
      "delete_my_post",
      "restore_my_post",
      "withdraw_comment_flag",
      "create_home_tag",
      "request_join_home",
      "delete_home_tag",
    ]) {
      expect(touched).not.toContain(name);
    }
    // (the hub trigger and summary READ felt_reports, as before; nothing writes to these)
    expect(sql).not.toMatch(
      /(insert into|update|delete from|alter table|create policy \w+ on) public\.(felt_\w+|notification_subscriptions|home_\w+|profile_private)/,
    );
    // the only feedback change is the new category and the appeal insert
    expect(sql).not.toMatch(/create policy \w+ on public\.feedback/);
  });
});

describe("a suspension hides, by the clock", () => {
  it("hides the comments of a suspended author from everybody but the author and moderators", () => {
    const policy =
      sql.match(
        /create policy event_comments_read on public\.event_comments[\s\S]*?;\n/,
      )?.[0] ?? "";
    expect(policy).toMatch(/user_id = auth\.uid\(\)/);
    expect(policy).toMatch(
      /my_has_permission\('comments\.moderate'\) and author_deleted_at is null/,
    );
    expect(policy).toMatch(/not public\.is_suspended\(event_comments\.user_id\)/);
    expect(policy).toMatch(/b\.blocker_id = auth\.uid\(\)/);
  });

  it("hides the posts of a suspended author from everybody but the author", () => {
    const policy =
      sql.match(
        /create policy profile_posts_read on public\.profile_posts[\s\S]*?;\n/,
      )?.[0] ?? "";
    expect(policy).toMatch(/user_id = auth\.uid\(\) and status <> 'deleted'/);
    expect(policy).toMatch(/status = 'visible'/);
    expect(policy).toMatch(/can_view_posts_of\(user_id\)/);
    expect(policy).toMatch(/not public\.is_suspended\(user_id\)/);
  });

  it("never changes the status of what it hides", () => {
    expect(sql).not.toMatch(/update public\.event_comments/);
    expect(sql).not.toMatch(/update public\.profile_posts/);
  });

  it("public_profile answers the flag and, to anyone but the person, only the @username", () => {
    const body = fn("public_profile");
    expect(body).toMatch(/v_suspended := public\.is_suspended\(v_id\)/);
    const early =
      body.match(/if v_suspended and not v_self then[\s\S]*?end if;/)?.[0] ?? "";
    expect(early).toMatch(/'username', v_username/);
    expect(early).toMatch(/'display_name', null::text/);
    expect(early).toMatch(/'avatar_path', null::text/);
    expect(early).toMatch(/'suspended', true/);
    expect(early).toMatch(/'can_view_full', false/);
    for (const leak of [
      "recent_comments",
      "posts_count",
      "followers",
      "milestones",
      "member_since",
    ]) {
      expect(early).not.toContain(leak);
    }
    // 0050's rules stay: a block still hides the profile, a private one still needs a follow
    expect(body).toMatch(/b\.blocker_id = v_id and b\.blocked_id = v_viewer/);
    expect(body).toMatch(/coalesce\(v_status, ''\) = 'accepted'/);
    expect(body).toMatch(/'suspended', v_suspended/);
  });

  it("follow_list and the hub's comment count follow the same rule", () => {
    expect(fn("follow_list")).toMatch(
      /is_suspended\(v_target\) and v_viewer is distinct from v_target/,
    );
    expect(fn("follow_list")).toMatch(/not public\.is_suspended\(p\.user_id\)/);
    expect(fn("event_hub_summary")).toMatch(/not public\.is_suspended\(c\.user_id\)/);
  });
});

describe("admin_restrict_account", () => {
  const body = fn("admin_restrict_account");

  it("needs accounts.restrict, and accounts.suspend for a suspension", () => {
    expect(body).toMatch(/has_permission\(v_uid, 'accounts\.restrict'\)/);
    expect(body).toMatch(
      /p_level = 'suspend' and not public\.has_permission\(v_uid, 'accounts\.suspend'\)/,
    );
  });

  it("limits a moderator (no accounts.suspend): an end date, at most 7 days", () => {
    expect(body).toMatch(
      /v_limited := not public\.has_permission\(v_uid, 'accounts\.suspend'\)/,
    );
    expect(body).toMatch(/\(p_level = 'restrict' or v_limited\)/);
    expect(body).toMatch(/admin_restrict_account: ends_required/);
    expect(body).toMatch(/v_limited and v_ends > now\(\) \+ interval '7 days 1 hour'/);
    expect(body).toMatch(/admin_restrict_account: ends_too_long/);
  });

  it("an official's warning without a date runs 7 days; restrict always needs a date; suspend may be open", () => {
    expect(body).toMatch(/v_ends is null and p_level = 'warning' and not v_limited/);
    expect(body).toMatch(/v_ends := now\(\) \+ interval '7 days'/);
    expect(body).not.toMatch(/p_level = 'suspend'\) then\s+raise/);
  });

  it("refuses an invalid level, a missing reason, a past end date, an unknown user", () => {
    expect(body).toMatch(
      /not in \('warning', 'restrict', 'suspend'\)[\s\S]*invalid_level/,
    );
    expect(body).toMatch(/v_reason = ''[\s\S]*reason_required/);
    expect(body).toMatch(/v_ends <= now\(\) \+ interval '1 minute'[\s\S]*ends_invalid/);
    expect(body).toMatch(/admin_restrict_account: not_found/);
    expect(body).toMatch(/left\(btrim\(coalesce\(p_reason, ''\)\), 200\)/);
  });

  it("nobody restricts an admin or themself", () => {
    expect(body).toMatch(/p_user_id = v_uid[\s\S]*self_restriction/);
    expect(body).toMatch(/holds_admin_permission\(p_user_id\)[\s\S]*protected_account/);
    const holds = fn("holds_admin_permission");
    expect(holds).toMatch(/join public\.role_permissions rp on rp\.role = r\.role/);
  });

  it("is idempotent: the same level already in force returns that row and writes nothing", () => {
    expect(body).toMatch(
      /r\.lifted_at is null[\s\S]*r\.ends_at >= v_ends - interval '5 minutes'/,
    );
    expect(body).toMatch(/if found then\s+return v_existing;/);
    const returnAt = body.indexOf("return v_existing");
    expect(returnAt).toBeLessThan(
      body.indexOf("insert into public.account_restrictions"),
    );
    expect(returnAt).toBeLessThan(body.indexOf("write_audit"));
  });

  it("writes an audit row whose snapshot carries the restriction id, so Undo can lift it", () => {
    expect(body).toMatch(
      /case when p_level = 'suspend' then 'suspend' else 'restrict' end/,
    );
    expect(body).toMatch(/'account', p_user_id::text/);
    expect(body).toMatch(
      /jsonb_build_object\('restriction_id', v_id, 'level', p_level, 'ends_at', v_ends\)/,
    );
  });
});

describe("admin_lift_restriction", () => {
  const body = fn("admin_lift_restriction");

  it("needs accounts.restrict, and accounts.suspend for a suspension", () => {
    expect(body).toMatch(/has_permission\(v_uid, 'accounts\.restrict'\)/);
    expect(body).toMatch(
      /r\.level = 'suspend' and not public\.has_permission\(v_uid, 'accounts\.suspend'\)/,
    );
  });

  it("stamps lifted_at and lifted_by, once; an already lifted or ended row is a quiet no-op", () => {
    expect(body).toMatch(
      /r\.lifted_at is not null or \(r\.ends_at is not null and r\.ends_at <= now\(\)\)\s+then\s+return;/,
    );
    expect(body).toMatch(/set lifted_by = v_uid, lifted_at = now\(\)/);
  });

  it("writes a lift row and marks the restrict or suspend row as undone", () => {
    expect(body).toMatch(/v_uid, 'lift', 'account'/);
    expect(body).toMatch(
      /set reverted_by = v_log\s+where action in \('restrict', 'suspend'\)\s+and snapshot ->> 'restriction_id' = r\.id::text\s+and reverted_by is null/,
    );
  });
});

describe("the lists, the banner and the appeal", () => {
  it("admin_account_restrictions needs accounts.restrict, clamps the page and orders in-force first", () => {
    const body = fn("admin_account_restrictions");
    expect(body).toMatch(/my_has_permission\('accounts\.restrict'\)/);
    expect(body).toMatch(/limit least\(greatest\(coalesce\(p_limit, 100\), 1\), 200\)/);
    expect(body).toMatch(/r\.created_at > now\(\) - interval '30 days'/);
    expect(body).toMatch(/r\.note/);
  });

  it("my_restriction answers for the caller only, the strongest in force, at most one row", () => {
    const body = fn("my_restriction");
    expect(body).toMatch(/r\.user_id = auth\.uid\(\)/);
    expect(body).toMatch(
      /case r\.level when 'suspend' then 0 when 'restrict' then 1 else 2 end/,
    );
    expect(body).toMatch(/limit 1/);
    expect(body).not.toMatch(/r\.note|created_by|lifted_by/);
  });

  it("request_restriction_review: only the person, only while in force, once, category appeal, no private note", () => {
    const body = fn("request_restriction_review");
    expect(body).toMatch(/x\.user_id = v_uid/);
    expect(body).toMatch(/x\.lifted_at is null/);
    expect(body).toMatch(/x\.ends_at is null or x\.ends_at > now\(\)/);
    expect(body).toMatch(/r\.appeal_requested_at is not null then\s+return;/);
    expect(body).toMatch(/update public\.feedback set category = 'appeal'/);
    expect(body).toMatch(
      /update public\.account_restrictions set appeal_requested_at = now\(\)/,
    );
    expect(body).toMatch(/left\(btrim\(coalesce\(p_message, ''\)\), 1000\)/);
    expect(body).not.toMatch(/\.note/);
  });

  it("extends the feedback category check by shape, keeping every earlier category", () => {
    expect(sql).toMatch(/pg_get_constraintdef\(oid\) like '%category%'/);
    const check =
      sql.match(/add constraint feedback_category_check[\s\S]*?\)\);/)?.[0] ?? "";
    for (const category of [
      "bug",
      "improvement",
      "suggestion",
      "question",
      "other",
      "badge_request",
      "appeal",
    ]) {
      expect(check).toContain(`'${category}'`);
    }
  });
});

describe("audit and Undo", () => {
  it("lets a moderator read restrict, suspend and lift rows in Activity", () => {
    expect(fn("is_content_audit_action")).toMatch(
      /in \('profile_reports_resolve', 'restrict', 'suspend', 'lift'\)/,
    );
    expect(fn("is_content_audit_action")).toMatch(/immutable/);
  });

  it("the dispatcher lifts on Undo of a restrict or suspend, only while it is in force", () => {
    const body = fn("admin_undo_action");
    const branch =
      body.match(
        /elsif l\.action in \('restrict', 'suspend'\) then[\s\S]*?elsif l\.action = 'role_revoke'/,
      )?.[0] ?? "";
    expect(branch).toMatch(/snapshot ->> 'restriction_id'/);
    expect(branch).toMatch(/x\.lifted_at is null/);
    expect(branch).toMatch(/not_restorable/);
    expect(branch).toMatch(/perform public\.admin_lift_restriction\(v_rid, p_note\)/);
  });

  it("keeps 0053's branches of the dispatcher", () => {
    const body = fn("admin_undo_action");
    for (const part of [
      "comment_hide', 'comment_remove'",
      "admin_restore_comment",
      "admin_restore_post",
      "admin_reopen_reports",
      "role_revoke",
      "role_restore",
      "if l.reverted_by is not null then\\s+return;",
    ]) {
      expect(body).toMatch(new RegExp(part));
    }
  });
});

describe("functions and grants", () => {
  const definers = [
    "is_restricted",
    "is_suspended",
    "my_is_restricted",
    "assert_not_restricted",
    "holds_admin_permission",
    "event_comments_before_insert",
    "comment_reactions_before_insert",
    "comment_flags_before_insert",
    "profile_posts_before_insert",
    "profile_posts_before_update",
    "follow_user",
    "undo_unfollow_user",
    "report_profile",
    "report_post",
    "profiles_integrity_guard",
    "event_hub_summary",
    "follow_list",
    "public_profile",
    "admin_restrict_account",
    "admin_lift_restriction",
    "admin_account_restrictions",
    "my_restriction",
    "request_restriction_review",
    "admin_undo_action",
  ];

  it("defines the expected set (plus the immutable audit-action helper)", () => {
    expect(createdFunctions(sql).sort()).toEqual(
      [...definers, "is_content_audit_action"].sort(),
    );
  });

  it("makes every function but one security definer with a pinned search_path", () => {
    for (const name of definers) {
      expect(fn(name)).toMatch(/security definer/i);
      expect(fn(name)).toMatch(/set search_path = public, (extensions, )?pg_temp/i);
    }
  });

  it("grants the client-facing functions to signed-in accounts, never to anon where 0050-0053 did not", () => {
    for (const sig of [
      "follow_user\\(uuid\\)",
      "undo_unfollow_user\\(uuid\\)",
      "report_profile\\(uuid, text\\)",
      "report_post\\(uuid, text\\)",
      "admin_restrict_account\\(uuid, text, text, text, timestamptz\\)",
      "admin_lift_restriction\\(uuid, text\\)",
      "admin_account_restrictions\\(uuid, integer\\)",
      "my_restriction\\(\\)",
      "request_restriction_review\\(uuid, text\\)",
      "admin_undo_action\\(uuid, text\\)",
    ]) {
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${sig} from public, anon;`),
      );
      expect(sql).toMatch(
        new RegExp(`grant execute on function public\\.${sig} to authenticated;`),
      );
    }
    for (const sig of [
      "public_profile\\(text\\)",
      "follow_list\\(text, text, integer\\)",
      "event_hub_summary\\(uuid\\)",
    ]) {
      expect(sql).toMatch(
        new RegExp(`grant execute on function public\\.${sig} to anon, authenticated;`),
      );
    }
  });

  it("keeps the trigger functions internal", () => {
    for (const name of [
      "event_comments_before_insert",
      "comment_reactions_before_insert",
      "comment_flags_before_insert",
      "profile_posts_before_insert",
      "profile_posts_before_update",
      "profiles_integrity_guard",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.${name}\\(\\) from public, anon, authenticated;`,
        ),
      );
    }
  });
});
