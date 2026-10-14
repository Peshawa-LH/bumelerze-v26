import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0066 (admin tools, the Government official
 * rank). Pasted into the SQL editor as one line, so the paste rules are
 * pinned; so are the promises: the official rank is not staff and opens
 * aggregates only; small numbers (under 5) never leave the server; a person
 * is shown to officials only after switching sharing on; every official
 * read is logged; statistics are counts only; the hub note is written as
 * the official account while the log names the real admin. The behaviour
 * was exercised against a real Postgres (PGlite: 0035-0065 then 0066 twice,
 * 126 checks; the 0065 suite again on top of 0066, 78 checks; the 0064
 * suite on top of 0066, 103 checks) when it was written; these keep it from
 * being edited away.
 */
const raw = readMigration("0066_admin_authority.sql");
const sql = readCode("0066_admin_authority.sql");
const fn = (name: string) => functionSource(sql, name);

describe("0066 can be pasted into the SQL editor as one line", () => {
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
    expect(sql).not.toMatch(/create table (?!if not exists)/i);
    expect(sql).not.toMatch(/create (unique )?index (?!if not exists)/i);
    expect(sql).not.toMatch(/create function/i);
    expect(sql).not.toMatch(/add column (?!if not exists)/i);
    expect(sql).toContain("on conflict do nothing;");
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0066:/);
  });

  it("creates exactly one table, closed behind RLS", () => {
    expect(createdTables(sql)).toEqual(["authority_sharing"]);
    expect(sql).toContain("alter table public.authority_sharing enable row level security;");
    expect(sql).toContain("revoke all on public.authority_sharing from public, anon, authenticated;");
    expect(sql).toMatch(
      /create table if not exists public\.authority_sharing \([\s\S]*?user_id uuid primary key references auth\.users \(id\) on delete cascade/,
    );
  });
});

describe("the Government official rank", () => {
  it("holds authority.view only, and nobody is given it here", () => {
    expect(sql).toContain("('authority', 'authority.view')");
    // the only insert into user_roles is inside admin_grant_role itself
    expect(sql.replace(fn("admin_grant_role"), "")).not.toMatch(/insert into public\.user_roles/i);
    expect(sql).not.toMatch(/insert into public\.private_ranks/i);
  });

  it("is not staff", () => {
    const body = fn("holds_admin_permission");
    expect(body.match(/rp\.permission not like 'authority\.%'/g)).toHaveLength(2);
  });

  it("can be given and taken away by badge admins", () => {
    for (const name of ["admin_grant_role", "admin_revoke_role"]) {
      const body = fn(name);
      expect(body).toContain("public.has_permission(v_uid, 'badges.grant')");
      expect(body).toContain("'partner', 'authority')");
      expect(body).not.toContain("'official', 'moderator'");
    }
  });

  it("gives statistics and hub opening to the official and admin ranks only", () => {
    for (const row of [
      "('official', 'stats.read')",
      "('admin', 'stats.read')",
      "('official', 'hubs.open')",
      "('admin', 'hubs.open')",
    ]) {
      expect(sql).toContain(row);
    }
    expect(sql).not.toMatch(/\('moderator', '(stats|hubs)\./);
  });
});

describe("what officials see", () => {
  it("every authority function checks authority.view and writes the log", () => {
    for (const name of ["authority_overview", "authority_event_safety", "authority_people"]) {
      const body = fn(name);
      expect(body).toContain("public.has_permission(v_uid, 'authority.view')");
      expect(body).toContain("perform public.write_audit(");
    }
  });

  it("suppresses anything under 5 on the server", () => {
    const overview = fn("authority_overview");
    expect(overview).toContain("case when s.n >= 5 and homes.area <> 'other' then homes.area else 'other' end");
    expect(overview).toContain("where a.total >= 5");
    expect(overview).toContain("case when g.n >= 5 then g.n end");
    expect(overview).toContain("having count(distinct c.user_id) >= 5");
    const safety = fn("authority_event_safety");
    expect(safety).toContain("'safe', case when r.safe >= 5 then r.safe end");
    expect(safety).toContain("where r.people >= 5");
    expect(safety).toContain("'checkins', case when v_total >= 5 then v_total end");
  });

  it("never sends a coordinate, a home code or a contact", () => {
    for (const name of ["authority_overview", "authority_event_safety", "authority_people"]) {
      const body = fn(name);
      expect(body).not.toMatch(/'lat'|'lon'|'code'|'email'|'label'|device_id|geohash/);
    }
  });

  it("lists a person only after they switched sharing on", () => {
    const body = fn("authority_people");
    expect(body).toContain("from public.authority_sharing s");
    expect(body).toContain("where s.enabled");
    expect(body).toContain("'user_ids', v_ids");
  });

  it("places homes by the app's own town list and distance", () => {
    expect(fn("area_town")).toContain("from public.felt_towns t");
    expect(fn("area_town")).toContain("n.km <= 100");
  });
});

describe("the sharing switch", () => {
  it("is for real accounts, off by default", () => {
    expect(fn("set_authority_sharing")).toContain(
      "if v_uid is null or not public.is_real_account() then",
    );
    expect(fn("my_authority_sharing")).toContain(
      "return jsonb_build_object('enabled', false, 'changed_at', null);",
    );
  });

  it("is part of Download my data, wrapping the 0065 export once", () => {
    expect(sql).toContain("and p.prosrc like '%export_my_data_0065%'");
    expect(sql).toContain("alter function public.export_my_data() rename to export_my_data_0065;");
    const body = fn("export_my_data");
    expect(body).toContain("return public.export_my_data_0065()");
    expect(body).toContain("'authority_sharing'");
    expect(sql).toContain(
      "revoke all on function public.export_my_data_0065() from public, anon, authenticated;",
    );
  });
});

describe("admin tools", () => {
  it("statistics are staff-only counts", () => {
    const body = fn("admin_stats");
    expect(body).toContain("public.has_permission(v_uid, 'stats.read')");
    expect(body).not.toMatch(/'lat'|'lon'|'user_id'|'username'|'email'|'device_id'/);
  });

  it("the launcher counts are for staff, per tool", () => {
    const body = fn("admin_tool_counts");
    expect(body).toContain("not public.holds_admin_permission(v_uid)");
    for (const perm of ["people.view", "comments.moderate", "filter.manage", "alerts.test", "hubs.open", "feedback.manage"]) {
      expect(body).toContain(`public.has_permission(v_uid, '${perm}')`);
    }
  });

  it("the hub note is written as the official account, pinned, and logged under the real admin", () => {
    const body = fn("admin_post_hub_note");
    expect(body).toContain("public.has_permission(v_uid, 'hubs.open')");
    expect(body).toContain("v_official := public.official_account_id();");
    expect(body).toContain("set status = 'visible', pinned_at = now()");
    expect(body).toContain("v_uid, 'hub_note', 'event'");
    expect(fn("official_account_id")).toContain("r.role = 'official'");
    expect(fn("official_account_id")).toContain("p.username = 'bumelerze'");
  });

  it("hub search treats % and _ as plain characters", () => {
    expect(fn("admin_hub_events")).toContain("replace(replace(replace(v_q, '\\', '\\\\'), '%', '\\%'), '_', '\\_')");
  });
});

describe("who may call what", () => {
  it("no new function is open to anon", () => {
    expect(sql).not.toMatch(/grant execute on function public\.\w+\([^)]*\) to anon/);
  });

  it("closes the helpers found by the 10.2 audit", () => {
    expect(sql).toContain(
      "revoke all on function public.can_view_posts_of(uuid) from public, anon, authenticated;",
    );
    expect(sql).toContain("revoke all on function public.is_home_member(uuid) from public, anon;");
    expect(sql).toContain("revoke all on function public.is_home_owner(uuid) from public, anon;");
    expect(sql).toContain("grant execute on function public.is_home_member(uuid) to authenticated;");
  });

  it("keeps internal helpers internal", () => {
    for (const sig of [
      "area_town(double precision, double precision)",
      "official_account_id()",
      "holds_admin_permission(uuid)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${sig} from public, anon, authenticated;`);
    }
  });

  it("defines only the functions it documents", () => {
    expect(createdFunctions(sql).sort()).toEqual(
      [
        "activity_on_roles",
        "admin_grant_role",
        "admin_hub_events",
        "admin_post_hub_note",
        "admin_revoke_role",
        "admin_set_hub_open",
        "admin_stats",
        "admin_tool_counts",
        "area_town",
        "audit_actor_rank",
        "authority_event_safety",
        "authority_overview",
        "authority_people",
        "export_my_data",
        "holds_admin_permission",
        "my_authority_sharing",
        "official_account_id",
        "set_authority_sharing",
      ].sort(),
    );
  });
});
