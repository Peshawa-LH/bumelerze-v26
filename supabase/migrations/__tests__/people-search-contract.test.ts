import { functionSource, readCode } from "../sql-test-utils";

/**
 * Profile > Find people reuses mention_suggestions() (migration 0063)
 * instead of a function of its own. These pin what the search relies on, so
 * a later change to the mention list cannot quietly change who can search
 * or what a search shows: callable by every session (accounts and anonymous
 * guests; Supabase gives both the authenticated role), public profile fields
 * only, not limited to people the searcher follows, but never a private
 * account the searcher cannot see, a blocked or a suspended one, and at most
 * 8 people for 2 to 24 typed characters.
 */
const sql = readCode("0063_mentions_post_comments.sql");
const fn = functionSource(sql, "mention_suggestions");

describe("mention_suggestions() as the people search (0063)", () => {
  it("is callable by every session, accounts and anonymous guests alike", () => {
    expect(sql).toContain(
      "grant execute on function public.mention_suggestions(text) to authenticated;",
    );
    expect(sql).toContain(
      "revoke all on function public.mention_suggestions(text) from public, anon;",
    );
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path = public, pg_temp");
  });

  it("returns public profile fields only", () => {
    expect(fn).toMatch(
      /returns table \(\s*user_id uuid,\s*username text,\s*display_name text,\s*avatar_path text,\s*relation text\s*\)/,
    );
    expect(fn).not.toMatch(/email|phone|lat\b|lon\b|device_id|is_anonymous/);
  });

  it("lists anyone with a public profile, people I follow first", () => {
    expect(fn).toContain("else 'other'");
    expect(fn).toContain("not p.is_private");
    expect(fn).toContain("order by (x.relation <> 'other') desc");
  });

  it("never lists a private account I cannot see, a blocked or a suspended one, or me", () => {
    expect(fn).toContain("and not public.blocked_between(v_uid, p.user_id)");
    expect(fn).toContain("and not public.is_suspended(p.user_id)");
    expect(fn).toContain("and p.user_id <> v_uid");
    expect(fn).toContain("where p.username is not null");
  });

  it("matches a name or @username from its start, 2 to 24 characters, 8 at most", () => {
    expect(fn).toContain("ltrim(btrim(coalesce(p_prefix, '')), '@')");
    expect(fn).toContain("char_length(v_p) < 2 or char_length(v_p) > 24");
    expect(fn).toContain(
      "(lower(p.username) like v_like or lower(p.display_name) like v_like)",
    );
    expect(fn).toContain("limit 8;");
  });
});
