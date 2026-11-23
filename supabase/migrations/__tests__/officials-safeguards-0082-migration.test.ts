import { readCode, readMigration } from "../sql-test-utils";

/**
 * Static checks of migration 0082 (security checklist A2.1; audit DB-04,
 * DB-15, PRIV-01; owner decision D104): safeguards for the officials' view.
 * Exercised against PGlite when it was written (live order 0001-0075,
 * 0077-0081, then 0082 twice; 60 checks): only the official account in a
 * two-step session gives the Government official rank, never to itself or a
 * guest, always with a reason and an end date at most 12 months away, on
 * every path into user_roles (admin_grant_role, the SQL editor); the list of
 * people leaves out private accounts, guests and accounts without a profile,
 * comes 100 per page with every public account exactly once, logs each page
 * and refuses the 21st page within 24 hours; an expired rank is refused at
 * once and removed by the job with a log row; the switch and its table are
 * gone and Download my data reports officials_view.shown; and 0076 applies
 * cleanly before or after it, with the rules unchanged.
 */
const FILE = "0082_officials_safeguards.sql";
const raw = readMigration(FILE);
const sql = readCode(FILE);
const line = sql.replace(/\s+/g, " ").trim();

describe("0082 can be pasted into the SQL editor as one line", () => {
  it("has no transaction statements, only full-line comments, ASCII, no question marks", () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    for (const text of sql.split("\n")) {
      expect(text).not.toContain("--");
    }
    expect(raw).not.toMatch(/[^\x00-\x7f]/);
    expect(raw).not.toContain("?");
    expect(raw.split("\n")[0]).toMatch(/^-- 0082:/);
  });

  it("is idempotent", () => {
    expect(sql).toContain("alter table public.user_roles add column if not exists expires_at timestamptz;");
    expect(sql).toContain("drop trigger if exists user_roles_authority_guard on public.user_roles;");
    expect(sql).not.toMatch(/create table /i);
    expect(sql).not.toMatch(/create function /i);
  });
});

describe("who may give the Government official rank", () => {
  it("checks every write to user_roles in a trigger: official account, two-step, never itself", () => {
    expect(line).toContain(
      "create trigger user_roles_authority_guard before insert or update on public.user_roles for each row execute function public.user_roles_authority_guard();",
    );
    expect(line).toContain(
      "if v_official is null or v_uid <> v_official or coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' or new.user_id = v_uid then raise exception 'user_roles: not_allowed' using errcode = '42501';",
    );
    expect(line).toContain("if v_official is not null and new.user_id = v_official then");
  });

  it("needs a reason, an end date at most 12 months away and a real account, also without a session", () => {
    expect(line).toContain("raise exception 'user_roles: reason_required'");
    expect(line).toContain("raise exception 'user_roles: ends_required'");
    expect(line).toContain(
      "if new.expires_at > coalesce(new.granted_at, now()) + interval '12 months 1 day' then raise exception 'user_roles: ends_too_long'",
    );
    expect(line).toContain("raise exception 'user_roles: not_account'");
  });

  it("gives it through admin_grant_authority with the same rules and clear tokens", () => {
    expect(line).toContain(
      "create or replace function public.admin_grant_authority( p_username text, p_reason text, p_expires_at timestamptz ) returns jsonb language plpgsql security definer set search_path = public, pg_temp",
    );
    for (const token of [
      "not_allowed",
      "reason_required",
      "too_long",
      "ends_required",
      "ends_invalid",
      "ends_too_long",
      "not_found",
      "not_account",
    ]) {
      expect(line).toContain(`'admin_grant_authority: ${token}'`);
    }
    expect(line).toContain(
      "grant execute on function public.admin_grant_authority(text, text, timestamptz) to authenticated;",
    );
  });

  it("leaves has_permission, admin_grant_role and admin_revoke_role to 0076", () => {
    expect(sql).not.toMatch(/function public\.(has_permission|admin_grant_role|admin_revoke_role)\(/);
  });
});

describe("the end date", () => {
  it("removes expired ranks every 10 minutes and logs each one", () => {
    expect(line).toContain(
      "select cron.schedule('expire_authority_ranks', '*/10 * * * *', $cron$select public.expire_authority_ranks();$cron$);",
    );
    expect(line).toContain(
      "perform public.write_audit( null, 'role_revoke', 'rank', r.user_id::text, r.user_id, null, null, 'authority', 'expired',",
    );
    expect(line).toContain(
      "revoke all on function public.expire_authority_ranks() from public, anon, authenticated;",
    );
  });
});

describe("the list of account holders", () => {
  it("replaces the old signature", () => {
    expect(sql).toContain("drop function if exists public.authority_people(integer);");
    expect(line).toContain(
      "create or replace function public.authority_people(p_limit integer default 100, p_offset integer default 0)",
    );
  });

  it("needs an unexpired rank, 100 per page, 20 pages in 24 hours", () => {
    expect(line).toContain("where r.user_id = v_uid and r.role = 'authority' and r.expires_at > now()");
    expect(line).toContain("v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);");
    expect(line).toContain(
      "if v_used >= 20 then raise exception 'authority_people: rate_limited' using errcode = 'P0001';",
    );
  });

  it("leaves out private accounts, guests and accounts without a profile", () => {
    expect(line).toContain(
      "join public.profiles p on p.user_id = u.id where coalesce(u.is_anonymous, false) = false and p.is_private = false",
    );
  });
});

describe("the dead switch and Download my data", () => {
  it("drops the switch, its functions and its table, and reports the real state", () => {
    expect(sql).toContain("drop function if exists public.set_authority_sharing(boolean);");
    expect(sql).toContain("drop function if exists public.my_authority_sharing();");
    expect(sql).toContain("drop table if exists public.authority_sharing;");
    expect(line).toContain("'officials_view', jsonb_build_object( 'shown',");
    expect(line).not.toMatch(/'authority_sharing'/);
  });
});

describe("the check at the end", () => {
  it("fails the paste when a part is missing", () => {
    expect(line).toContain("raise exception '0082: not in place: %', array_to_string(v_missing, ', ');");
    expect(line).toContain("v_missing := v_missing || 'authority sharing switch removed'::text;");
  });
});
