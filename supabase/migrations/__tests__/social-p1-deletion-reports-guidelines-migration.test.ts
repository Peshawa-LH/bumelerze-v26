import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0056 (social + admin P1, batch 5: account
 * deletion, one list of report reasons, community guidelines). It is applied
 * by hand in the SQL editor as one line, so these pin down what must not
 * drift: the paste-ability, the order of the deletion, what the deleted
 * person's comments become, the reasons list, and the guidelines gate.
 * (The behaviour was exercised against a real Postgres when it was written;
 * these keep it from being edited away.)
 */
const raw = readMigration("0056_social_p1_deletion_reports_guidelines.sql");
const sql = readCode("0056_social_p1_deletion_reports_guidelines.sql");
const fn = (name: string) => functionSource(sql, name);

describe("0056 can be pasted into the SQL editor as one line", () => {
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

  it("never uses the ? jsonb operator (editors read it as a parameter)", () => {
    expect(sql).not.toMatch(/\s\?\s*'/);
  });

  it("is idempotent", () => {
    expect(sql).not.toMatch(/create table (?!if not exists)/i);
    expect(sql).not.toMatch(/create index (?!if not exists)/i);
    expect(sql).not.toMatch(/create function/i);
    for (const m of sql.matchAll(/add constraint (\w+)/gi)) {
      expect(sql).toMatch(new RegExp(`drop constraint if exists ${m[1]}`, "i"));
    }
    expect(sql).toMatch(/on conflict \(user_id\) do nothing/);
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0056:/);
    expect(raw).toMatch(/Error tokens/);
  });
});

describe("one list of report reasons", () => {
  const ALL = [
    "spam",
    "abuse_harassment",
    "rumour_prediction",
    "private_info",
    "sexual_violent",
    "impersonation",
    "other",
  ];

  it("normalises the earlier words to the new ones and knows nothing else", () => {
    const body = fn("normalize_report_reason");
    expect(body).toMatch(/when 'abuse' then 'abuse_harassment'/);
    expect(body).toMatch(/when 'false' then 'rumour_prediction'/);
    expect(body).toMatch(/when 'private' then 'private_info'/);
    for (const reason of ALL) {
      expect(body).toMatch(new RegExp(`when '${reason}' then '${reason}'`));
    }
    expect(body).toMatch(/else null/);
  });

  it("gives the three report tables a note of at most 200 characters", () => {
    for (const table of ["comment_flags", "profile_reports", "post_reports"]) {
      expect(sql).toMatch(
        new RegExp(`alter table public\\.${table} add column if not exists note text`),
      );
      expect(sql).toMatch(
        new RegExp(
          `alter table public\\.${table}\\s+add constraint ${table}_note_check check \\(note is null or char_length\\(note\\) <= 200\\)`,
        ),
      );
    }
    expect(fn("normalize_report_note")).toMatch(/left\(btrim\(coalesce\(p_note, ''\)\), 200\)/);
  });

  it("renames the old rows before the new checks go on", () => {
    const rename = sql.indexOf("update public.comment_flags");
    const check = sql.indexOf("add constraint comment_flags_reason_check");
    expect(rename).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(rename);
  });

  it("allows impersonation for profiles only", () => {
    const check = (table: string) =>
      sql.match(
        new RegExp(`add constraint ${table}_reason_check\\s+check \\(([\\s\\S]*?)\\);`),
      )?.[1] as string;
    expect(check("profile_reports")).toContain("'impersonation'");
    expect(check("comment_flags")).not.toContain("'impersonation'");
    expect(check("post_reports")).not.toContain("'impersonation'");
    for (const table of ["profile_reports", "comment_flags", "post_reports"]) {
      for (const reason of ALL.filter((r) => r !== "impersonation")) {
        expect(check(table)).toContain(`'${reason}'`);
      }
    }
    expect(fn("report_post")).toMatch(/v_reason = 'impersonation'/);
    expect(fn("comment_flags_before_insert")).toMatch(/new\.reason = 'impersonation'/);
  });

  it("keeps the batch-1 and batch-3 rules: restriction guard, 20 reports a day, 30 flags a day, guests do not count", () => {
    expect(fn("report_profile")).toMatch(/assert_not_restricted\(v_uid, 'report_profile'\)/);
    expect(fn("report_post")).toMatch(/assert_not_restricted\(v_uid, 'report_post'\)/);
    expect(fn("report_profile")).toMatch(/>= 20/);
    expect(fn("report_post")).toMatch(/>= 20/);
    const flags = fn("comment_flags_before_insert");
    expect(flags).toMatch(/assert_not_restricted\(new\.user_id, 'comment_flags'\)/);
    expect(flags).toMatch(/new\.counts := not coalesce\(v_anonymous, true\)/);
    expect(flags).toMatch(/v_recent >= 30/);
  });

  it("drops the old two-argument reporters so a replay cannot leave two versions", () => {
    expect(sql).toMatch(/drop function if exists public\.report_profile\(uuid, text\)/);
    expect(sql).toMatch(/drop function if exists public\.report_post\(uuid, text\)/);
    expect(fn("report_profile")).toMatch(/p_note text default null/);
    expect(fn("report_post")).toMatch(/p_note text default null/);
  });

  it("returns the last reason and note from the three admin queues, still moderators only", () => {
    expect(fn("moderation_queue")).toMatch(/last_reason text,\s*last_note text/);
    expect(fn("post_queue")).toMatch(/last_note text/);
    expect(fn("moderation_profile_reports")).toMatch(/last_note text/);
    for (const name of ["moderation_queue", "post_queue", "moderation_profile_reports"]) {
      expect(fn(name)).toMatch(/has_permission\(auth\.uid\(\), 'comments\.moderate'\)/);
      expect(sql).toMatch(new RegExp(`drop function if exists public\\.${name}\\(`));
    }
    expect(fn("moderation_queue")).toMatch(/not f\.settled\s+and f\.withdrawn_at is null/);
  });

  it("keeps the internal helpers away from clients", () => {
    for (const helper of ["normalize_report_reason(text)", "normalize_report_note(text)"]) {
      expect(sql).toContain(
        `revoke all on function public.${helper} from public, anon, authenticated;`,
      );
    }
  });
});

describe("community guidelines", () => {
  it("adds one private table keyed on the auth user, cascading with the person", () => {
    expect(createdTables(sql)).toEqual(["guidelines_acceptance"]);
    expect(sql).toMatch(
      /user_id uuid primary key references auth\.users \(id\) on delete cascade/,
    );
    expect(sql).toMatch(/alter table public\.guidelines_acceptance enable row level security/);
    expect(sql).toMatch(/revoke all on public\.guidelines_acceptance from anon, authenticated/);
    expect(sql).toMatch(/using \(user_id = auth\.uid\(\)\)/);
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*guidelines_acceptance/i);
  });

  it("does not let a client read the source column", () => {
    expect(sql).toMatch(
      /grant select \(user_id, version, age_confirmed, accepted_at\)\s+on public\.guidelines_acceptance to authenticated/,
    );
  });

  it("accept_guidelines needs a session, the age tick and the current version", () => {
    const accept = fn("accept_guidelines");
    expect(accept).toMatch(/v_uid is null[\s\S]*not_signed_in/);
    expect(accept).toMatch(/p_age_ok is not true[\s\S]*age_required/);
    expect(accept).toMatch(/p_version is distinct from public\.current_guidelines_version\(\)[\s\S]*version_mismatch/);
    expect(accept).toMatch(/on conflict \(user_id\) do update/);
    expect(sql).toMatch(
      /revoke all on function public\.accept_guidelines\(text, boolean, text\) from public, anon/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.accept_guidelines\(text, boolean, text\) to authenticated/,
    );
  });

  it("refuses with guidelines_required in the comment and the post insert, after the restriction guard", () => {
    for (const name of ["event_comments_before_insert", "profile_posts_before_insert"]) {
      const body = fn(name);
      const restricted = body.indexOf("assert_not_restricted");
      const guidelines = body.indexOf("assert_guidelines_accepted");
      expect(restricted).toBeGreaterThan(0);
      expect(guidelines).toBeGreaterThan(restricted);
    }
    expect(fn("assert_guidelines_accepted")).toMatch(
      /auth\.uid\(\) is not null and not public\.guidelines_accepted\(p_user\)[\s\S]*guidelines_required/,
    );
  });

  it("accepting means the current version, so a bump asks everybody again", () => {
    expect(fn("guidelines_accepted")).toMatch(
      /g\.version = public\.current_guidelines_version\(\)/,
    );
    expect(fn("current_guidelines_version")).toMatch(/select 'g1'::text/);
  });

  it("backfills the accounts that accepted the terms, and rank holders, as 'backfill' without the age tick", () => {
    expect(sql).toMatch(/from public\.profile_private pp\s+where pp\.terms_accepted_at is not null/);
    expect(sql).toMatch(/from public\.user_roles ur/);
    const inserts = [...sql.matchAll(/insert into public\.guidelines_acceptance[\s\S]*?on conflict/g)];
    expect(inserts.length).toBeGreaterThanOrEqual(3);
    expect(sql).toMatch(/current_guidelines_version\(\), false, 'backfill'/);
  });

  it("keeps the internal guards away from clients", () => {
    expect(sql).toContain("revoke all on function public.guidelines_accepted(uuid) from public, anon, authenticated;");
    expect(sql).toContain(
      "revoke all on function public.assert_guidelines_accepted(uuid, text) from public, anon, authenticated;",
    );
  });
});

describe("delete my account", () => {
  const del = fn("delete_my_account");

  it("still refuses a guest and a missing session", () => {
    expect(del).toMatch(/v_uid is null or coalesce\(\(auth\.jwt\(\) ->> 'is_anonymous'\)::boolean, false\)/);
    expect(del).toMatch(/no account to delete/);
  });

  it("deletes the homes the person owns, by owner column or owner membership, and an emptied complex", () => {
    expect(del).toMatch(/t\.owner_user_id = v_uid/);
    expect(del).toMatch(/m\.role = 'owner'/);
    expect(del).toMatch(/delete from public\.home_tags where tag_id = any \(v_tags\)/);
    expect(del).toMatch(/delete from public\.building_complexes c/);
    expect(del).toMatch(/not exists \(select 1 from public\.home_tags h where h\.complex_id = c\.complex_id\)/);
  });

  it("blanks every comment of the person and marks it, before the user row goes", () => {
    expect(del).toMatch(/update public\.event_comments c\s+set body = '',\s+area_geohash = null,\s+user_id = null,\s+account_deleted_at = now\(\)/);
    expect(del.indexOf("update public.event_comments")).toBeLessThan(del.indexOf("delete from auth.users"));
    // waiting, hidden and flagged comments become hidden author-deleted blanks
    expect(del).toMatch(/hidden_reason = case\s+when c\.status in \('visible', 'removed'\) then c\.hidden_reason\s+else 'account_deleted' end/);
    expect(del).toMatch(/update public\.comment_flags f\s+set settled = true/);
  });

  it("lets the body check accept the blank", () => {
    expect(sql).toMatch(/or account_deleted_at is not null/);
    expect(fn("event_comments_before_insert")).toMatch(/new\.account_deleted_at := null/);
  });

  it("purges the evidence unless a restriction or an appeal is active", () => {
    expect(del).toMatch(/r\.level in \('restrict', 'suspend'\) or r\.appeal_requested_at is not null/);
    expect(del).toMatch(/r\.lifted_at is null/);
    expect(del).toMatch(/if not v_keep_evidence then\s+delete from public\.moderation_evidence where author_id = v_uid/);
  });

  it("keeps felt reports (unlinked), keeps the feedback message without the contact, deletes felt comments", () => {
    expect(del).toMatch(/update public\.felt_reports set user_id = null where user_id = v_uid/);
    expect(del).not.toMatch(/delete from public\.felt_reports/);
    expect(del).toMatch(/update public\.feedback set user_id = null, contact = null where user_id = v_uid/);
    expect(del).not.toMatch(/delete from public\.feedback/);
    expect(del).toMatch(/delete from public\.felt_comments where user_id = v_uid/);
  });

  it("keeps the audit rows but drops the before-image of a name reset", () => {
    expect(del).toMatch(/update public\.moderation_log\s+set snapshot = null\s+where target_user_id = v_uid and action = 'profile_reset'/);
    expect(del).not.toMatch(/delete from public\.moderation_log/);
  });

  it("is callable by signed-in identities only", () => {
    expect(sql).toContain("revoke all on function public.delete_my_account() from public, anon;");
    expect(sql).toContain("grant execute on function public.delete_my_account() to authenticated;");
  });
});

describe("what this migration defines", () => {
  it("replaces exactly these functions", () => {
    expect(createdFunctions(sql).sort()).toEqual(
      [
        "accept_guidelines",
        "assert_guidelines_accepted",
        "comment_flags_before_insert",
        "current_guidelines_version",
        "delete_my_account",
        "event_comments_before_insert",
        "guidelines_accepted",
        "moderation_profile_reports",
        "moderation_queue",
        "normalize_report_note",
        "normalize_report_reason",
        "post_queue",
        "profile_posts_before_insert",
        "report_post",
        "report_profile",
      ].sort(),
    );
  });
});
