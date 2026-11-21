import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0075 (`my_account_has_password()`, security
 * checklist A0.1: the Password screen asks for the current password only
 * when the account has one). Pasted into the SQL editor as one line, so the
 * paste rules are pinned; so are the promises: it answers for the caller's
 * own row only (auth.uid()), returns a yes or no and never the hash, cannot
 * be called without a session, and changes nothing else. The behaviour was
 * exercised against a real Postgres (PGlite: 0075 applied twice on a stub
 * auth.users, 14 checks: a password, an empty and a null one, an unknown
 * user and no session; anon refused; authenticated cannot read auth.users
 * itself) when it was written; these keep it from being edited away. The
 * app's call is pinned in src/features/account/__tests__/service-password.test.ts.
 */
const FILE = "0075_my_account_has_password.sql";
const raw = readMigration(FILE);
const sql = readCode(FILE);
const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const fn = flat(functionSource(sql, "my_account_has_password"));

describe("0075 can be pasted into the SQL editor as one line", () => {
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

  it("is idempotent: one function replaced, nothing created that a second run would trip on", () => {
    expect(createdTables(sql)).toEqual([]);
    expect(sql).not.toMatch(/create function/i);
    expect(sql).not.toMatch(/create (unique )?index|create policy|create trigger/i);
    expect(createdFunctions(sql)).toEqual(["my_account_has_password"]);
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0075:/);
    expect(raw).toContain("A0.1");
  });
});

describe("my_account_has_password()", () => {
  it("takes no argument and returns a boolean", () => {
    expect(fn).toMatch(
      /^create or replace function public\.my_account_has_password\(\) returns boolean /,
    );
  });

  it("is a stable SQL function, security definer, with a pinned search path", () => {
    expect(fn).toContain(" language sql ");
    expect(fn).toContain(" stable ");
    expect(fn).toContain(" security definer ");
    expect(fn).toContain(" set search_path = public, pg_temp ");
  });

  it("reads only the caller's own row and returns a yes or no, never the hash", () => {
    expect(fn).toContain(
      "select coalesce((select encrypted_password from auth.users where id = auth.uid()), '') <> '';",
    );
    // No parameter that could name another user.
    expect(fn).not.toMatch(/p_\w+|\$1/);
  });

  it("only signed-in callers may run it", () => {
    const code = flat(sql);
    expect(code).toContain(
      "revoke all on function public.my_account_has_password() from public, anon;",
    );
    expect(code).toContain(
      "grant execute on function public.my_account_has_password() to authenticated;",
    );
    expect(code).not.toMatch(/grant execute on function public\.my_account_has_password\(\) to [^;]*anon/);
  });
});
