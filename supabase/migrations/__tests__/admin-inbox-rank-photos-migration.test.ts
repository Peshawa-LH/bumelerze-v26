import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0060 (the private admin rank, the feedback inbox
 * and the felt photo queue; review P2-1, P2-2, P2-3, S12). Pasted into the SQL
 * editor as one line, so the paste rules are pinned, and so are the promises:
 * the admin rank is invisible to every public reader, admin powers are checked
 * by permission, the log keeps every action another migration added, and the
 * photo queue never returns where or who. The behaviour was exercised against
 * a real Postgres (PGlite) when it was written; these keep it from being
 * edited away.
 */
const raw = readMigration("0060_admin_inbox_admin_rank_photos.sql");
const sql = readCode("0060_admin_inbox_admin_rank_photos.sql");
const fn = (name: string) => functionSource(sql, name);

describe("0060 can be pasted into the SQL editor as one line", () => {
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
    for (const policy of sql.matchAll(/create policy (\w+) on ([\w.]+)/g)) {
      expect(sql).toContain(`drop policy if exists ${policy[1]} on ${policy[2]};`);
    }
    expect(sql).toContain("drop constraint if exists role_permissions_role_check;");
  });

  it("never uses CASE inside an IF condition (PL/pgSQL takes its THEN as the IF's)", () => {
    expect(sql).not.toMatch(/\bif\b[^;]*\bcase\b[^;]*\bthen\b/i);
  });

  it("documents itself in a header, with the owner's grant line", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0060:/);
    expect(raw).toMatch(
      /--\s+insert into public\.private_ranks \(user_id, role, note\) select p\.user_id, 'admin', 'owner personal account' from public\.profiles p where p\.username = 'YOUR_USERNAME' on conflict do nothing;/,
    );
  });

  it("grants the admin rank to nobody", () => {
    expect(sql).not.toMatch(/insert into public\.private_ranks/i);
  });
});

describe("the private admin rank", () => {
  it("lives in its own table no client can read or write", () => {
    expect(createdTables(sql)).toEqual(["private_ranks"]);
    expect(sql).toMatch(/role text not null check \(role in \('admin'\)\)/);
    expect(sql).toContain("alter table public.private_ranks enable row level security;");
    expect(sql).toContain("revoke all on public.private_ranks from anon, authenticated;");
    expect(sql).not.toMatch(/create policy \w+ on public\.private_ranks/);
    expect(sql).not.toMatch(/grant [^;]* on public\.private_ranks/);
  });

  it("is never added to user_roles, the table every public reader uses", () => {
    expect(sql).not.toMatch(/user_roles_role_check/);
    expect(sql).not.toMatch(/insert into public\.user_roles/);
    expect(fn("admin_feedback_grant_badge")).toMatch(
      /p_role not in \('moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner'\)/,
    );
  });

  it("is read only by the permission checks and the audit rank", () => {
    const readers = createdFunctions(sql).filter((name) =>
      /from public\.private_ranks/.test(fn(name)),
    );
    expect(readers.sort()).toEqual(
      [
        "admin_person_flags",
        "audit_actor_rank",
        "has_permission",
        "holds_admin_permission",
        "my_permissions",
      ].sort(),
    );
  });

  it("holds the official permissions except the public voice (hubs.*)", () => {
    expect(sql).toMatch(
      /insert into public\.role_permissions \(role, permission\)\s+select 'admin', rp\.permission\s+from public\.role_permissions rp\s+where rp\.role = 'official'\s+and rp\.permission not like 'hubs\.%'/,
    );
  });

  it("is ranked between official and moderator in the activity log", () => {
    expect(fn("audit_actor_rank")).toContain(
      "array['official', 'admin', 'moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner']",
    );
  });

  it("keeps the internal helpers internal", () => {
    expect(sql).toContain(
      "revoke all on function public.holds_admin_permission(uuid) from public, anon, authenticated;",
    );
    expect(sql).toContain(
      "revoke all on function public.audit_actor_rank(uuid) from public, anon, authenticated;",
    );
    expect(sql).not.toMatch(/grant execute on function public\.has_permission/);
  });
});

describe("permissions and the activity log", () => {
  it("adds feedback.manage (official) and photos.moderate (official, moderator)", () => {
    expect(sql).toMatch(/\('official', 'feedback\.manage'\)/);
    expect(sql).toMatch(/\('official', 'photos\.moderate'\)/);
    expect(sql).toMatch(/\('moderator', 'photos\.moderate'\)/);
    expect(sql).not.toMatch(/\('moderator', 'feedback\.manage'\)/);
  });

  it("extends the action and target lists from what the live constraint holds", () => {
    expect(sql).toMatch(/pg_get_constraintdef\(oid\) like '%comment_approve%'/);
    expect(sql).toMatch(/pg_get_constraintdef\(oid\) like '%target_type%'/);
    expect(sql.match(/regexp_matches\(c\.def,/g)?.length).toBe(4);
    for (const action of [
      "feedback_status",
      "report_photo_approve",
      "report_photo_reject",
    ]) {
      expect(sql).toContain(`'${action}'`);
    }
    // 0055's full list is the floor
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
    ]) {
      expect(sql).toContain(`'${action}'`);
    }
    expect(sql).toContain("'felt_photo'");
  });

  it("does not redefine is_content_audit_action (photo actions match its report_ prefix)", () => {
    expect(createdFunctions(sql)).not.toContain("is_content_audit_action");
    expect(fn("admin_felt_photo_moderate")).toContain("'report_photo_' || p_action");
  });

  it("every write is audited", () => {
    expect(fn("admin_feedback_set_status")).toMatch(
      /write_audit\(\s*v_uid, 'feedback_status', 'feedback'/,
    );
    expect(fn("admin_feedback_grant_badge")).toMatch(
      /perform public\.admin_grant_role\(/,
    );
    expect(fn("admin_feedback_grant_badge")).toMatch(
      /write_audit\(\s*v_uid, 'feedback_status', 'feedback'/,
    );
    expect(fn("admin_felt_photo_moderate")).toMatch(/write_audit\(/);
  });
});

describe("the feedback inbox", () => {
  it("every function checks feedback.manage first", () => {
    for (const name of [
      "admin_feedback_list",
      "admin_feedback_get",
      "admin_feedback_set_status",
      "admin_feedback_grant_badge",
    ]) {
      expect(fn(name)).toMatch(
        /has_permission\((auth\.uid\(\)|v_uid), 'feedback\.manage'\)/,
      );
    }
    expect(fn("admin_feedback_grant_badge")).toMatch(
      /has_permission\(v_uid, 'badges\.grant'\)/,
    );
  });

  it("never returns the device id", () => {
    expect(fn("admin_feedback_list")).not.toMatch(/f\.device_id/);
    const get = fn("admin_feedback_get");
    expect(get).not.toMatch(/'device_id'/);
  });

  it("searches without LIKE wildcards from the user", () => {
    const list = fn("admin_feedback_list");
    expect(list).toMatch(/position\(v_q in lower\(f\.message\)\)/);
    expect(list).not.toMatch(/ilike/i);
  });

  it("a retry with nothing changed writes no audit row", () => {
    expect(fn("admin_feedback_set_status")).toMatch(
      /if f\.status = p_status and f\.triage_note is not distinct from v_note then\s+return null;/,
    );
  });

  it("lets admins read screenshots and nothing more", () => {
    expect(sql).toMatch(
      /create policy feedback_photos_storage_read_admin on storage\.objects\s+for select to authenticated\s+using \(bucket_id = 'feedback-photos' and public\.my_has_permission\('feedback\.manage'\)\);/,
    );
    expect(sql).not.toMatch(/feedback-photos'[^;]*for (delete|update|insert)/);
  });

  it("Ask for review no longer writes the dropped screen column", () => {
    const review = fn("request_restriction_review");
    expect(review).toContain("insert into public.feedback (device_id, user_id, message)");
    expect(review).not.toMatch(/\bscreen\b/);
  });
});

describe("the felt photo queue", () => {
  it("checks photos.moderate", () => {
    for (const name of ["admin_felt_photo_queue", "admin_felt_photo_moderate"]) {
      expect(fn(name)).toMatch(
        /has_permission\((auth\.uid\(\)|v_uid), 'photos\.moderate'\)/,
      );
    }
  });

  it("never returns a coordinate, a geohash, a device or the sender", () => {
    const queue = fn("admin_felt_photo_queue");
    const returns = queue.slice(
      queue.indexOf("returns table"),
      queue.indexOf("language plpgsql"),
    );
    expect(returns).not.toMatch(/\b(lat|lon|geohash\w*|device_id|user_id|report_id)\b/);
    expect(queue).not.toMatch(/fr\.(lat|lon|geohash_p5|device_id|user_id)\b/);
    expect(fn("admin_felt_photo_moderate")).toMatch(
      /'felt_photo', p_photo_id::text,\s+null,/,
    );
  });

  it("a rejected photo stays rejected; repeating a decision writes nothing", () => {
    const moderate = fn("admin_felt_photo_moderate");
    expect(moderate).toMatch(
      /if ph\.moderation_status = v_new then\s+return jsonb_build_object\('status', v_new, 'storage_path', ph\.storage_path, 'log_id', null\);/,
    );
    expect(moderate).toContain("admin_felt_photo_moderate: already_rejected");
  });

  it("moderators read photos and delete only the files of rejected photos", () => {
    expect(sql).toMatch(
      /create policy felt_photos_storage_read_moderator on storage\.objects\s+for select to authenticated\s+using \(bucket_id = 'felt-photos' and public\.my_has_permission\('photos\.moderate'\)\);/,
    );
    expect(sql).toMatch(
      /create policy felt_photos_storage_delete_rejected on storage\.objects\s+for delete to authenticated\s+using \(\s+bucket_id = 'felt-photos'\s+and public\.my_has_permission\('photos\.moderate'\)\s+and public\.felt_photo_file_rejected\(name\)\s+\);/,
    );
    expect(fn("felt_photo_file_rejected")).toContain("ph.moderation_status = 'rejected'");
  });
});

describe("who may call what", () => {
  it("revokes every new function from anon", () => {
    // has_permission keeps 0052's grants (create or replace does not touch them)
    for (const name of createdFunctions(sql).filter((n) => n !== "has_permission")) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.${name}\\([^)]*\\) from public, anon`,
        ),
      );
    }
  });
});
