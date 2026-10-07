import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
} from "../sql-test-utils";

/**
 * Static checks of migrations 0045 (usernames), 0047 (follows, blocks,
 * reports, the public profile) and 0048 (feedback "Badge request").
 * Privacy first: the public profile function may return ONLY a fixed list of
 * public-safe keys and must never read the private columns.
 */
const usernames = readCode("0045_usernames.sql");
const community = readCode("0047_follows_blocks_profiles.sql");
const feedback = readCode("0048_feedback_badge_request.sql");
const all = [usernames, community, feedback];

/** Every key the public profile may return, nested objects included. */
const PUBLIC_PROFILE_KEYS = [
  "user_id",
  "username",
  "display_name",
  "avatar_path",
  "is_private",
  "roles",
  "role",
  "org_name",
  "is_self",
  "follow_status",
  "is_blocked",
  "can_view_full",
  "member_since",
  "followers",
  "following",
  "comments",
  "helpful_received",
  "badges_hidden",
  "milestones",
  "reports",
  "detailed_reports",
  "photo_reports",
  "recent_comments",
  "comment_id",
  "body",
  "created_at",
  "helpful_count",
  "hub_id",
  "place",
  "magnitude",
].sort();

describe("public_profile never exposes private fields", () => {
  const fn = functionSource(community, "public_profile");

  it("is security definer with a pinned search path and executable by anon and signed-in users", () => {
    expect(fn).toMatch(/security definer/i);
    expect(fn).toMatch(/set search_path = public, pg_temp/i);
    expect(community).toMatch(
      /grant execute on function public\.public_profile\(text\) to anon, authenticated;/i,
    );
  });

  it("builds its answer from exactly the allowed keys", () => {
    const keys = [...fn.matchAll(/'(\w+)',/g)].map((m) => m[1] as string);
    expect([...new Set(keys)].sort()).toEqual(PUBLIC_PROFILE_KEYS);
  });

  it("never mentions a private column or table", () => {
    const forbidden = [
      "profession",
      "email",
      "geohash",
      "latitude",
      "longitude",
      /\blat\b/,
      /\blon\b/,
      "home_tag",
      "home_member",
      "auth.users",
      "research_consent",
      "terms_",
      "device_id",
      "locale",
      "area_",
      "felt_comments",
      "feedback",
      "notification",
    ];
    for (const token of forbidden) {
      if (typeof token === "string") {
        expect(fn.toLowerCase()).not.toContain(token);
      } else {
        expect(fn).not.toMatch(token);
      }
    }
  });

  it("reads profile_private only for the hide_badges switch", () => {
    const uses = [...fn.matchAll(/\bpp\.(\w+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    expect(new Set(uses)).toEqual(new Set(["hide_badges", "user_id"]));
  });

  it("reads felt reports only to count them, never their place", () => {
    const reportRefs = [...fn.matchAll(/\br\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(reportRefs)).toEqual(new Set(["user_id", "report_id"]));
    expect(fn).not.toMatch(/select\s+r\.\*/i);
    expect(fn).not.toMatch(/select \*/i);
  });

  it("limits a private account to the basic fields for people who may not see more", () => {
    expect(fn).toMatch(
      /v_full := not v_blocked and \(not v_private or v_self or v_status = 'accepted'\)/,
    );
    // the early return that stops before counts, badges and comments
    expect(fn).toMatch(/if not v_full then\s+return v_base;/);
    const beforeEarlyReturn = fn.slice(0, fn.indexOf("if not v_full then"));
    for (const key of [
      "followers",
      "member_since",
      "recent_comments",
      "milestones",
      "helpful_received",
    ]) {
      expect(beforeEarlyReturn).not.toContain(`'${key}'`);
    }
  });

  it("answers null for a person who blocked the viewer, and hides milestones when asked", () => {
    expect(fn).toMatch(
      /b\.blocker_id = v_id and b\.blocked_id = v_viewer[\s\S]*return null/,
    );
    expect(fn).toMatch(/'milestones', case when v_hide then null/);
  });

  it("shows only visible comments, newest ten, with a short body", () => {
    expect(fn).toMatch(/cc\.status = 'visible'/);
    expect(fn).toMatch(/limit 10/);
    expect(fn).toMatch(/left\(rc\.body, 280\)/);
  });
});

describe("0045 usernames", () => {
  it("stores lowercase names of 3 to 24 letters, digits, dots and underscores, unique case-insensitively", () => {
    expect(usernames).toContain("username ~ '^[a-z0-9_.]{3,24}$'");
    expect(usernames).toMatch(
      /create unique index if not exists profiles_username_lower_key\s+on public\.profiles \(lower\(username\)\)/i,
    );
  });

  it("reserves the official-looking names, and names containing bumelerze, except for the official account", () => {
    for (const name of ["admin", "bumelerze", "official", "support", "moderator"]) {
      expect(usernames).toContain(`('${name}')`);
    }
    const guard = functionSource(usernames, "profiles_username_guard");
    expect(guard).toMatch(/position\('bumelerze' in new\.username\) > 0/);
    expect(guard).toMatch(/ur\.role = 'official'/);
    expect(guard).toMatch(/lower\(btrim\(new\.username\)\)/);
  });

  it("keeps the private switches off the public row's reach", () => {
    expect(usernames).toMatch(
      /alter table public\.profile_private add column if not exists hide_badges boolean not null default false/i,
    );
    expect(usernames).toMatch(
      /alter table public\.profiles add column if not exists is_private boolean not null default false/i,
    );
  });
});

describe("0047 follows, blocks and reports", () => {
  it("lets only the functions write follows, blocks and profile reports", () => {
    for (const table of ["follows", "blocks", "profile_reports"]) {
      expect(community).toMatch(
        new RegExp(
          `revoke insert, update, delete on public\\.${table} from anon, authenticated`,
          "i",
        ),
      );
      expect(community).not.toMatch(
        new RegExp(
          `create policy \\w+ on public\\.${table}\\s+for (insert|update|delete|all)`,
          "i",
        ),
      );
    }
  });

  it("shows each person only their own follow and block rows", () => {
    expect(community).toMatch(
      /follower_id = auth\.uid\(\) or followee_id = auth\.uid\(\)/,
    );
    expect(community).toMatch(
      /create policy blocks_read_own[\s\S]*blocker_id = auth\.uid\(\)/,
    );
  });

  it("shows profile reports to moderators only", () => {
    expect(community).toMatch(
      /create policy profile_reports_read[\s\S]*has_permission\(auth\.uid\(\), 'comments\.moderate'\)/,
    );
    for (const name of ["moderation_profile_reports", "resolve_profile_reports"]) {
      expect(functionSource(community, name)).toMatch(
        /has_permission\(auth\.uid\(\), 'comments\.moderate'\)/,
      );
    }
  });

  it("follow_user needs a real account with a profile, refuses blocked pairs, and a private account makes a pending request", () => {
    const fn = functionSource(community, "follow_user");
    expect(fn).toMatch(/not public\.is_real_account\(\)/);
    expect(fn).toMatch(/profile_required/);
    expect(fn).toMatch(/b\.blocker_id = v_uid and b\.blocked_id = p_followee/);
    expect(fn).toMatch(/b\.blocker_id = p_followee and b\.blocked_id = v_uid/);
    expect(fn).toMatch(/case when v_private then 'pending' else 'accepted' end/);
    expect(fn).toMatch(/interval '1 hour'/);
  });

  it("only the followee can accept or decline a request", () => {
    for (const name of ["accept_follow_request", "decline_follow_request"]) {
      const fn = functionSource(community, name);
      expect(fn).toMatch(/followee_id = auth\.uid\(\)/);
      expect(fn).toMatch(/status = 'pending'/);
    }
  });

  it("blocking removes follows in both directions and is enforced in the comment policy", () => {
    const fn = functionSource(community, "block_user");
    expect(fn).toMatch(/follower_id = v_uid and followee_id = p_user/);
    expect(fn).toMatch(/follower_id = p_user and followee_id = v_uid/);
    expect(community).toMatch(
      /create policy event_comments_read[\s\S]*not exists \([\s\S]*b\.blocker_id = auth\.uid\(\)[\s\S]*b\.blocked_id = event_comments\.user_id/,
    );
    // moderators and authors still see their rows
    expect(community).toMatch(
      /user_id = auth\.uid\(\)\s+or public\.is_moderator\(auth\.uid\(\)\)/,
    );
  });

  it("follower lists respect private accounts and blocks, and return public fields only", () => {
    const fn = functionSource(community, "follow_list");
    expect(fn).toMatch(
      /if v_private and v_viewer is distinct from v_target and not exists/,
    );
    expect(fn).toMatch(/f\.status = 'accepted'/);
    for (const token of [
      "profession",
      "email",
      "geohash",
      "device_id",
      "profile_private",
    ]) {
      expect(fn).not.toContain(token);
    }
  });

  it("accepts waiting requests when an account goes public", () => {
    expect(functionSource(community, "profiles_privacy_changed")).toMatch(
      /old\.is_private and not new\.is_private/,
    );
  });
});

describe("0048 feedback badge request", () => {
  it("adds badge_request to the category list", () => {
    expect(feedback).toMatch(
      /category in \(\s*'bug', 'improvement', 'suggestion', 'question', 'other', 'badge_request'\s*\)/,
    );
  });

  it("lets a client set only badge_request; triage can set any", () => {
    const fn = functionSource(feedback, "feedback_client_category_guard");
    expect(fn).toMatch(/in \('anon', 'authenticated'\)/);
    expect(fn).toMatch(/new\.category is distinct from 'badge_request'/);
    expect(fn).toMatch(/new\.category := null/);
  });
});

describe("hygiene of 0045, 0047 and 0048", () => {
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

  it("revokes every function from public; only the public profile and lists reach anon", () => {
    const anonAllowed = new Set(["public_profile", "follow_list"]);
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
