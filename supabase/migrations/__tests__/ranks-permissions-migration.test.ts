import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
} from "../sql-test-utils";

/**
 * Static checks of migrations 0043 (ranks + permissions), 0044 (admin comment
 * removal) and 0046 (granting rank badges). The migrations are applied by hand
 * in the SQL editor, so these tests pin down the rules that must never drift:
 * what each rank may do, that every check goes through has_permission, and
 * that nothing is callable by `anon` that should not be.
 */
const ranks = readCode("0043_ranks_permissions.sql");
const removal = readCode("0044_comment_removal.sql");
const grants = readCode("0046_admin_roles.sql");
const all = [ranks, removal, grants];

describe("0043 ranks and permissions", () => {
  it("extends the role list with the three credential ranks, in user_roles and role_permissions", () => {
    const list =
      "'official', 'moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner'";
    expect(ranks.split(list).length - 1).toBeGreaterThanOrEqual(2);
  });

  it("records who granted a rank and a private note, and keeps both out of public reads", () => {
    expect(ranks).toMatch(
      /add column if not exists granted_by uuid references auth\.users/i,
    );
    expect(ranks).toMatch(/add column if not exists note text/i);
    expect(ranks).toMatch(
      /revoke select on public\.user_roles from anon, authenticated/i,
    );
    const grant = ranks.match(/grant select \(([^)]*)\) on public\.user_roles/i);
    expect(grant).not.toBeNull();
    const columns = (grant?.[1] ?? "").split(",").map((c) => c.trim());
    expect(columns.sort()).toEqual(["granted_at", "org_name", "role", "user_id"]);
    expect(columns).not.toContain("note");
    expect(columns).not.toContain("granted_by");
  });

  it("seeds exactly the agreed permission matrix", () => {
    const seed = ranks.match(
      /insert into public\.role_permissions[\s\S]*?on conflict do nothing;/i,
    );
    expect(seed).not.toBeNull();
    const pairs = [...(seed?.[0] ?? "").matchAll(/\('(\w+)', '([\w.]+)'\)/g)].map(
      (m) => `${m[1]}:${m[2]}`,
    );
    expect(pairs.sort()).toEqual(
      [
        "official:badges.grant",
        "official:comments.delete",
        "official:comments.moderate",
        "official:hubs.feature",
        "moderator:comments.moderate",
      ].sort(),
    );
  });

  it("gives the credential ranks no permission rows", () => {
    for (const role of [
      "seismologist",
      "professor",
      "researcher",
      "engineer",
      "partner",
    ]) {
      expect(ranks).not.toMatch(new RegExp(`\\('${role}', '[\\w.]+'\\)`));
    }
  });

  it("has_permission is security definer, pinned, null-safe and joins the matrix", () => {
    const fn = functionSource(ranks, "has_permission");
    expect(fn).toMatch(/security definer/i);
    expect(fn).toMatch(/set search_path = public, pg_temp/i);
    expect(fn).toMatch(/p_user is not null/i);
    expect(fn).toMatch(/join public\.role_permissions rp on rp\.role = r\.role/i);
  });

  it("my_permissions reads only the caller's own ranks", () => {
    const fn = functionSource(ranks, "my_permissions");
    expect(fn).toMatch(/r\.user_id = auth\.uid\(\)/i);
    expect(fn).not.toMatch(/my_permissions\s*\(\s*\w+/);
  });

  it("is_moderator and moderate_comment go through has_permission(comments.moderate)", () => {
    expect(functionSource(ranks, "is_moderator")).toMatch(
      /public\.has_permission\(p_user, 'comments\.moderate'\)/,
    );
    const moderate = functionSource(ranks, "moderate_comment");
    expect(moderate).toMatch(
      /public\.has_permission\(auth\.uid\(\), 'comments\.moderate'\)/,
    );
    expect(moderate).not.toMatch(/user_roles/);
    expect(moderate).toMatch(/status <> 'removed'/);
    expect(moderate).toMatch(/insert into public\.moderation_log/i);
  });

  it("logs moderation in a table only moderators can read and nobody can write directly", () => {
    expect(ranks).toMatch(
      /alter table public\.moderation_log enable row level security/i,
    );
    expect(ranks).toMatch(
      /create policy moderation_log_read[\s\S]*has_permission\(auth\.uid\(\), 'comments\.moderate'\)/i,
    );
    expect(ranks).not.toMatch(
      /create policy \w+ on public\.moderation_log\s+for (insert|update|delete)/i,
    );
  });
});

describe("0044 admin removal of comments", () => {
  it("adds the removed status and lets only removed rows have an empty body", () => {
    expect(removal).toMatch(
      /check \(status in \('visible', 'pending', 'hidden', 'removed'\)\)/,
    );
    expect(removal).toMatch(
      /check \(status = 'removed' or char_length\(btrim\(body\)\) between 1 and 1000\)/,
    );
  });

  it("everyone may read a removed comment (as a placeholder); pending and hidden stay private", () => {
    expect(removal).toMatch(/status in \('visible', 'removed'\)/);
    expect(removal).toMatch(/or user_id = auth\.uid\(\)/);
    expect(removal).toMatch(/or public\.is_moderator\(auth\.uid\(\)\)/);
  });

  it("admin_delete_comment needs comments.delete, clears the text and logs who and why", () => {
    const fn = functionSource(removal, "admin_delete_comment");
    expect(fn).toMatch(/security definer/i);
    expect(fn).toMatch(/set search_path = public, pg_temp/i);
    expect(fn).toMatch(/has_permission\(v_uid, 'comments\.delete'\)/);
    expect(fn).toMatch(/status = 'removed'/);
    expect(fn).toMatch(/body = ''/);
    expect(fn).toMatch(/area_geohash = null/);
    expect(fn).toMatch(
      /insert into public\.moderation_log \(actor_id, action, comment_id, target_user_id, reason\)\s+values \(v_uid, 'comment_remove', p_comment_id, v_author, v_reason\)/,
    );
    expect(fn).not.toMatch(/delete from public\.event_comments/i);
  });

  it("the review queue is moderators only and lists pending, then flagged visible comments", () => {
    const fn = functionSource(removal, "moderation_queue");
    expect(fn).toMatch(/has_permission\(auth\.uid\(\), 'comments\.moderate'\)/);
    expect(fn).toMatch(/c\.status = 'pending'/);
    expect(fn).toMatch(/c\.status = 'visible' and c\.flag_count > 0/);
  });
});

describe("0046 granting rank badges", () => {
  it("needs badges.grant and records the granter", () => {
    for (const name of ["admin_grant_role", "admin_revoke_role", "admin_role_holders"]) {
      expect(functionSource(grants, name)).toMatch(
        /has_permission\((?:v_uid|auth\.uid\(\)), 'badges\.grant'\)/,
      );
    }
    const grant = functionSource(grants, "admin_grant_role");
    expect(grant).toMatch(/granted_by/);
    expect(grant).toMatch(/insert into public\.moderation_log/i);
  });

  it("never lets the official rank be granted or revoked from the app", () => {
    for (const name of ["admin_grant_role", "admin_revoke_role"]) {
      const fn = functionSource(grants, name);
      expect(fn).toMatch(
        /p_role not in \('moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner'\)/,
      );
      expect(fn).not.toMatch(/'official'/);
    }
  });
});

describe("hygiene of 0043, 0044 and 0046", () => {
  it("enables row level security on every table it creates", () => {
    for (const sql of all) {
      for (const table of createdTables(sql)) {
        expect(sql).toMatch(
          new RegExp(`alter table public\\.${table} enable row level security`, "i"),
        );
      }
    }
  });

  it("touches no cron schedule", () => {
    for (const sql of all) {
      expect(sql).not.toMatch(/cron\./i);
    }
  });

  it("pins the search path of every security definer function", () => {
    for (const sql of all) {
      for (const name of createdFunctions(sql)) {
        const fn = functionSource(sql, name);
        if (/security definer/i.test(fn)) {
          expect(fn).toMatch(/set search_path = public, pg_temp/i);
        }
      }
    }
  });

  it("revokes every function from public and grants anon only the null-safe checks", () => {
    const anonAllowed = new Set(["is_real_account", "has_permission", "is_moderator"]);
    for (const sql of all) {
      for (const name of createdFunctions(sql)) {
        expect(sql).toMatch(
          new RegExp(`revoke all on function public\\.${name}\\(`, "i"),
        );
        const grantToAnon = new RegExp(
          `grant execute on function public\\.${name}\\([^)]*\\) to [^;]*\\banon\\b`,
          "i",
        ).test(sql);
        expect(grantToAnon).toBe(anonAllowed.has(name));
      }
    }
  });
});
