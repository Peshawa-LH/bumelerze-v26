import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0069 (owner decision D98: government officials
 * see the building class and the latest I'm safe of every account holder;
 * the per-account switch of 0066 is gone from the app). Only the list of
 * people changes: authority_people() now reads every non-anonymous account
 * instead of the authority_sharing rows that were switched on. Every other
 * rule of 0066 stays word for word: the authority.view check, the 500 cap,
 * no coordinate, address, device or email, and the activity log row naming
 * who was shown. The table stays. Pasted into the SQL editor as one line,
 * so the paste rules are pinned too.
 */
const raw = readMigration("0069_authority_sharing_everyone.sql");
const sql = readCode("0069_authority_sharing_everyone.sql");
const fn = (name: string) => functionSource(sql, name);
const v0066 = readCode("0066_admin_authority.sql");

/** The function text with its `chosen` list (the one part 0069 changes) cut
 * out, so the rest can be compared with 0066 word for word. */
function withoutChosen(body: string): string {
  return body.replace(/with chosen as \([\s\S]*?\n {2}\)\n/, "with chosen as (...)\n");
}

describe("0069 can be pasted into the SQL editor as one line", () => {
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
    expect(raw).not.toContain("?");
  });

  it("is idempotent", () => {
    expect(sql).not.toMatch(/create table/i);
    expect(sql).not.toMatch(/create function/i);
    expect(sql).not.toMatch(/\bdrop\b/i);
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0069:/);
  });

  it("redefines authority_people() only and leaves the table in place", () => {
    expect(createdTables(sql)).toEqual([]);
    expect(createdFunctions(sql)).toEqual(["authority_people"]);
    expect(sql).not.toMatch(/alter table|delete from|truncate/i);
  });
});

describe("authority_people() lists every account holder", () => {
  it("reads every non-anonymous account, not the sharing switch", () => {
    const body = fn("authority_people");
    expect(body).not.toContain("authority_sharing");
    expect(body).not.toContain("s.enabled");
    expect(body).toContain("from auth.users u");
    expect(body).toContain("where coalesce(u.is_anonymous, false) = false");
    expect(body).toContain("left join public.profiles p on p.user_id = u.id");
  });

  it("keeps the signature, the definer rights and the search path", () => {
    const body = fn("authority_people");
    expect(body).toContain(
      "create or replace function public.authority_people(p_limit integer default 200)\nreturns jsonb",
    );
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public, pg_temp");
  });

  it("is for holders of authority.view only", () => {
    expect(fn("authority_people")).toContain(
      "if v_uid is null or not public.has_permission(v_uid, 'authority.view') then",
    );
  });

  it("keeps the 500 cap", () => {
    expect(fn("authority_people")).toContain(
      "limit least(greatest(coalesce(p_limit, 200), 1), 500)",
    );
  });

  it("never sends a coordinate, a home code or a contact", () => {
    expect(fn("authority_people")).not.toMatch(
      /'lat'|'lon'|'code'|'email'|'label'|device_id|geohash|u\.email|u\.phone/,
    );
  });

  it("still logs every look with who was shown", () => {
    const body = fn("authority_people");
    expect(body).toContain("perform public.write_audit(");
    expect(body).toContain("v_uid, 'authority_people_view', 'system'");
    expect(body).toContain("'user_ids', v_ids");
  });

  it("changes nothing but the list of people: the rest is 0066 word for word", () => {
    const before = withoutChosen(functionSource(v0066, "authority_people"));
    const after = withoutChosen(fn("authority_people"));
    expect(before).toContain("with chosen as (...)");
    expect(after).toBe(before);
  });

  it("keeps the grants of 0066: signed-in callers only, checked inside", () => {
    expect(sql).toContain(
      "revoke all on function public.authority_people(integer) from public, anon;",
    );
    expect(sql).toContain(
      "grant execute on function public.authority_people(integer) to authenticated;",
    );
    expect(sql).not.toMatch(/to anon\b/);
  });
});
