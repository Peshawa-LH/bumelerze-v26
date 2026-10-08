import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0058 (profile P2: bio, city label, pinned post,
 * edit with "edited" mark, Helpful on posts, share an earthquake to my
 * profile, name change limits). Pasted into the SQL editor as one line, so the
 * paste rules are pinned, and so are the privacy promises: no coordinates of
 * the person anywhere, the about fields only through public_profile() with
 * its private/blocked/suspended rules, the edit lock while reported, and the
 * limits. The behaviour was exercised against a real Postgres (PGlite) when it
 * was written; these keep it from being edited away.
 */
const raw = readMigration("0058_profile_p2.sql");
const sql = readCode("0058_profile_p2.sql");
const fn = (name: string) => functionSource(sql, name);

function tableBody(name: string): string {
  const start = sql.search(
    new RegExp(`create table if not exists public\\.${name}\\s*\\(`, "i"),
  );
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf(");", start));
}

describe("0058 can be pasted into the SQL editor as one line", () => {
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
    for (const constraint of [
      "profiles_bio_check",
      "profiles_city_check",
      "profile_posts_kind_check",
      "profile_posts_body_check",
    ]) {
      expect(sql).toContain(`drop constraint if exists ${constraint};`);
    }
    expect(sql).toContain(
      "drop policy if exists profile_posts_read on public.profile_posts;",
    );
    expect(sql).toContain(
      "drop trigger if exists profile_posts_after_status on public.profile_posts;",
    );
  });

  it("never uses CASE inside an IF condition (PL/pgSQL takes its THEN as the IF's)", () => {
    expect(sql).not.toMatch(/\bif\b[^;]*\bcase\b[^;]*\bthen\b/i);
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0058:/);
  });
});

describe("no location of the person, anywhere", () => {
  it("adds only the expected tables and columns, none of them coordinates", () => {
    expect(createdTables(sql).sort()).toEqual(["post_helpful", "profile_name_changes"]);
    const added = [...sql.matchAll(/add column if not exists (\w+)/g)].map((m) => m[1]);
    expect(added.sort()).toEqual(
      [
        "bio",
        "city_name",
        "city_place_id",
        "edited_at",
        "event_id",
        "kind",
        "pinned_post_id",
      ].sort(),
    );
    for (const table of ["post_helpful", "profile_name_changes"]) {
      expect(tableBody(table)).not.toMatch(
        /\b(lat|lon|latitude|longitude|geohash\w*|geom\w*|location\w*|accuracy|device_id|ip\w*|address)\b/i,
      );
    }
  });

  it("the city label is a place id and a name; set_profile_about takes nothing else", () => {
    expect(sql).toMatch(
      /create or replace function public\.set_profile_about\(\s*p_bio text,\s*p_city_place_id text,\s*p_city_name text\s*\)/,
    );
    expect(fn("profiles_integrity_guard")).toMatch(
      /new\.city_place_id !~ '\^\[A-Za-z0-9_-\]\{1,40\}\$'/,
    );
  });

  it("an event post carries the earthquake's public data, never the sharer's location", () => {
    const share = fn("share_event_to_profile");
    expect(share).toMatch(
      /create or replace function public\.share_event_to_profile\(p_event text, p_body text default null\)/,
    );
    expect(share).not.toMatch(/\blat\b|\blon\b|geohash|felt_reports/i);
    const page = fn("profile_posts_page");
    expect(page).toMatch(/e\.lat::double precision/);
    expect(page).not.toMatch(/felt_reports|geohash|po\.lat|po\.lon/i);
  });
});

describe("who reads the about fields", () => {
  it("revokes the direct read of profiles and keeps the app's columns", () => {
    expect(sql).toContain("revoke select on public.profiles from anon, authenticated;");
    expect(sql).toContain(
      "grant select (user_id, display_name, avatar_path, username, is_private, created_at, updated_at)\n  on public.profiles to anon, authenticated;",
    );
    const grant = sql.match(/grant select \(([^)]*)\)\s+on public\.profiles/)?.[1] ?? "";
    expect(grant).not.toMatch(/bio|city|pinned/);
  });

  it("public_profile puts bio, city and pin in the FULL part only, and none for a suspended account", () => {
    const body = fn("public_profile");
    const suspendedReturn = body.slice(
      body.indexOf("if v_suspended and not v_self then"),
      body.indexOf("v_full :="),
    );
    expect(suspendedReturn).not.toMatch(/bio|city|pinned/);
    const base = body.slice(
      body.indexOf("v_base := jsonb_build_object("),
      body.indexOf("if not v_full then"),
    );
    expect(base).not.toMatch(/bio|city|pinned/);
    const full = body.slice(body.indexOf("return v_base || jsonb_build_object("));
    for (const key of ["'bio'", "'city_place_id'", "'city_name'", "'pinned_post_id'"]) {
      expect(full).toContain(key);
    }
    expect(full).toMatch(
      /po\.post_id = v_pinned and po\.user_id = v_id and po\.status = 'visible'/,
    );
    // the 0050 fix stays: a missing follow row is not "accepted"
    expect(body).toMatch(/coalesce\(v_status, ''\) = 'accepted'/);
  });

  it("one read rule for posts: the table policy and the page function both use can_read_post", () => {
    expect(sql).toMatch(
      /create policy profile_posts_read on public\.profile_posts\s+for select to anon, authenticated\s+using \(public\.can_read_post\(user_id, status\)\);/,
    );
    expect(fn("profile_posts_page")).toMatch(
      /public\.can_read_post\(po\.user_id, po\.status\)/,
    );
    const rule = fn("can_read_post");
    expect(rule).toMatch(/p_author = auth\.uid\(\) and p_status <> 'deleted'/);
    expect(rule).toMatch(/public\.can_view_posts_of\(p_author\)/);
    expect(rule).toMatch(/not public\.is_suspended\(p_author\)/);
  });

  it("only the author ever sees the edit lock", () => {
    expect(fn("profile_posts_page")).toMatch(
      /po\.user_id = auth\.uid\(\)\s+and po\.status = 'visible'\s+and exists \(/,
    );
  });
});

describe("restriction guard and guidelines", () => {
  const guard = fn("profiles_integrity_guard");
  it("covers a new bio, city and pin, but not clearing or unpinning", () => {
    expect(guard).toMatch(/new\.bio is not null and new\.bio is distinct from old\.bio/);
    expect(guard).toMatch(/new\.city_place_id is not null/);
    expect(guard).toMatch(
      /new\.pinned_post_id is not null and new\.pinned_post_id is distinct from old\.pinned_post_id/,
    );
    expect(guard).toMatch(/assert_not_restricted\(new\.user_id, 'profiles'\)/);
    expect(guard).toMatch(/assert_guidelines_accepted\(new\.user_id, 'profiles'\)/);
  });

  it("bio: 160 characters, no links", () => {
    expect(sql).toMatch(/check \(bio is null or char_length\(bio\) between 1 and 160\)/);
    expect(guard).toMatch(/bio_too_long/);
    expect(guard).toMatch(/text_has_link\(new\.bio\)/);
  });

  it("edit: restricted refused, locked while reports are open, edited mark only on a real change", () => {
    const upd = fn("profile_posts_before_update");
    expect(upd).toMatch(/assert_not_restricted\(new\.user_id, 'profile_posts'\)/);
    expect(upd).toMatch(/r\.post_id = new\.post_id and r\.resolved_at is null/);
    expect(upd).toMatch(/profile_posts: edit_locked/);
    expect(upd).toMatch(/new\.body is distinct from old\.body/);
    expect(upd).toMatch(/auth\.uid\(\) is not distinct from new\.user_id/);
    expect(upd).toMatch(/new\.edited_at := now\(\)/);
  });

  it("insert: restriction, guidelines, the 10/hour limit; event posts at most 280", () => {
    const ins = fn("profile_posts_before_insert");
    expect(ins).toMatch(/assert_not_restricted\(new\.user_id, 'profile_posts'\)/);
    expect(ins).toMatch(/assert_guidelines_accepted\(new\.user_id, 'profile_posts'\)/);
    expect(ins).toMatch(/v_recent >= 10/);
    expect(ins).toMatch(/char_length\(new\.body\) > 280/);
    expect(ins).toMatch(/review_status <> 'deleted'/);
  });

  it("helpful: accounts only, never own post, readable posts only, restriction on marking", () => {
    const h = fn("set_post_helpful");
    expect(h).toMatch(/not public\.is_real_account\(\)/);
    expect(h).toMatch(/v_author = v_uid/);
    expect(h).toMatch(/can_read_post\(v_author, 'visible'\)/);
    expect(h).toMatch(/assert_not_restricted\(v_uid, 'post_helpful'\)/);
    expect(h).toMatch(/on conflict \(post_id, user_id\) do nothing/);
  });

  it("helpful counts leave out marks across a block with the author or the reader", () => {
    const c = fn("post_helpful_visible_count");
    expect(c).toMatch(/b\.blocked_id = p_author or b\.blocked_id = auth\.uid\(\)/);
    expect(c).toMatch(/b\.blocker_id = p_author or b\.blocker_id = auth\.uid\(\)/);
  });

  it("share: real account with a @username, replay-safe for 10 minutes", () => {
    const share = fn("share_event_to_profile");
    expect(share).toMatch(/not public\.is_real_account\(\)/);
    expect(share).toMatch(/p\.username is not null/);
    expect(share).toMatch(/interval '10 minutes'/);
    expect(share).toMatch(/coalesce\(e0\.merged_into, e0\.event_id\)/);
  });
});

describe("pinned post", () => {
  it("only one's own visible post, unpinned when it stops being visible", () => {
    expect(fn("set_pinned_post")).toMatch(
      /po\.post_id = p_post_id and po\.user_id = v_uid and po\.status = 'visible'/,
    );
    expect(fn("profiles_integrity_guard")).toMatch(/profiles: pinned_invalid/);
    expect(fn("profile_posts_after_status")).toMatch(
      /old\.status = 'visible' and new\.status <> 'visible'/,
    );
    expect(sql).toMatch(
      /create trigger profile_posts_after_status\s+after update of status on public\.profile_posts/,
    );
    expect(sql).toMatch(
      /pinned_post_id uuid\s+references public\.profile_posts \(post_id\) on delete set null/,
    );
  });
});

describe("name change limits", () => {
  const guard = fn("profiles_integrity_guard");
  it("@username once in 30 days, display name 5 times, only the owner's own changes", () => {
    expect(guard).toMatch(/v_self := auth\.uid\(\) is not distinct from new\.user_id/);
    expect(guard).toMatch(
      /old\.username is not null and v_username is distinct from old\.username/,
    );
    expect(guard).toMatch(/profiles: username_change_limit/);
    expect(guard).toMatch(/v_count >= 5/);
    expect(guard).toMatch(/profiles: display_name_change_limit/);
    expect((guard.match(/interval '30 days'/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(guard).toMatch(/insert into public\.profile_name_changes/);
  });

  it("history: closed table, cascade with the account, purged after 90 days", () => {
    expect(tableBody("profile_name_changes")).toMatch(
      /user_id uuid not null references auth\.users \(id\) on delete cascade/,
    );
    expect(sql).toContain(
      "revoke all on public.profile_name_changes from public, anon, authenticated;",
    );
    expect(fn("purge_expired_social")).toMatch(
      /delete from public\.profile_name_changes\s+where changed_at < now\(\) - interval '90 days'/,
    );
  });
});

describe("grants", () => {
  const userFunctions = [
    "edit_my_post(uuid, text)",
    "set_post_helpful(uuid, boolean)",
    "share_event_to_profile(text, text)",
    "set_pinned_post(uuid)",
    "set_profile_about(text, text, text)",
    "my_profile_about()",
  ];

  it("every function except the pure link check is security definer with a pinned search path", () => {
    for (const name of createdFunctions(sql)) {
      expect([name, fn(name)]).toEqual([
        name,
        expect.stringMatching(/set search_path = public, pg_temp/),
      ]);
      if (name !== "text_has_link") {
        expect([name, fn(name)]).toEqual([
          name,
          expect.stringMatching(/security definer/),
        ]);
      }
    }
  });

  it("writes for signed-in users only; reads for everyone; internals for nobody", () => {
    for (const signature of userFunctions) {
      expect(sql).toContain(
        `revoke all on function public.${signature} from public, anon;`,
      );
      expect(sql).toContain(
        `grant execute on function public.${signature} to authenticated;`,
      );
    }
    for (const signature of [
      "profile_posts_page(uuid, timestamptz, integer, boolean, uuid)",
      "can_read_post(uuid, text)",
      "public_profile(text)",
    ]) {
      expect(sql).toContain(
        `grant execute on function public.${signature} to anon, authenticated;`,
      );
    }
    for (const signature of [
      "text_has_link(text)",
      "post_helpful_visible_count(uuid, uuid)",
      "profile_posts_after_status()",
      "purge_expired_social()",
    ]) {
      expect(sql).toContain(
        `revoke all on function public.${signature} from public, anon, authenticated;`,
      );
    }
    expect(sql).toContain(
      "revoke all on public.post_helpful from public, anon, authenticated;",
    );
  });

  it("clients still cannot set a post's kind or event (insert grant stays user_id, body)", () => {
    expect(sql).not.toMatch(/grant insert/i);
    expect(sql).not.toMatch(/grant update/i);
  });
});
