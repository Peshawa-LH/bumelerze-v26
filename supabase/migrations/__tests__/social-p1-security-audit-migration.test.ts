import {
  createdFunctions,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0052 (social + admin P1, batch 1). It is applied
 * by hand in the SQL editor as one line, so these pin down what must not
 * drift: the paste-ability, the flag rules, the deleted-comment rules, the
 * name guard, the append-only audit log and the gates on every admin RPC.
 * (The behaviour itself was exercised against a real Postgres when it was
 * written; these keep it from being edited away.)
 */
const raw = readMigration("0052_social_p1_security_audit.sql");
const sql = readCode("0052_social_p1_security_audit.sql");
const fn = (name: string) => functionSource(sql, name);

/** Decodes every U&'\XXXX' literal inside a piece of SQL. */
function unicodeLiterals(code: string): string[] {
  return [...code.matchAll(/U&'((?:[^']|'')*)'/g)].map((m) =>
    (m[1] ?? "").replace(/\\([0-9A-Fa-f]{4})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    ),
  );
}

describe("0052 can be pasted into the SQL editor as one line", () => {
  it("has no transaction statements", () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });

  it("has only full-line comments (no inline -- that would swallow the rest of the line)", () => {
    for (const line of sql.split("\n")) {
      expect(line).not.toContain("--");
    }
  });

  it("is plain ASCII once comments are removed (non-ASCII letters are U& escapes)", () => {
    expect(sql).not.toMatch(/[^\x00-\x7f]/);
  });

  it("is idempotent: tables, columns and indexes use if not exists, the rest create or replace / drop if exists", () => {
    expect(sql).not.toMatch(/create table (?!if not exists)/i);
    expect(sql).not.toMatch(/create index (?!if not exists)/i);
    expect(sql).not.toMatch(/create unique index (?!if not exists)/i);
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
  });

  it("schedules the nightly job after unscheduling any earlier one", () => {
    const unschedule = sql.indexOf("cron.unschedule('wipe_deleted_comment_text')");
    const schedule = sql.indexOf("cron.schedule('wipe_deleted_comment_text'");
    expect(unschedule).toBeGreaterThan(-1);
    expect(schedule).toBeGreaterThan(unschedule);
    expect(sql).toMatch(/'10 3 \* \* \*'/);
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0052:/);
  });
});

describe("0052 functions", () => {
  const definers = [
    "my_has_permission",
    "audit_actor_rank",
    "write_audit",
    "comment_flags_before_insert",
    "comment_flags_after_insert",
    "withdraw_comment_flag",
    "event_comments_before_insert",
    "delete_my_comment",
    "moderate_comment",
    "admin_delete_comment",
    "wipe_deleted_comment_text",
    "display_name_reserved",
    "profiles_integrity_guard",
    "admin_grant_role",
    "admin_revoke_role",
    "resolve_profile_reports",
    "dismiss_post_reports",
    "admin_remove_post",
    "admin_reset_password",
    "admin_activity",
  ];

  it("defines the expected set", () => {
    expect(createdFunctions(sql).sort()).toEqual(
      [...definers, "is_content_audit_action", "name_fold", "name_key"].sort(),
    );
  });

  it("makes every writing or reading function security definer with a pinned search_path", () => {
    for (const name of definers) {
      expect(fn(name)).toMatch(/security definer/i);
      expect(fn(name)).toMatch(/set search_path = public, (extensions, )?pg_temp/i);
    }
    for (const name of ["name_fold", "name_key", "is_content_audit_action"]) {
      expect(fn(name)).toMatch(/set search_path = public, pg_temp/i);
    }
  });

  it("revokes the internal functions from every client role", () => {
    for (const name of [
      "write_audit",
      "audit_actor_rank",
      "wipe_deleted_comment_text",
      "name_fold",
      "name_key",
      "display_name_reserved",
      "profiles_integrity_guard",
      "comment_flags_before_insert",
      "comment_flags_after_insert",
      "event_comments_before_insert",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated`,
        ),
      );
    }
    expect(sql).toMatch(
      /grant execute on function public\.wipe_deleted_comment_text\(\) to service_role/,
    );
    expect(sql).not.toMatch(/grant execute on function public\.write_audit/);
  });

  it("grants the client-facing RPCs to signed-in accounts only (my_has_permission also to anon, for policies)", () => {
    for (const sig of [
      "withdraw_comment_flag\\(uuid\\)",
      "delete_my_comment\\(uuid\\)",
      "moderate_comment\\(uuid, text, text\\)",
      "admin_delete_comment\\(uuid, text\\)",
      "admin_activity\\(uuid, text, uuid, timestamptz, integer\\)",
    ]) {
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${sig} to authenticated;`));
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${sig} from public, anon;`));
    }
    expect(sql).toMatch(
      /grant execute on function public\.my_has_permission\(text\) to authenticated, anon/,
    );
  });
});

describe("S1 flag brigading", () => {
  it("records who counts from auth.users.is_anonymous, server side", () => {
    const body = fn("comment_flags_before_insert");
    expect(body).toMatch(/from auth\.users u where u\.id = new\.user_id/);
    expect(body).toMatch(/new\.counts := not coalesce\(v_anonymous, true\)/);
    // a client cannot choose these
    expect(body).toMatch(/new\.settled := false/);
    expect(body).toMatch(/new\.withdrawn_at := null/);
  });

  it("limits a person to 30 flags per 24 hours with a token the client maps", () => {
    const body = fn("comment_flags_before_insert");
    expect(body).toMatch(/interval '24 hours'/);
    expect(body).toMatch(/v_recent >= 30/);
    expect(body).toMatch(/'comment_flags: flag_limit' using errcode = '54000'/);
  });

  it("auto-hides only on three open flags from accounts, never a rank holder's comment", () => {
    const body = fn("comment_flags_after_insert");
    expect(body).toMatch(/f\.counts/);
    expect(body).toMatch(/v_counted >= 3/);
    expect(body).toMatch(/not v_rank/);
    expect(body).toMatch(/join public\.user_roles r on r\.user_id = c\.user_id/);
    // flag_count still counts every open flag, so the queue shows the comment
    expect(body).toMatch(/flag_count = v_open/);
  });

  it("withdrawing lowers flag_count but never changes the comment's status", () => {
    const body = fn("withdraw_comment_flag");
    expect(body).toMatch(/set withdrawn_at = now\(\)/);
    expect(body).toMatch(/f\.user_id = v_uid/);
    expect(body).not.toMatch(/status/);
    expect(body).toMatch(/errcode = '42501'/);
    expect(body).toMatch(/not_found/);
  });

  it("keeps a withdrawn flag as a row, so the limit and the one-flag-per-reader rule hold", () => {
    expect(sql).toMatch(/add column if not exists withdrawn_at timestamptz/);
    expect(sql).not.toMatch(/delete from public\.comment_flags/);
    expect(sql).toMatch(
      /revoke update, delete, truncate on public\.comment_flags from anon, authenticated/,
    );
  });

  it("lets a reader read only their own flags", () => {
    expect(sql).toMatch(
      /create policy comment_flags_read_own on public\.comment_flags\s+for select to authenticated using \(user_id = auth\.uid\(\)\)/,
    );
  });

  it("approving settles the open flags", () => {
    expect(fn("moderate_comment")).toMatch(
      /update public\.comment_flags\s+set settled = true\s+where comment_id = p_comment_id and not settled/,
    );
  });
});

describe("S2/S3 a deleted comment stays deleted", () => {
  it("marks author deletion with author_deleted_at and keeps it out of a client's hands", () => {
    expect(sql).toMatch(/add column if not exists author_deleted_at timestamptz/);
    expect(fn("event_comments_before_insert")).toMatch(/new\.author_deleted_at := null/);
    const del = fn("delete_my_comment");
    expect(del).toMatch(/author_deleted_at = coalesce\(author_deleted_at, now\(\)\)/);
    expect(del).toMatch(/status <> 'removed'/);
  });

  it("backfills the rows deleted before this migration", () => {
    expect(sql).toMatch(
      /set author_deleted_at = updated_at\s+where hidden_reason = 'deleted_by_author' and author_deleted_at is null/,
    );
  });

  it("moderate_comment and admin_delete_comment do not touch an author-deleted comment", () => {
    expect(fn("moderate_comment")).toMatch(/c\.author_deleted_at is null/);
    expect(fn("moderate_comment")).toMatch(/c\.status <> 'removed'/);
    expect(fn("admin_delete_comment")).toMatch(
      /v_status = 'removed' or v_deleted is not null/,
    );
  });

  it("moderators cannot read author-deleted rows, authors still can", () => {
    const policy = sql.match(
      /create policy event_comments_read on public\.event_comments[\s\S]*?;\n/,
    )?.[0];
    expect(policy).toBeDefined();
    expect(policy).toMatch(/user_id = auth\.uid\(\)/);
    expect(policy).toMatch(
      /my_has_permission\('comments\.moderate'\) and author_deleted_at is null/,
    );
    expect(policy).not.toMatch(/is_moderator|has_permission\(auth/);
    // the blocks rule of 0047 is kept
    expect(policy).toMatch(/public\.blocks b/);
  });

  it("lets a wiped author-deleted body be empty", () => {
    expect(sql).toMatch(
      /event_comments_body_check\s+check \(\s+status = 'removed'\s+or author_deleted_at is not null\s+or char_length\(btrim\(body\)\) between 1 and 1000\s+\)/,
    );
  });

  it("wipes text and area 30 days after the author deleted, logs a purge, and does nothing twice", () => {
    const body = fn("wipe_deleted_comment_text");
    expect(body).toMatch(/set body = '', area_geohash = null/);
    expect(body).toMatch(/author_deleted_at < now\(\) - interval '30 days'/);
    expect(body).toMatch(/\(body <> '' or area_geohash is not null\)/);
    expect(body).toMatch(/'purge'/);
  });
});

describe("S5/S6 names and the profile row", () => {
  it("decodes the escaped Sorani, Arabic and Kurmanji spellings of Bumelerze", () => {
    const seeds = unicodeLiterals(
      sql.slice(sql.indexOf("insert into public.reserved_display_terms")),
    );
    expect(seeds).toEqual(
      expect.arrayContaining([
        "bûmelerze",
        "بوومەلەرزە", // بوومەلەرزە
        "بومەلەرزە", // بومەلەرزە
        "بوملێرزە", // بوملێرزە
      ]),
    );
    const plain = sql.match(/\('([a-z]+)', '(brand|word)'\)/g) ?? [];
    for (const term of ["bumelerze", "official", "admin", "moderator", "usgs", "emsc", "gfz"]) {
      expect(plain.join(" ")).toContain(`('${term}',`);
    }
  });

  it("folds names with matching from/to lists (translate drops or shifts letters otherwise)", () => {
    const lists = unicodeLiterals(fn("name_fold"));
    // [accent chars, arabic chars, arabic targets, look-alikes], in order of appearance
    const latinFrom = lists[1] as string;
    const arabicFrom = lists[2] as string;
    const arabicTo = (lists[3] as string) + "01234567890123456789";
    const homoFrom = lists[4] as string;
    const plainTargets = [...fn("name_fold").matchAll(/\n\s+'([a-z]+)'\),/g)].map(
      (m) => m[1] as string,
    );
    expect(plainTargets[0]).toHaveLength([...latinFrom].length);
    expect(plainTargets[1]).toHaveLength([...homoFrom].length);
    // two trailing source letters (hamza forms) are deliberately deleted
    expect([...arabicFrom].length - [...arabicTo].length).toBe(2);
    // every source letter appears once, or translate would use only the first
    for (const set of [latinFrom, arabicFrom, homoFrom]) {
      expect(new Set([...set]).size).toBe([...set].length);
    }
    // case, Arabic-script yeh/kaf/heh variants, spaces and dots are all handled
    const code = fn("name_fold") + fn("name_key");
    expect(code).toMatch(/lower\(coalesce\(p, ''\)\)/);
    expect(arabicFrom).toContain("ي"); // ي
    expect(arabicFrom).toContain("ك"); // ك
    expect(arabicFrom).toContain("ە"); // ە
    expect(code).toMatch(/\[:space:\]\[:punct:\]/);
    expect(code).toMatch(/\(\.\)\\1\+/);
  });

  it("blocks brand terms anywhere, word terms as words, and 0045's reserved usernames as a whole name", () => {
    const body = fn("display_name_reserved");
    expect(body).toMatch(/t\.kind = 'brand'[\s\S]*position\(public\.name_key\(t\.term\) in v_key\) > 0/);
    expect(body).toMatch(/t\.kind = 'word'/);
    expect(body).toMatch(/regexp_split_to_table\(public\.name_fold\(p_name\)/);
    expect(body).toMatch(/from public\.reserved_usernames r/);
  });

  it("keeps the term list private (RLS on, no policy)", () => {
    expect(sql).toMatch(/alter table public\.reserved_display_terms enable row level security/);
    expect(sql).not.toMatch(/create policy \w+ on public\.reserved_display_terms/);
  });

  it("exempts the official rank, and does not re-check an unchanged name", () => {
    const body = fn("profiles_integrity_guard");
    expect(body).toMatch(/ur\.role = 'official'/);
    expect(body).toMatch(
      /tg_op = 'UPDATE' and new\.display_name is not distinct from old\.display_name/,
    );
    expect(body).toMatch(/'profiles: display_name_reserved' using errcode = '23514'/);
  });

  it("makes user_id and created_at immutable and keeps avatars in the owner's folder", () => {
    const body = fn("profiles_integrity_guard");
    expect(body).toMatch(/new\.user_id := old\.user_id/);
    expect(body).toMatch(/new\.created_at := old\.created_at/);
    expect(body).toMatch(/position\('\.\.' in new\.avatar_path\) > 0/);
    expect(body).toMatch(/new\.user_id::text \|\| '\/'/);
    expect(sql).toMatch(
      /create trigger profiles_integrity_guard\s+before insert or update on public\.profiles/,
    );
  });
});

describe("P1-7 audit log v2", () => {
  const ALL_ACTIONS = [
    // 0051's list
    "comment_approve",
    "comment_hide",
    "comment_remove",
    "role_grant",
    "role_revoke",
    "profile_reports_resolve",
    "post_remove",
    "post_reports_dismiss",
    "password_reset",
    // the next batches
    "comment_restore",
    "post_restore",
    "report_reopen",
    "restrict",
    "suspend",
    "lift",
    "profile_reset",
    "person_view",
    "email_reveal",
    "purge",
  ];

  it("adds the new columns", () => {
    for (const column of [
      "target_type text",
      "target_id text",
      "actor_rank text",
      "snapshot jsonb",
      "note text",
    ]) {
      expect(sql).toMatch(
        new RegExp(`alter table public\\.moderation_log add column if not exists ${column}`),
      );
    }
    expect(sql).toMatch(
      /add column if not exists reverted_by uuid references public\.moderation_log \(log_id\) on delete set null/,
    );
  });

  it("allows every action admin tools write, today and in the next batches", () => {
    const list = sql.match(/moderation_log_action_check\s+check \(action in \(([\s\S]*?)\)\);/)?.[1];
    expect(list).toBeDefined();
    const actions = [...(list ?? "").matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(actions.sort()).toEqual([...ALL_ACTIONS].sort());
  });

  it("backfills the target of rows written before", () => {
    expect(sql).toMatch(/update public\.moderation_log l\s+set target_type = case/);
    expect(sql).toMatch(/where l\.target_type is null/);
  });

  it("is append-only for every API role", () => {
    expect(sql).toMatch(
      /revoke insert, update, delete, truncate on public\.moderation_log from anon, authenticated/,
    );
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]* on public\.moderation_log/);
    expect(sql).not.toMatch(/create policy \w+ on public\.moderation_log\s+for (insert|update|delete|all)/);
  });

  it("gives audit.read to moderators and officials, audit.read_all to the official only", () => {
    const seed = sql.match(
      /insert into public\.role_permissions[\s\S]*?on conflict do nothing;/i,
    )?.[0];
    const pairs = [...(seed ?? "").matchAll(/\('(\w+)', '([\w.]+)'\)/g)].map(
      (m) => `${m[1]}:${m[2]}`,
    );
    expect(pairs.sort()).toEqual([
      "moderator:audit.read",
      "official:audit.read",
      "official:audit.read_all",
    ]);
    for (const permission of ["audit.read", "audit.read_all"]) {
      expect(permission).toMatch(/^[a-z]+\.[a-z_]+$/); // 0043's name check
    }
  });

  it("limits moderators to content actions, in the table policy and in admin_activity", () => {
    const policy = sql.match(/create policy moderation_log_read[\s\S]*?;\n/)?.[0] ?? "";
    expect(policy).toMatch(/my_has_permission\('audit\.read_all'\)/);
    expect(policy).toMatch(
      /my_has_permission\('audit\.read'\) and public\.is_content_audit_action\(action\)/,
    );
    const content = fn("is_content_audit_action");
    expect(content).toMatch(/\^\(comment\|post\|report\)_/);
    expect(content).toMatch(/profile_reports_resolve/);
    const body = fn("admin_activity");
    expect(body).toMatch(/v_all or public\.is_content_audit_action\(l\.action\)/);
  });

  it("admin_activity is gated, filtered, newest first, paged and capped at 100", () => {
    const body = fn("admin_activity");
    const gate = body.indexOf("raise exception 'admin_activity: not allowed' using errcode = '42501'");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(body.indexOf("return query"));
    expect(body).toMatch(/not v_all and not public\.my_has_permission\('audit\.read'\)/);
    for (const filter of [
      "p_actor is null or l.actor_id = p_actor",
      "p_action is null or l.action = p_action",
      "p_target_user is null or l.target_user_id = p_target_user",
      "p_before is null or l.created_at < p_before",
    ]) {
      expect(body).toContain(filter);
    }
    expect(body).toMatch(/order by l\.created_at desc, l\.log_id desc/);
    expect(body).toMatch(/limit least\(greatest\(coalesce\(p_limit, 50\), 1\), 100\)/);
    expect(body).toMatch(/p_limit integer default 50/);
  });

  it("never puts comment or post text into the log or the activity answer", () => {
    expect(fn("admin_activity")).not.toMatch(/\bbody\b/);
    expect(sql).not.toMatch(/jsonb_build_object\([^)]*'body'/);
  });

  it("every existing admin RPC writes a row through write_audit with its action", () => {
    const expected: [string, string][] = [
      ["moderate_comment", "'comment_' || p_action"],
      ["admin_delete_comment", "'comment_remove'"],
      ["admin_grant_role", "'role_grant'"],
      ["admin_revoke_role", "'role_revoke'"],
      ["resolve_profile_reports", "'profile_reports_resolve'"],
      ["dismiss_post_reports", "'post_reports_dismiss'"],
      ["admin_remove_post", "'post_remove'"],
      ["admin_reset_password", "'password_reset'"],
    ];
    for (const [name, action] of expected) {
      expect(fn(name)).toContain("public.write_audit(");
      expect(fn(name)).toContain(action);
      // no direct writes to the log any more
      expect(fn(name)).not.toMatch(/insert into public\.moderation_log/);
    }
    expect(fn("wipe_deleted_comment_text")).toContain("'purge'");
  });

  it("records the actor's rank, the target and a snapshot for undo", () => {
    const body = fn("write_audit");
    expect(body).toMatch(/public\.audit_actor_rank\(p_actor\)/);
    expect(body).toMatch(/p_target_type, p_target_id/);
    expect(body).toMatch(/p_snapshot/);
    expect(body).toMatch(/left\(p_reason, 200\), left\(p_note, 500\)/);
    expect(fn("moderate_comment")).toMatch(/'status', v_status/);
    expect(fn("admin_revoke_role")).toMatch(/'granted_by', r\.granted_by/);
    expect(fn("resolve_profile_reports")).toMatch(/'report_ids'/);
    expect(fn("admin_remove_post")).toMatch(/'report_ids'/);
  });

  it("keeps each admin RPC's permission gate before any table access", () => {
    const gates: [string, RegExp][] = [
      ["moderate_comment", /has_permission\(auth\.uid\(\), 'comments\.moderate'\)/],
      ["admin_delete_comment", /has_permission\(v_uid, 'comments\.delete'\)/],
      ["admin_grant_role", /has_permission\(v_uid, 'badges\.grant'\)/],
      ["admin_revoke_role", /has_permission\(v_uid, 'badges\.grant'\)/],
      ["resolve_profile_reports", /has_permission\(auth\.uid\(\), 'comments\.moderate'\)/],
      ["dismiss_post_reports", /has_permission\(auth\.uid\(\), 'comments\.moderate'\)/],
      ["admin_remove_post", /has_permission\(v_uid, 'posts\.delete'\)/],
      ["admin_reset_password", /has_permission\(v_uid, 'accounts\.reset_password'\)/],
    ];
    for (const [name, gate] of gates) {
      const body = fn(name);
      const at = body.search(gate);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(body.search(/\b(from|update|delete|insert)\b/i));
    }
  });

  it("keeps the password reset's safeguards", () => {
    const body = fn("admin_reset_password");
    expect(body).toMatch(/p_user_id <> v_uid and public\.has_permission\(p_user_id, 'accounts\.reset_password'\)/);
    expect(body).toMatch(/extensions\.crypt\(p_new_password, extensions\.gen_salt\('bf', 10\)\)/);
    expect(body).toMatch(/delete from auth\.sessions where user_id = p_user_id/);
  });
});

describe("S7 permission probing", () => {
  it("recreates every policy that called has_permission or is_moderator before revoking them", () => {
    for (const policy of ["profile_reports_read", "post_reports_read", "moderation_log_read", "event_comments_read"]) {
      const text = sql.match(new RegExp(`create policy ${policy}[\\s\\S]*?;\\n`))?.[0] ?? "";
      expect(text).toContain("my_has_permission(");
      expect(text).not.toMatch(/[^_]has_permission\(|is_moderator\(/);
    }
  });

  it("revokes the probe functions only when no other policy depends on them", () => {
    const block = sql.slice(sql.lastIndexOf("do $$"));
    expect(block).toMatch(/from pg_policies/);
    expect(block).toMatch(/revoke execute on function public\.has_permission\(uuid, text\) from anon, authenticated/);
    expect(block).toMatch(/revoke execute on function public\.is_moderator\(uuid\) from anon, authenticated/);
    expect(block).toMatch(/raise notice/);
  });

  it("my_has_permission answers for the caller only", () => {
    expect(fn("my_has_permission")).toMatch(/public\.has_permission\(auth\.uid\(\), p_permission\)/);
  });
});
