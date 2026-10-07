import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
} from "../sql-test-utils";

/**
 * Static checks of migration 0050 (text posts on public profiles). Privacy
 * first: the read policy must never hand a private account's posts to a
 * non-follower, and a block must hide posts both ways. The behaviour was also
 * run against a scratch Postgres (PGlite) on top of 0035/0036/0043-0049; these
 * tests pin the rules that must not drift.
 */
const sql = readCode("0050_profile_posts.sql");

/** The text of one `create policy <name> on public.<table> ... ;`. */
function policy(name: string): string {
  const match = sql.match(new RegExp(`create policy ${name} on[\\s\\S]*?;`, "i"));
  if (!match) {
    throw new Error(`policy ${name} not found`);
  }
  return match[0];
}

describe("0050 table and writes", () => {
  it("creates profile_posts with the agreed columns and a 1-500 character body", () => {
    expect(sql).toMatch(/create table if not exists public\.profile_posts/i);
    for (const column of [
      "post_id uuid primary key",
      "user_id uuid not null references auth\\.users \\(id\\) on delete cascade",
      "status text not null default 'visible' check \\(status in \\('visible', 'removed'\\)\\)",
      "created_at timestamptz",
      "updated_at timestamptz",
      "removed_by uuid",
      "removed_reason text",
    ]) {
      expect(sql).toMatch(new RegExp(column, "i"));
    }
    expect(sql).toMatch(
      /check \(char_length\(body\) <= 500 and \(status = 'removed' or char_length\(btrim\(body\)\) >= 1\)\)/,
    );
  });

  it("enables row level security on every table it creates", () => {
    expect(createdTables(sql).sort()).toEqual(["post_reports", "profile_posts"]);
    for (const table of createdTables(sql)) {
      expect(sql).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`, "i"),
      );
    }
  });

  it("lets a client write only the text: column-level insert and update grants", () => {
    expect(sql).toMatch(/revoke all on public\.profile_posts from anon, authenticated/i);
    expect(sql).toMatch(
      /grant insert \(user_id, body\) on public\.profile_posts to authenticated/i,
    );
    expect(sql).toMatch(
      /grant update \(body\) on public\.profile_posts to authenticated/i,
    );
    expect(sql).toMatch(/grant select on public\.profile_posts to anon, authenticated/i);
    // anon never writes
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*to anon/i);
  });

  it("allows an insert only by a real account, for itself, with a username", () => {
    const p = policy("profile_posts_insert");
    expect(p).toMatch(/for insert to authenticated/i);
    expect(p).toMatch(/user_id = auth\.uid\(\)/);
    expect(p).toMatch(/public\.is_real_account\(\)/);
    expect(p).toMatch(/p\.user_id = auth\.uid\(\) and p\.username is not null/);
  });

  it("limits update and delete to the author; an author's delete is a real delete", () => {
    expect(policy("profile_posts_update")).toMatch(
      /using \(user_id = auth\.uid\(\) and status = 'visible'\)/,
    );
    expect(policy("profile_posts_update")).toMatch(
      /with check \(user_id = auth\.uid\(\) and status = 'visible'\)/,
    );
    expect(policy("profile_posts_delete")).toMatch(/using \(user_id = auth\.uid\(\)\)/);
    expect(sql).toMatch(/grant delete on public\.profile_posts to authenticated/i);
  });

  it("decides status, time, trimming and pace on the server: ten posts an hour", () => {
    const fn = functionSource(sql, "profile_posts_before_insert");
    expect(fn).toMatch(/new\.status := 'visible'/);
    expect(fn).toMatch(/new\.created_at := now\(\)/);
    expect(fn).toMatch(/new\.body := btrim\(new\.body\)/);
    expect(fn).toMatch(/new\.removed_by := null/);
    expect(fn).toMatch(/interval '1 hour'/);
    expect(fn).toMatch(/v_recent >= 10/);
    expect(fn).toMatch(/errcode = '54000'/);
    expect(sql).toMatch(
      /create trigger profile_posts_before_insert before insert on public\.profile_posts/i,
    );
  });
});

describe("0050 who may read a post", () => {
  const read = policy("profile_posts_read");
  const gate = functionSource(sql, "can_view_posts_of");

  it("reads: the author's own rows, or visible rows the viewer may see", () => {
    expect(read).toMatch(/for select to anon, authenticated/i);
    expect(read).toMatch(/user_id = auth\.uid\(\)/);
    expect(read).toMatch(/status = 'visible' and public\.can_view_posts_of\(user_id\)/);
  });

  it("never lets a moderator bypass privacy through the table", () => {
    expect(read).not.toMatch(/is_moderator|has_permission/);
  });

  it("hides a private account's posts from everyone but accepted followers and the author", () => {
    expect(gate).toMatch(/security definer/i);
    expect(gate).toMatch(/set search_path = public, pg_temp/i);
    expect(gate).toMatch(/p_author = auth\.uid\(\)/);
    expect(gate).toMatch(/not pr\.is_private/);
    expect(gate).toMatch(
      /f\.follower_id = auth\.uid\(\)\s+and f\.followee_id = p_author\s+and f\.status = 'accepted'/,
    );
    // a pending request is not enough
    expect(gate).not.toMatch(/'pending'/);
  });

  it("hides posts both ways between blocked people", () => {
    expect(gate).toMatch(/b\.blocker_id = auth\.uid\(\) and b\.blocked_id = p_author/);
    expect(gate).toMatch(/b\.blocker_id = p_author and b\.blocked_id = auth\.uid\(\)/);
    expect(gate).toMatch(/not exists \(\s*select 1 from public\.blocks b/);
  });

  it("is callable by anon (public accounts are readable signed out) and nothing else is", () => {
    expect(sql).toMatch(
      /grant execute on function public\.can_view_posts_of\(uuid\) to anon, authenticated/i,
    );
  });
});

describe("0050 moderation", () => {
  it("adds posts.delete for the official rank only, mirroring comments.delete", () => {
    const seed = sql.match(
      /insert into public\.role_permissions[\s\S]*?on conflict do nothing;/i,
    );
    expect(seed).not.toBeNull();
    const pairs = [...(seed?.[0] ?? "").matchAll(/\('(\w+)', '([\w.]+)'\)/g)].map(
      (m) => `${m[1]}:${m[2]}`,
    );
    expect(pairs).toEqual(["official:posts.delete"]);
  });

  it("removes softly, clears the text, closes reports and logs who, when and why", () => {
    const fn = functionSource(sql, "admin_remove_post");
    expect(fn).toMatch(/has_permission\(v_uid, 'posts\.delete'\)/);
    expect(fn).toMatch(/status = 'removed'/);
    expect(fn).toMatch(/body = ''/);
    expect(fn).toMatch(/removed_by = v_uid/);
    expect(fn).toMatch(/update public\.post_reports[\s\S]*resolved_at = now\(\)/);
    expect(fn).toMatch(
      /insert into public\.moderation_log \(actor_id, action, post_id, target_user_id, reason\)/,
    );
    expect(fn).toMatch(/'post_remove'/);
  });

  it("extends the moderation log with the new actions and a post pointer", () => {
    expect(sql).toMatch(/'post_remove', 'post_reports_dismiss'/);
    expect(sql).toMatch(
      /alter table public\.moderation_log\s+add column if not exists post_id uuid references public\.profile_posts \(post_id\) on delete set null/i,
    );
    // the original six actions are kept
    for (const action of [
      "comment_approve",
      "comment_hide",
      "comment_remove",
      "role_grant",
      "role_revoke",
      "profile_reports_resolve",
    ]) {
      expect(sql).toContain(`'${action}'`);
    }
  });

  it("shows reports and the queue to moderators only, and lets only functions write reports", () => {
    expect(policy("post_reports_read")).toMatch(
      /has_permission\(auth\.uid\(\), 'comments\.moderate'\)/,
    );
    expect(sql).toMatch(
      /revoke insert, update, delete on public\.post_reports from anon, authenticated/i,
    );
    for (const name of ["post_queue", "dismiss_post_reports"]) {
      expect(functionSource(sql, name)).toMatch(
        /has_permission\(auth\.uid\(\), 'comments\.moderate'\)/,
      );
    }
  });

  it("the queue lists only visible posts that still have open reports", () => {
    const fn = functionSource(sql, "post_queue");
    expect(fn).toMatch(/r\.resolved_at is null/);
    expect(fn).toMatch(/po\.status = 'visible'/);
  });

  it("report_post accepts a post the reporter can read, never their own, with the comment reasons and a daily cap", () => {
    const fn = functionSource(sql, "report_post");
    expect(fn).toMatch(/'spam', 'abuse', 'false', 'private', 'other'/);
    expect(fn).toMatch(/po\.status = 'visible'/);
    expect(fn).toMatch(/v_author = v_uid/);
    expect(fn).toMatch(/not public\.can_view_posts_of\(v_author\)/);
    expect(fn).toMatch(/interval '1 day'\) >= 20/);
    expect(fn).toMatch(/errcode = '54000'/);
  });
});

describe("0050 public_profile", () => {
  const fn = functionSource(sql, "public_profile");

  it("adds posts_count of visible posts only, after the early return for viewers without full access", () => {
    expect(fn).toMatch(
      /'posts_count', \(select count\(\*\) from public\.profile_posts po where po\.user_id = v_id and po\.status = 'visible'\)/,
    );
    const beforeEarlyReturn = fn.slice(0, fn.indexOf("if not v_full then"));
    expect(beforeEarlyReturn).not.toContain("posts_count");
  });

  it("reads no post text or reports", () => {
    expect(fn).not.toMatch(/po\.body|post_reports/);
  });

  it("fixes the null-status hole: no follow row must mean no full profile", () => {
    expect(fn).toMatch(/coalesce\(v_status, ''\) = 'accepted'/);
    expect(fn).not.toMatch(/or v_status = 'accepted'\)/);
  });
});

describe("0050 hygiene", () => {
  it("pins the search path of every security definer function", () => {
    for (const name of createdFunctions(sql)) {
      const fn = functionSource(sql, name);
      if (/security definer/i.test(fn)) {
        expect(fn).toMatch(/set search_path = public, pg_temp/i);
      }
    }
  });

  it("revokes every function from public; only the public profile and the view gate reach anon", () => {
    const anonAllowed = new Set(["public_profile", "can_view_posts_of"]);
    for (const name of createdFunctions(sql)) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\(`, "i"));
      const toAnon = new RegExp(
        `grant execute on function public\\.${name}\\([^)]*\\) to [^;]*\\banon\\b`,
        "i",
      ).test(sql);
      expect(toAnon).toBe(anonAllowed.has(name));
    }
  });

  it("is idempotent: tables, columns, indexes, policies and triggers are guarded", () => {
    expect(sql).not.toMatch(/create table (?!if not exists)/i);
    expect(sql).not.toMatch(/create index (?!if not exists)/i);
    expect(sql).not.toMatch(/add column (?!if not exists)/i);
    for (const name of [
      "profile_posts_read",
      "profile_posts_insert",
      "profile_posts_update",
      "profile_posts_delete",
      "post_reports_read",
    ]) {
      expect(sql).toMatch(new RegExp(`drop policy if exists ${name} on`, "i"));
    }
    for (const name of ["profile_posts_before_insert", "profile_posts_before_update"]) {
      expect(sql).toMatch(new RegExp(`drop trigger if exists ${name} on`, "i"));
    }
  });

  it("touches no cron schedule", () => {
    expect(sql).not.toMatch(/cron\./i);
  });
});
