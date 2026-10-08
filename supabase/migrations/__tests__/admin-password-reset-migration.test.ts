import { createdFunctions, functionSource, readCode } from "../sql-test-utils";

/**
 * Static checks of migration 0051 (admin password reset). It is applied by hand
 * in the SQL editor, so these pin down the rules that must not drift: the
 * permission gate, who may be reset, how the hash is written, the grants.
 */
const sql = readCode("0051_admin_password_reset.sql");
const reset = functionSource(sql, "admin_reset_password");
const find = functionSource(sql, "admin_find_accounts");

describe("0051 admin password reset", () => {
  it("grants accounts.reset_password to the official rank only", () => {
    const seed = sql.match(
      /insert into public\.role_permissions[\s\S]*?on conflict do nothing;/i,
    );
    expect(seed).not.toBeNull();
    const pairs = [...(seed?.[0] ?? "").matchAll(/\('(\w+)', '([\w.]+)'\)/g)].map(
      (m) => `${m[1]}:${m[2]}`,
    );
    expect(pairs).toEqual(["official:accounts.reset_password"]);
    // 0043's constraint on permission names: lowercase words joined by a dot.
    expect("accounts.reset_password").toMatch(/^[a-z]+\.[a-z_]+$/);
  });

  it("defines exactly the two functions, both security definer with a pinned search_path", () => {
    expect(createdFunctions(sql).sort()).toEqual([
      "admin_find_accounts",
      "admin_reset_password",
    ]);
    for (const body of [reset, find]) {
      expect(body).toMatch(/security definer/i);
      expect(body).toMatch(/set search_path = public, extensions, pg_temp/i);
    }
  });

  it("checks the permission through has_permission before doing anything", () => {
    for (const body of [reset, find]) {
      const gate = body.search(
        /has_permission\(\s*(auth\.uid\(\)|v_uid),\s*'accounts\.reset_password'\s*\)/i,
      );
      expect(gate).toBeGreaterThan(-1);
      expect(body).toMatch(/errcode = '42501'/);
      // The gate comes before any table access.
      const firstTouch = body.search(/\b(from|update|delete|insert)\b/i);
      expect(gate).toBeLessThan(firstTouch);
    }
  });

  it("refuses short and over-long passwords and anonymous or missing users", () => {
    expect(reset).toMatch(/char_length\(p_new_password\) < 8/);
    expect(reset).toMatch(/char_length\(p_new_password\) > 72/);
    expect(reset).toMatch(/is_anonymous/);
    expect(reset).toMatch(/errcode = 'P0002'/);
  });

  it("does not let one admin take over another admin's account", () => {
    expect(reset).toMatch(
      /p_user_id <> v_uid and public\.has_permission\(p_user_id, 'accounts\.reset_password'\)/,
    );
  });

  it("writes a bcrypt hash via pgcrypto in the extensions schema and touches updated_at", () => {
    expect(reset).toMatch(
      /encrypted_password = extensions\.crypt\(p_new_password, extensions\.gen_salt\('bf', 10\)\)/,
    );
    expect(reset).toMatch(/updated_at = now\(\)/);
  });

  it("signs the person out everywhere", () => {
    expect(reset).toMatch(/delete from auth\.sessions where user_id = p_user_id/);
  });

  it("logs who reset whom, never the password", () => {
    expect(reset).toMatch(
      /insert into public\.moderation_log \(actor_id, action, target_user_id\)\s+values \(v_uid, 'password_reset', p_user_id\)/,
    );
    expect(sql).toMatch(/moderation_log_action_check[\s\S]*'password_reset'/);
    expect(sql).toMatch(/'post_remove', 'post_reports_dismiss'/); // keeps 0050's actions
  });

  it("returns only id, username, display name and a masked email, anonymous users excluded", () => {
    expect(find).toMatch(
      /returns table \(\s*user_id uuid,\s*username text,\s*display_name text,\s*masked_email text\s*\)/,
    );
    expect(find).toMatch(/'\*\*\*@'/);
    expect(find).toMatch(/is_anonymous/);
    expect(find).toMatch(/limit 10/);
    expect(find).toMatch(/char_length\(v_q\) < 3/);
  });

  it("revokes from public and anon, grants execute to authenticated only", () => {
    expect(sql).toMatch(
      /revoke all on function public\.admin_find_accounts\(text\) from public, anon/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.admin_reset_password\(uuid, text\) from public, anon/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.admin_find_accounts\(text\) to authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.admin_reset_password\(uuid, text\) to authenticated/,
    );
    expect(sql).not.toMatch(/to anon/);
  });
});
