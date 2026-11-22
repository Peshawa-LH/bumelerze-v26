import { readCode, readMigration } from "../sql-test-utils";

/**
 * Static checks of migration 0081 (security audit DB-07, DB-08): the felt
 * report details and photo rows are written only through
 * submit_felt_report_details and submit_felt_photo, once app 26.4.9 (which
 * calls them) is live. Exercised against PGlite (live order + 0080, then 0081
 * twice; 15 checks: before 0081 an old app's direct insert lands; after it
 * direct inserts of details and photos answer 42501 for accounts and guests,
 * both functions still write for the report's own session and refuse another
 * session, the function replaces answers an old app filed directly, anon can
 * no longer call the details function, and 0081 without 0080 fails the whole
 * paste and leaves both policies in place) when it was written.
 */
const FILE = "0081_felt_rows_via_functions.sql";
const raw = readMigration(FILE);
const sql = readCode(FILE);
const line = sql.replace(/\s+/g, " ").trim();

describe("0081 can be pasted into the SQL editor as one line", () => {
  it("has no transaction statements, only full-line comments, ASCII, no question marks", () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    for (const text of sql.split("\n")) {
      expect(text).not.toContain("--");
    }
    expect(raw).not.toMatch(/[^\x00-\x7f]/);
    expect(raw).not.toContain("?");
    expect(raw.split("\n")[0]).toMatch(/^-- 0081:/);
  });

  it("is idempotent and creates nothing", () => {
    expect(sql).not.toMatch(/create (table|function|or replace function|policy|trigger)/i);
  });
});

describe("the direct insert paths close", () => {
  it("drops both open insert policies and revokes INSERT from the client roles", () => {
    expect(sql).toContain("drop policy if exists felt_report_details_insert on public.felt_report_details;");
    expect(sql).toContain("drop policy if exists felt_photos_insert on public.felt_photos;");
    expect(sql).toContain(
      "revoke insert on public.felt_report_details, public.felt_photos from anon, authenticated;",
    );
  });

  it("takes the details function away from callers without a session", () => {
    expect(sql).toContain(
      "revoke execute on function public.submit_felt_report_details(uuid, text, jsonb) from anon;",
    );
  });

  it("refuses to run before 0080 and checks everything at the end", () => {
    expect(line).toContain(
      "if to_regprocedure('public.submit_felt_photo(uuid, text)') is null then v_missing := v_missing || 'submit_felt_photo (0080 first)'::text;",
    );
    expect(line).toContain("raise exception '0081: not in place: %', array_to_string(v_missing, '; ');");
  });
});
