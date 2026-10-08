import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0053 (social + admin P1, batch 2: undo for
 * people, restore for admins). It is applied by hand in the SQL editor as one
 * line, so these pin down what must not drift: the paste-ability, the undo
 * windows, the privacy of the evidence table, the permission split between
 * moderator and official, and the idempotency of every restore. (The behaviour
 * itself was exercised against a real Postgres when it was written; these keep
 * it from being edited away.)
 */
const raw = readMigration("0053_social_p1_undo_restore.sql");
const sql = readCode("0053_social_p1_undo_restore.sql");
const fn = (name: string) => functionSource(sql, name);

describe("0053 can be pasted into the SQL editor as one line", () => {
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
    expect(sql).not.toMatch(/create unique index (?!if not exists)/i);
    expect(sql).not.toMatch(/add column (?!if not exists)/i);
    expect(sql).not.toMatch(/create function/i);
    for (const m of sql.matchAll(/create policy (\w+) on ([\w.]+)/gi)) {
      expect(sql).toMatch(new RegExp(`drop policy if exists ${m[1]} on ${m[2]}`, "i"));
    }
    for (const m of sql.matchAll(/add constraint (\w+)/gi)) {
      expect(sql).toMatch(new RegExp(`drop constraint if exists ${m[1]}`, "i"));
    }
    expect(sql).toMatch(/on conflict do nothing/);
  });

  it("documents itself and the permission split in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0053:/);
    expect(raw).toMatch(/Who may undo what \(the permission split\)/);
  });

  it("schedules the nightly purge after unscheduling any earlier one, and keeps 0052's job", () => {
    const unschedule = sql.indexOf("cron.unschedule('purge_expired_social')");
    const schedule = sql.indexOf("cron.schedule('purge_expired_social'");
    expect(unschedule).toBeGreaterThan(-1);
    expect(schedule).toBeGreaterThan(unschedule);
    expect(sql).toMatch(/'25 3 \* \* \*'/);
    expect(sql).not.toMatch(/wipe_deleted_comment_text'\)/);
  });
});

describe("0053 functions", () => {
  const definers = [
    "delete_my_comment",
    "restore_my_comment",
    "delete_my_post",
    "restore_my_post",
    "my_recently_deleted",
    "unfollow_user",
    "decline_follow_request",
    "undo_unfollow_user",
    "undo_decline_follow_request",
    "moderate_comment",
    "admin_delete_comment",
    "admin_remove_post",
    "admin_restore_comment",
    "admin_restore_post",
    "admin_reopen_reports",
    "admin_undo_action",
    "admin_hidden_removed",
    "purge_expired_social",
  ];

  it("defines the expected set", () => {
    expect(createdFunctions(sql).sort()).toEqual([...definers].sort());
  });

  it("makes every function security definer with a pinned search_path", () => {
    for (const name of definers) {
      expect(fn(name)).toMatch(/security definer/i);
      expect(fn(name)).toMatch(/set search_path = public, (extensions, )?pg_temp/i);
    }
  });

  it("grants the client-facing functions to signed-in accounts only", () => {
    for (const sig of [
      "delete_my_comment\\(uuid\\)",
      "restore_my_comment\\(uuid\\)",
      "delete_my_post\\(uuid\\)",
      "restore_my_post\\(uuid\\)",
      "my_recently_deleted\\(\\)",
      "unfollow_user\\(uuid\\)",
      "decline_follow_request\\(uuid\\)",
      "undo_unfollow_user\\(uuid\\)",
      "undo_decline_follow_request\\(uuid\\)",
      "moderate_comment\\(uuid, text, text\\)",
      "admin_delete_comment\\(uuid, text\\)",
      "admin_remove_post\\(uuid, text\\)",
      "admin_restore_comment\\(uuid, text\\)",
      "admin_restore_post\\(uuid, text\\)",
      "admin_reopen_reports\\(uuid, text\\)",
      "admin_undo_action\\(uuid, text\\)",
      "admin_hidden_removed\\(timestamptz, integer\\)",
    ]) {
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${sig} from public, anon;`),
      );
      expect(sql).toMatch(
        new RegExp(`grant execute on function public\\.${sig} to authenticated;`),
      );
    }
  });

  it("keeps the nightly purge internal (service role only)", () => {
    expect(sql).toMatch(
      /revoke all on function public\.purge_expired_social\(\) from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.purge_expired_social\(\) to service_role;/,
    );
  });
});

describe("P1-5 undo for my own comments", () => {
  it("remembers the status the comment had, once", () => {
    expect(sql).toMatch(/add column if not exists author_deleted_prev_status text/);
    expect(sql).toMatch(/add column if not exists author_deleted_prev_reason text/);
    const body = fn("delete_my_comment");
    expect(body).toMatch(
      /author_deleted_prev_status = case\s+when author_deleted_at is null then status else author_deleted_prev_status end/,
    );
    // 0052's guarantees are kept
    expect(body).toMatch(/author_deleted_at = coalesce\(author_deleted_at, now\(\)\)/);
    expect(body).toMatch(/status <> 'removed'/);
    expect(body).toMatch(/errcode = '42501'/);
  });

  it("restores only for the author, within 24 hours, never a removed comment, and quietly twice", () => {
    const body = fn("restore_my_comment");
    expect(body).toMatch(/cm\.user_id = v_uid/);
    expect(body).toMatch(/c\.deleted_at < now\(\) - interval '24 hours'/);
    expect(body).toMatch(/restore_my_comment: expired/);
    expect(body).toMatch(
      /c\.status = 'removed'[\s\S]*restore_my_comment: not_restorable/,
    );
    expect(body).toMatch(/if c\.body = ''/);
    expect(body).toMatch(/if c\.deleted_at is null then\s+return;/);
    // back to the status it had; a legacy row with no record is safe
    expect(body).toMatch(/c\.prev_status,\s+case when exists/);
    expect(body).toMatch(/else 'pending' end/);
    expect(body).toMatch(/author_deleted_at = null/);
  });

  it("lists my deleted comments and posts of the last 24 hours, my own only", () => {
    const body = fn("my_recently_deleted");
    expect(body).toMatch(/c\.user_id = auth\.uid\(\)/);
    expect(body).toMatch(/po\.user_id = auth\.uid\(\)/);
    expect(body.match(/interval '24 hours'/g)?.length).toBeGreaterThanOrEqual(4);
    expect(body).toMatch(/limit 50/);
  });
});

describe("P1-5 posts: soft delete and S8", () => {
  it("adds the deleted status and a deleted_at column, replacing the status check by shape", () => {
    expect(sql).toMatch(/add column if not exists deleted_at timestamptz/);
    expect(sql).toMatch(
      /profile_posts_status_check\s+check \(status in \('visible', 'removed', 'deleted'\)\)/,
    );
    expect(sql).toMatch(/pg_get_constraintdef\(oid\) like '%''visible''%'/);
  });

  it("hides a deleted post from everybody, its author included, and keeps the private-account rule", () => {
    const policy = sql.match(
      /create policy profile_posts_read on public\.profile_posts[\s\S]*?;\n/,
    )?.[0];
    expect(policy).toBeDefined();
    expect(policy).toMatch(/user_id = auth\.uid\(\) and status <> 'deleted'/);
    expect(policy).toMatch(/status = 'visible' and public\.can_view_posts_of\(user_id\)/);
  });

  it("no longer lets a client delete a post, or read removed_by or deleted_at (S8)", () => {
    expect(sql).toMatch(
      /drop policy if exists profile_posts_delete on public\.profile_posts/,
    );
    expect(sql).toMatch(
      /revoke delete on public\.profile_posts from anon, authenticated/,
    );
    expect(sql).toMatch(
      /revoke select on public\.profile_posts from anon, authenticated/,
    );
    const grant = sql.match(
      /grant select \(([^)]*)\)\s+on public\.profile_posts to anon, authenticated/,
    )?.[1];
    expect(grant).toBeDefined();
    const columns = (grant ?? "").split(",").map((c) => c.trim());
    expect(columns).toEqual(
      expect.arrayContaining(["post_id", "user_id", "body", "status", "created_at"]),
    );
    expect(columns).not.toContain("removed_by");
    expect(columns).not.toContain("deleted_at");
  });

  it("delete_my_post refuses a removed post and is quiet when repeated", () => {
    const body = fn("delete_my_post");
    expect(body).toMatch(/po\.user_id = v_uid/);
    expect(body).toMatch(
      /v_status = 'removed'[\s\S]*delete_my_post: forbidden' using errcode = '42501'/,
    );
    expect(body).toMatch(/v_status = 'deleted' then\s+return;/);
    expect(body).toMatch(/set status = 'deleted', deleted_at = now\(\)/);
  });

  it("restore_my_post works within 24 hours only, and never on a removed post", () => {
    const body = fn("restore_my_post");
    expect(body).toMatch(/po\.user_id = v_uid/);
    expect(body).toMatch(/v_deleted < now\(\) - interval '24 hours'/);
    expect(body).toMatch(/restore_my_post: expired/);
    expect(body).toMatch(/v_status <> 'deleted'[\s\S]*restore_my_post: not_restorable/);
    expect(body).toMatch(/v_status = 'visible' then\s+return;/);
  });

  it("an admin removal leaves an author-deleted post alone", () => {
    expect(fn("admin_remove_post")).toMatch(/v_status in \('removed', 'deleted'\)/);
  });
});

describe("P1-5 follows: 60 seconds of undo", () => {
  it("keeps what was removed in a private table nobody on the API can touch", () => {
    expect(createdTables(sql)).toContain("follow_undo");
    expect(sql).toMatch(/alter table public\.follow_undo enable row level security/);
    expect(sql).toMatch(/revoke all on public\.follow_undo from anon, authenticated/);
    expect(sql).not.toMatch(/create policy \w+ on public\.follow_undo/);
    expect(sql).toMatch(/primary key \(follower_id, followee_id\)/);
  });

  it("records an unfollow and a decline only when a row was really removed", () => {
    for (const name of ["unfollow_user", "decline_follow_request"]) {
      const body = fn(name);
      expect(body).toMatch(/delete from public\.follows/);
      expect(body).toMatch(/returning .*created_at into/);
      expect(body).toMatch(/if found then\s+insert into public\.follow_undo/);
      expect(body).toMatch(/on conflict \(follower_id, followee_id\) do update/);
    }
    expect(fn("decline_follow_request")).toMatch(/status = 'pending'/);
  });

  it("gives the exact row back within 60 seconds, refuses blocked pairs and repeats quietly", () => {
    for (const name of ["undo_unfollow_user", "undo_decline_follow_request"]) {
      const body = fn(name);
      expect(body).toMatch(/u\.created_at < now\(\) - interval '60 seconds'/);
      expect(body).toMatch(new RegExp(`${name}: expired`));
      expect(body).toMatch(new RegExp(`${name}: blocked' using errcode = '42501'`));
      expect(body).toMatch(new RegExp(`${name}: not_found' using errcode = 'P0002'`));
      expect(body).toMatch(
        /insert into public\.follows \(follower_id, followee_id, status, created_at\)/,
      );
      expect(body).toMatch(/u\.follow_created_at/);
      expect(body).toMatch(/on conflict do nothing/);
      expect(body).toMatch(/return v_status;/);
    }
    // the accepted state of a private account comes back as accepted
    expect(fn("undo_unfollow_user")).toMatch(
      /case when u\.status = 'pending' and not v_private then 'accepted' else u\.status end/,
    );
    // only the follower can undo an unfollow, only the followee a decline
    expect(fn("undo_unfollow_user")).toMatch(/fu\.follower_id = v_uid/);
    expect(fn("undo_decline_follow_request")).toMatch(/fu\.followee_id = v_uid/);
  });
});

describe("P1-6 evidence", () => {
  it("is a private table: RLS on, no policy, no client privilege", () => {
    expect(createdTables(sql)).toContain("moderation_evidence");
    expect(sql).toMatch(
      /alter table public\.moderation_evidence enable row level security/,
    );
    expect(sql).toMatch(
      /revoke all on public\.moderation_evidence from anon, authenticated/,
    );
    expect(sql).not.toMatch(/create policy \w+ on public\.moderation_evidence/);
    expect(sql).not.toMatch(/grant [^;]* on public\.moderation_evidence/);
  });

  it("expires after 90 days and has one row per comment or post", () => {
    expect(sql).toMatch(
      /expires_at timestamptz not null default now\(\) \+ interval '90 days'/,
    );
    expect(sql).toMatch(
      /create unique index if not exists moderation_evidence_comment_idx/,
    );
    expect(sql).toMatch(/create unique index if not exists moderation_evidence_post_idx/);
  });

  it("is copied BEFORE the text is wiped, and the log row id is stored on it", () => {
    for (const name of ["admin_delete_comment", "admin_remove_post"]) {
      const body = fn(name);
      const copy = body.indexOf("insert into public.moderation_evidence");
      const wipe = body.search(/body = ''/);
      expect(copy).toBeGreaterThan(-1);
      expect(wipe).toBeGreaterThan(copy);
      expect(body).toMatch(/update public\.moderation_evidence set log_id = v_log/);
      expect(body).toMatch(/expires_at = now\(\) \+ interval '90 days'/);
    }
    expect(fn("admin_delete_comment")).toMatch(/c\.body, c\.area_geohash/);
  });
});

describe("P1-6 restore: permission split", () => {
  it("adds content.restore for the official rank only", () => {
    expect(sql).toMatch(/\('official', 'content\.restore'\)/);
    expect(sql).not.toMatch(/\('moderator', 'content\.restore'\)/);
  });

  it("a hidden comment needs comments.moderate; a removed one additionally content.restore", () => {
    const body = fn("admin_restore_comment");
    expect(body).toMatch(/has_permission\(v_uid, 'comments\.moderate'\)/);
    expect(body).toMatch(
      /c\.status = 'removed' then\s+if not public\.has_permission\(v_uid, 'content\.restore'\)/,
    );
  });

  it("restoring a post needs content.restore", () => {
    expect(fn("admin_restore_post")).toMatch(
      /has_permission\(v_uid, 'content\.restore'\)/,
    );
  });

  it("reopening reports needs comments.moderate; giving a rank back needs badges.grant", () => {
    expect(fn("admin_reopen_reports")).toMatch(
      /has_permission\(v_uid, 'comments\.moderate'\)/,
    );
    expect(fn("admin_undo_action")).toMatch(/has_permission\(v_uid, 'badges\.grant'\)/);
  });

  it("the author's own deletion is never restorable by an admin (S2)", () => {
    expect(fn("admin_restore_comment")).toMatch(
      /c\.deleted_at is not null then\s+raise exception 'admin_restore_comment: not_restorable'/,
    );
    expect(fn("admin_restore_post")).toMatch(
      /p\.status <> 'removed' then\s+raise exception/,
    );
  });
});

describe("P1-6 restore: windows, evidence and idempotency", () => {
  it("allows a removal to be restored for 30 days only", () => {
    expect(fn("admin_restore_comment")).toMatch(/v_at < now\(\) - interval '30 days'/);
    expect(fn("admin_restore_post")).toMatch(/v_at < now\(\) - interval '30 days'/);
    expect(fn("admin_restore_comment")).toMatch(/admin_restore_comment: expired/);
  });

  it("brings the text back from the evidence copy, and refuses when there is none", () => {
    expect(fn("admin_restore_comment")).toMatch(
      /from public\.moderation_evidence e\s+where e\.comment_id = p_comment_id/,
    );
    expect(fn("admin_restore_comment")).toMatch(/body = ev\.body/);
    expect(fn("admin_restore_post")).toMatch(
      /from public\.moderation_evidence e\s+where e\.post_id = p_post_id/,
    );
    expect(fn("admin_restore_post")).toMatch(/body = ev\.body/);
    expect(fn("admin_restore_post")).toMatch(/admin_restore_post: not_restorable/);
  });

  it("puts a restored comment back to the state it had before (a record-less hide waits for review)", () => {
    const body = fn("admin_restore_comment");
    expect(body).toMatch(/l\.snapshot ->> 'status' in \('visible', 'pending'\)/);
    expect(body).toMatch(/else 'pending' end/);
    expect(body).toMatch(
      /l\.snapshot ->> 'status' in \('visible', 'pending', 'hidden'\)/,
    );
  });

  it("reopens the reports a post removal closed", () => {
    const body = fn("admin_restore_post");
    expect(body).toMatch(/update public\.post_reports r\s+set resolved_at = null/);
    expect(body).toMatch(/jsonb_array_elements_text\(l\.snapshot -> 'report_ids'\)/);
  });

  it("every restore writes one audit row, sets reverted_by on the original, and does nothing twice", () => {
    for (const [name, action] of [
      ["admin_restore_comment", "comment_restore"],
      ["admin_restore_post", "post_restore"],
      ["admin_reopen_reports", "report_reopen"],
      ["admin_undo_action", "role_restore"],
    ] as const) {
      const body = fn(name);
      expect(body).toMatch(new RegExp(`write_audit\\(\\s*v_uid, '${action}'`));
      expect(body).toMatch(
        /update public\.moderation_log set reverted_by = v_new where log_id = /,
      );
    }
    expect(fn("admin_restore_comment")).toMatch(/else\s+return;\s+end if;/);
    expect(fn("admin_restore_post")).toMatch(/p\.status = 'visible' then\s+return;/);
    expect(fn("admin_reopen_reports")).toMatch(
      /if l\.reverted_by is not null then\s+return;/,
    );
    expect(fn("admin_undo_action")).toMatch(
      /if l\.reverted_by is not null then\s+return;/,
    );
  });

  it("the dispatcher undoes only the newest standing action of a comment, in the state it left it", () => {
    const body = fn("admin_undo_action");
    expect(body).toMatch(
      /v_latest is distinct from l\.log_id or v_current is distinct from v_expected/,
    );
    expect(body).toMatch(/'comment_hide' then 'hidden' else 'removed'/);
    // the CASE is computed outside the IF: plpgsql would cut an IF condition at the CASE's own THEN
    expect(body).not.toMatch(/if [^;]*\bcase\b[^;]*\bthen\b[^;]*\bend\b[^;]*\bthen\b/);
  });

  it("a revoked rank comes back from the snapshot, only for the grantable ranks, and not twice", () => {
    const body = fn("admin_undo_action");
    expect(body).toMatch(
      /v_role not in \('moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner'\)/,
    );
    expect(body).toMatch(/where r\.user_id = l\.target_user_id and r\.role = v_role/);
    expect(body).toMatch(/l\.snapshot ->> 'org_name'/);
    expect(body).toMatch(/l\.snapshot ->> 'note'/);
  });

  it("approving a hidden comment marks the earlier hide as undone, so no stale Undo is offered", () => {
    expect(fn("moderate_comment")).toMatch(
      /set reverted_by = v_log\s+where comment_id = p_comment_id\s+and action = 'comment_hide'\s+and reverted_by is null/,
    );
    // 0052's rules are kept
    expect(fn("moderate_comment")).toMatch(/c\.author_deleted_at is null/);
    expect(fn("moderate_comment")).toMatch(/set settled = true/);
  });

  it("allows the new log action, keeping every earlier one", () => {
    const list = sql.match(
      /moderation_log_action_check\s+check \(action in \(([\s\S]*?)\)\);/,
    )?.[1];
    expect(list).toBeDefined();
    const actions = [...(list ?? "").matchAll(/'(\w+)'/g)].map((m) => m[1]);
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
      "restrict",
      "suspend",
      "lift",
      "person_view",
      "email_reveal",
      "purge",
    ]) {
      expect(actions).toContain(action);
    }
  });
});

describe("P1-6 the Hidden and removed list", () => {
  const body = fn("admin_hidden_removed");

  it("is for moderators and above, 30 days back, with keyset paging", () => {
    expect(body).toMatch(/my_has_permission\('comments\.moderate'\)/);
    expect(body).toMatch(/r\.acted_at > now\(\) - interval '30 days'/);
    expect(body).toMatch(/p_before is null or r\.acted_at < p_before/);
    expect(body).toMatch(/least\(greatest\(coalesce\(p_limit, 50\), 1\), 100\)/);
  });

  it("shows the evidence text of removed items to audit.read_all only", () => {
    expect(body).toMatch(
      /v_full boolean := public\.my_has_permission\('audit\.read_all'\)/,
    );
    expect(body).toMatch(/when v_full then x\.body/);
    expect(body).toMatch(/case when v_full then x\.body else null end/);
  });

  it("tells the caller whether Restore will work, without leaking author-deleted comments", () => {
    expect(body).toMatch(
      /v_rest boolean := public\.my_has_permission\('content\.restore'\)/,
    );
    expect(body).toMatch(/v_rest and x\.evidence_id is not null/);
    expect(body).toMatch(/c\.author_deleted_at is null/);
  });
});

describe("P1-6 the nightly purge", () => {
  const body = fn("purge_expired_social");

  it("purges author-deleted posts after 30 days, evidence after 90 days and finished undo rows", () => {
    expect(body).toMatch(
      /status = 'deleted'\s+and deleted_at < now\(\) - interval '30 days'/,
    );
    expect(body).toMatch(
      /delete from public\.moderation_evidence\s+where expires_at < now\(\)/,
    );
    expect(body).toMatch(
      /delete from public\.follow_undo\s+where created_at < now\(\) - interval '1 day'/,
    );
  });

  it("logs a purge row only when it removed something, so a second run is silent", () => {
    expect(body).toMatch(/if n_posts > 0 then/);
    expect(body).toMatch(/if n_evidence > 0 then/);
    expect(body.match(/'purge'/g)?.length).toBe(2);
  });
});
