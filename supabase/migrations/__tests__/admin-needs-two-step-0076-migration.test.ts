import { readdirSync } from "fs";
import { join } from "path";

import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
  stripComments,
} from "../sql-test-utils";

/**
 * Static checks of migration 0076 (admin powers need two-step sign-in,
 * security checklist A1.1, audit finding DB-02). Pasted into the SQL editor
 * as one line, so the paste rules are pinned; so are the promises: a rank's
 * powers work for the caller only in an aal2 session, while checks about
 * another account and calls without a session answer as before;
 * my_permissions() is empty below aal2; my_admin_needs_two_step() tells the
 * app when to ask for the second step; nobody grants or revokes a badge on
 * their own account; no account holding a rank can have its password reset
 * by an admin; every replaced function is its previous definition plus
 * exactly that change; and every function in the chain that reads the rank
 * tables directly is either changed here or deliberately left (listed in
 * the header with the reason).
 *
 * The behaviour was exercised against a real Postgres (PGlite: 0001-0075
 * without 0041, then 0076 twice, 80 checks: own permission at aal1, aal2 and
 * without the claim; another user's id; no session and the service role;
 * my_permissions, my_has_permission and the new function for the official
 * rank, a private admin rank, a Government official, a badge without
 * powers, a plain account, a guest and anon; self grant and revoke; reset of
 * every kind of rank holder and of a plain account; the activity-log policy;
 * an owner's filtered post held at aal1 and not at aal2; alerts_my_access
 * and the pg_cron tester check; the end-of-paste check failing on four kinds
 * of breakage; the 0073 and 0074 proofs again on a chain ending in 0076, 46
 * and 77 checks) when it was written; these keep it from being edited away.
 */
const FILE = "0076_admin_needs_two_step.sql";
const raw = readMigration(FILE);
const sql = readCode(FILE);
const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const fn = (name: string) => flat(functionSource(sql, name));
const previous = (file: string, name: string) =>
  flat(functionSource(readCode(file), name));

const AAL2 = "coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'";
const SELF_RULE = `and ( auth.uid() is null or p_user <> auth.uid() or ${AAL2} ) `;

describe("0076 can be pasted into the SQL editor as one line", () => {
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

  it("is idempotent: functions replaced, nothing created that a second run would trip on", () => {
    expect(createdTables(sql)).toEqual([]);
    expect(sql).not.toMatch(/create function/i);
    expect(sql).not.toMatch(
      /create (unique )?index|create policy|create trigger|create table|alter table/i,
    );
    expect(sql).not.toMatch(/drop (function|policy|table|trigger)/i);
    expect(createdFunctions(sql)).toEqual([
      "has_permission",
      "holds_admin_permission",
      "my_permissions",
      "my_admin_needs_two_step",
      "admin_grant_role",
      "admin_revoke_role",
      "admin_reset_password",
    ]);
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0076:/);
    expect(raw).toContain("A1.1");
    expect(raw).toContain("DB-02");
  });
});

describe("has_permission(): the caller's own powers need aal2", () => {
  it("adds exactly the rule to the 0060 definition", () => {
    const body = fn("has_permission");
    expect(body).toContain(`select p_user is not null ${SELF_RULE}and ( exists (`);
    expect(body.replace(SELF_RULE, "")).toBe(
      previous("0060_admin_inbox_admin_rank_photos.sql", "has_permission"),
    );
  });

  it("keeps the signature, volatility, definer and search path", () => {
    expect(fn("has_permission")).toMatch(
      /^create or replace function public\.has_permission\(p_user uuid, p_permission text\) returns boolean language sql stable security definer set search_path = public, pg_temp as \$\$/,
    );
  });

  it("leaves its grants alone (0052 decided them)", () => {
    expect(flat(sql)).not.toMatch(
      /(grant|revoke) [^;]* on function public\.has_permission\(/,
    );
  });
});

describe("holds_admin_permission(): the staff test follows the same rule", () => {
  it("adds exactly the rule to the 0066 definition", () => {
    const body = fn("holds_admin_permission");
    expect(body).toContain(`select p_user is not null ${SELF_RULE}and ( exists (`);
    expect(body.replace(SELF_RULE, "")).toBe(
      previous("0066_admin_authority.sql", "holds_admin_permission"),
    );
  });

  it("stays closed to clients", () => {
    expect(flat(sql)).toContain(
      "revoke all on function public.holds_admin_permission(uuid) from public, anon, authenticated;",
    );
  });
});

describe("my_permissions() and my_has_permission()", () => {
  it("my_permissions is the 0060 definition, empty below aal2", () => {
    const body = fn("my_permissions");
    expect(body).toMatch(new RegExp(` where ${escape(AAL2)} \\$\\$;$`));
    expect(body.replace(` where ${AAL2}`, "")).toBe(
      previous("0060_admin_inbox_admin_rank_photos.sql", "my_permissions"),
    );
  });

  it("my_permissions keeps its grants (signed-in callers only)", () => {
    const code = flat(sql);
    expect(code).toContain(
      "revoke all on function public.my_permissions() from public, anon;",
    );
    expect(code).toContain(
      "grant execute on function public.my_permissions() to authenticated;",
    );
  });

  it("my_has_permission is not redefined: since 0052 it asks has_permission() for the caller", () => {
    expect(sql).not.toMatch(/function public\.my_has_permission/i);
    expect(previous("0052_social_p1_security_audit.sql", "my_has_permission")).toContain(
      "as $$ select public.has_permission(auth.uid(), p_permission) $$;",
    );
    for (const file of migrationFiles().filter((f) => Number(f.slice(0, 4)) > 52)) {
      expect(readCode(file)).not.toMatch(/function public\.my_has_permission\s*\(/i);
    }
  });
});

describe("my_admin_needs_two_step()", () => {
  const body = fn("my_admin_needs_two_step");

  it("takes no argument and returns a boolean; stable SQL, definer, pinned search path", () => {
    expect(body).toMatch(
      /^create or replace function public\.my_admin_needs_two_step\(\) returns boolean language sql stable security definer set search_path = public, pg_temp as \$\$/,
    );
    expect(body).not.toMatch(/p_\w+|\$1/);
  });

  it("is true only for a signed-in rank holder below aal2", () => {
    expect(body).toContain(
      "select auth.uid() is not null and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' and ( exists (",
    );
    expect(body).toContain(
      "from public.user_roles r join public.role_permissions rp on rp.role = r.role where r.user_id = auth.uid()",
    );
    expect(body).toContain(
      "from public.private_ranks k join public.role_permissions rp on rp.role = k.role where k.user_id = auth.uid()",
    );
  });

  it("only signed-in callers may run it", () => {
    const code = flat(sql);
    expect(code).toContain(
      "revoke all on function public.my_admin_needs_two_step() from public, anon;",
    );
    expect(code).toContain(
      "grant execute on function public.my_admin_needs_two_step() to authenticated;",
    );
    expect(code).not.toMatch(
      /grant execute on function public\.my_admin_needs_two_step\(\) to [^;]*anon/,
    );
  });
});

describe("badges: never to or from one's own account", () => {
  for (const name of ["admin_grant_role", "admin_revoke_role"]) {
    const check = `if v_target = v_uid then raise exception '${name}: not allowed for your own account' using errcode = '42501'; end if; `;

    it(`${name} refuses the caller's own account with 42501, right after finding the target`, () => {
      expect(fn(name)).toContain(
        `raise exception '${name}: user not found' using errcode = 'P0002'; end if; ${check}`,
      );
    });

    it(`${name} is otherwise the 0066 definition`, () => {
      expect(fn(name).replace(check, "")).toBe(
        previous("0066_admin_authority.sql", name),
      );
    });
  }

  it("keeps their grants", () => {
    const code = flat(sql);
    expect(code).toContain(
      "revoke all on function public.admin_grant_role(text, text, text, text) from public, anon;",
    );
    expect(code).toContain(
      "grant execute on function public.admin_grant_role(text, text, text, text) to authenticated;",
    );
    expect(code).toContain(
      "revoke all on function public.admin_revoke_role(text, text) from public, anon;",
    );
    expect(code).toContain(
      "grant execute on function public.admin_revoke_role(text, text) to authenticated;",
    );
  });
});

describe("admin_reset_password: never for an account that holds a rank", () => {
  const OLD =
    "if p_user_id <> v_uid and public.has_permission(p_user_id, 'accounts.reset_password') then raise exception 'admin_reset_password: not allowed for this account' using errcode = '42501'; end if;";
  const NEW =
    "if exists (select 1 from public.user_roles r where r.user_id = p_user_id) or exists (select 1 from public.private_ranks k where k.user_id = p_user_id) then raise exception 'admin_reset_password: not allowed for this account' using errcode = '42501'; end if;";

  it("refuses any role or private rank, the caller's own included, with the old message and code", () => {
    expect(fn("admin_reset_password")).toContain(NEW);
    expect(fn("admin_reset_password")).not.toContain("p_user_id <> v_uid");
  });

  it("is otherwise the 0052 definition (the new rule replaces the narrower old one)", () => {
    expect(fn("admin_reset_password").replace(NEW, OLD)).toBe(
      previous("0052_social_p1_security_audit.sql", "admin_reset_password"),
    );
  });

  it("keeps its grants", () => {
    const code = flat(sql);
    expect(code).toContain(
      "revoke all on function public.admin_reset_password(uuid, text) from public, anon;",
    );
    expect(code).toContain(
      "grant execute on function public.admin_reset_password(uuid, text) to authenticated;",
    );
  });
});

describe("every direct reader of the rank tables is decided", () => {
  const latest = latestFunctions();
  const policies = latestPolicies();
  const RANK = /\b(user_roles|private_ranks|role_permissions)\b/i;

  const CHANGED_HERE = [
    "admin_grant_role",
    "admin_reset_password",
    "admin_revoke_role",
    "has_permission",
    "holds_admin_permission",
    "my_admin_needs_two_step",
    "my_permissions",
  ];
  // Show a badge or the caller's own data, protect a target, or sit behind
  // has_permission() for the caller (the header says why for each).
  const LEFT = [
    "admin_alerts_overview",
    "admin_feedback_get",
    "admin_feedback_grant_badge",
    "admin_people_search",
    "admin_person",
    "admin_person_flags",
    "admin_role_holders",
    "admin_undo_action",
    "audit_actor_rank",
    "comment_flags_after_insert",
    "delete_my_account",
    "follow_list",
    "my_follow_requests",
    "official_account_id",
    "post_comments_page",
    "profiles_integrity_guard",
    "profiles_username_guard",
    "public_profile",
    "username_available",
  ];

  // Readers added by later migrations, each decided there (and pinned by
  // that migration's own test): 0077 event_hub_roles, the hub's badges for
  // the people whose comments the caller sees (it replaced the table read);
  // 0082 admin_grant_authority and user_roles_authority_guard (both demand
  // aal2 themselves), authority_people (behind has_permission() for the
  // caller, plus the rank's end date) and expire_authority_ranks (pg_cron,
  // no session).
  const ADDED_LATER = [
    "admin_grant_authority",
    "authority_people",
    "event_hub_roles",
    "expire_authority_ranks",
    "user_roles_authority_guard",
  ];

  it("the latest definitions that read user_roles, private_ranks or role_permissions are exactly these", () => {
    const readers = [...latest].filter(([, src]) => RANK.test(src)).map(([name]) => name);
    expect(readers.sort()).toEqual([...CHANGED_HERE, ...LEFT, ...ADDED_LATER].sort());
  });

  it("the changed ones are the latest definitions", () => {
    for (const name of CHANGED_HERE) {
      expect(`${flat(latest.get(name) as string)};`).toBe(fn(name));
    }
  });

  it("the admin functions left alone check the caller through has_permission() first", () => {
    for (const name of [
      "admin_alerts_overview",
      "admin_feedback_get",
      "admin_feedback_grant_badge",
      "admin_people_search",
      "admin_person",
      "admin_person_flags",
      "admin_role_holders",
      "admin_undo_action",
    ]) {
      expect(latest.get(name)).toMatch(/public\.has_permission\((v_uid|auth\.uid\(\))/);
    }
  });

  it("each one left alone is named in the header (export_my_data_base too, renamed by 0063)", () => {
    const header = raw
      .split("\n")
      .filter((line) => line.startsWith("--"))
      .join(" ");
    for (const name of [...LEFT, "export_my_data_base"]) {
      expect(header).toContain(name);
    }
  });

  it("the staff test is used by these four only, each behind has_permission()", () => {
    const users = [...latest]
      .filter(
        ([name, src]) =>
          name !== "holds_admin_permission" && /holds_admin_permission\(/.test(src),
      )
      .map(([name]) => name);
    expect(users.sort()).toEqual([
      "admin_person_flags",
      "admin_reset_profile_fields",
      "admin_restrict_account",
      "admin_tool_counts",
    ]);
    for (const name of users) {
      expect(latest.get(name)).toMatch(/public\.has_permission\((v_uid|auth\.uid\(\))/);
    }
  });

  it("no policy reads the rank tables or calls has_permission() or is_moderator() itself", () => {
    const offenders = [...policies]
      .filter(
        ([, src]) =>
          RANK.test(src) ||
          /\b(has_permission|is_moderator)\(/.test(src.replace(/my_has_permission/g, "")),
      )
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });
});

describe("the end-of-paste check", () => {
  const last = flat(sql).slice(flat(sql).lastIndexOf("do $$"));

  it("is the last statement and fails the paste when a part is missing", () => {
    expect(last).toMatch(
      /^do \$\$ declare v_missing text\[\] := '\{\}'::text\[\]; begin /,
    );
    expect(last).toMatch(
      /raise exception '0076: not in place: %', array_to_string\(v_missing, ', '\); end if; end \$\$;$/,
    );
  });

  it("checks the new function, its grants, and each rule", () => {
    for (const piece of [
      "p.proname = 'my_admin_needs_two_step'",
      "has_function_privilege('anon', 'public.my_admin_needs_two_step()', 'execute')",
      "not has_function_privilege('authenticated', 'public.my_admin_needs_two_step()', 'execute')",
      "has_function_privilege('anon', 'public.my_permissions()', 'execute')",
      "p.proname = 'has_permission' and p.prosrc like '%p_user <> auth.uid()%' and p.prosrc like '%''aal2''%'",
      "p.proname = 'holds_admin_permission' and p.prosrc like '%p_user <> auth.uid()%' and p.prosrc like '%''aal2''%'",
      "p.proname = 'my_permissions' and p.prosrc like '%''aal2''%'",
      "p.proname = 'my_has_permission' and p.prosrc like '%public.has_permission(auth.uid(), p_permission)%'",
      "p.proname = 'admin_grant_role' and p.prosrc like '%v_target = v_uid%'",
      "p.proname = 'admin_revoke_role' and p.prosrc like '%v_target = v_uid%'",
      "p.prosrc like '%from public.private_ranks k where k.user_id = p_user_id%'",
    ]) {
      expect(last).toContain(piece);
    }
  });

  it("each pattern it looks for is really in the new bodies", () => {
    expect(fn("has_permission")).toContain("p_user <> auth.uid()");
    expect(fn("holds_admin_permission")).toContain("p_user <> auth.uid()");
    expect(fn("admin_grant_role")).toContain("v_target = v_uid");
    expect(fn("admin_revoke_role")).toContain("v_target = v_uid");
    expect(fn("admin_reset_password")).toContain(
      "from public.private_ranks k where k.user_id = p_user_id",
    );
  });
});

function escape(text: string): string {
  return text.replace(/[.*+()|[\]{}^$\\]/g, "\\$&");
}

function migrationFiles(): string[] {
  return readdirSync(join(__dirname, ".."))
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && !f.startsWith("0041_"))
    .sort();
}

/** The last definition of every public function in the chain (0041 is parked). */
function latestFunctions(): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of migrationFiles()) {
    const code = stripComments(readMigration(file));
    const re = /create (?:or replace )?function public\.(\w+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      const rest = code.slice(m.index);
      const open = rest.match(/\bas\s+(\$\w*\$)/i);
      if (!open || open.index === undefined) {
        continue;
      }
      const close = rest.indexOf(open[1] as string, open.index + open[0].length);
      out.set(
        (m[1] as string).toLowerCase(),
        rest.slice(0, close + (open[1] as string).length),
      );
    }
  }
  return out;
}

/** The last text of every `create policy <name> on <table>` in the chain. */
function latestPolicies(): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of migrationFiles()) {
    const code = stripComments(readMigration(file));
    for (const m of code.matchAll(/create policy (\w+)\s+on\s+([\w.]+)([\s\S]*?);/gi)) {
      out.set(`${m[2]}.${m[1]}`, m[3] as string);
    }
  }
  return out;
}
