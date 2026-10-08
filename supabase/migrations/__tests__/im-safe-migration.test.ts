import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0057 ("I'm safe" check-in v1 and remove a home
 * member). It is pasted into the SQL editor as one line, so the paste rules
 * are pinned here, and so are the privacy promises of the feature: no
 * location of any kind, no direct table access, members of an active home
 * only, blocks hide both ways, each member's own switch, check-ins made
 * before a reader joined stay hidden, and the 30-day purge. The behaviour
 * was exercised against a real Postgres (PGlite) when it was written; these
 * keep it from being edited away.
 */
const raw = readMigration("0057_im_safe.sql");
const sql = readCode("0057_im_safe.sql");
const fn = (name: string) => functionSource(sql, name);

/** The column list of one `create table` in this migration. */
function tableBody(name: string): string {
  const start = sql.search(
    new RegExp(`create table if not exists public\\.${name}\\s*\\(`, "i"),
  );
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf(");", start));
}

describe("0057 can be pasted into the SQL editor as one line", () => {
  it("has no transaction statements", () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });

  it("has only full-line comments (no inline -- that would swallow the rest of the line)", () => {
    for (const line of sql.split("\n")) {
      expect(line).not.toContain("--");
    }
  });

  it("is plain ASCII", () => {
    expect(raw).not.toMatch(/[^\x00-\x7f]/);
  });

  it("never uses the ? jsonb operator (editors read it as a parameter)", () => {
    expect(sql).not.toMatch(/\s\?\s*'/);
  });

  it("is idempotent", () => {
    expect(sql).not.toMatch(/create table (?!if not exists)/i);
    expect(sql).not.toMatch(/create index (?!if not exists)/i);
    expect(sql).not.toMatch(/create function/i);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(
      /add column if not exists share_checkins boolean not null default true/,
    );
    expect(sql).toMatch(
      /if exists \(select 1 from cron\.job where jobname = 'purge_safety_checkins'\)/,
    );
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0057:/);
  });
});

describe("a check-in never carries a location", () => {
  it("creates exactly the two tables, neither with a location-like column", () => {
    expect(createdTables(sql).sort()).toEqual(["home_member_undo", "safety_checkins"]);
    for (const table of ["safety_checkins", "home_member_undo"]) {
      expect(tableBody(table)).not.toMatch(
        /\b(lat|lon|latitude|longitude|geohash\w*|geom\w*|location\w*|accuracy|device_id|ip\w*|address|area\w*)\b/i,
      );
    }
  });

  it("returns only fixed, non-location fields to the family", () => {
    const body = fn("family_checkins");
    expect(body).not.toMatch(/\.(lat|lon|geohash\w*|area_geohash)\b/i);
    expect(body).not.toMatch(/'(lat|lon|geohash|location|device_id)'/i);
    for (const key of [
      "user_id",
      "checked_in_at",
      "event_id",
      "bumelerze_id",
      "magnitude",
      "place",
      "origin_time",
    ]) {
      expect(body).toContain(`'${key}'`);
    }
    expect(fn("my_checkins")).not.toMatch(/lat|lon|geohash/i);
    expect(fn("check_in")).not.toMatch(/\blat\b|\blon\b|geohash/i);
  });

  it("is closed to direct reads and writes (RLS on, no policy, privileges revoked)", () => {
    expect(sql).toMatch(/alter table public\.safety_checkins enable row level security/);
    expect(sql).toMatch(
      /revoke all on public\.safety_checkins from public, anon, authenticated/,
    );
    expect(sql).toMatch(/alter table public\.home_member_undo enable row level security/);
    expect(sql).toMatch(
      /revoke all on public\.home_member_undo from public, anon, authenticated/,
    );
  });
});

describe("check_in", () => {
  const body = fn("check_in");
  it("is for accounts only, idempotent on the client id", () => {
    expect(body).toMatch(/is_anonymous'\)::boolean, true\)/);
    expect(body).toMatch(/not_account' using errcode = '42501'/);
    expect(sql).toMatch(/client_id uuid not null unique/);
    expect(body).toMatch(/on conflict \(client_id\) do nothing/);
    expect(body).toMatch(/v_row\.user_id <> v_uid/);
  });

  it("is tied to a real, recent earthquake and clamps the phone's time", () => {
    expect(body).toMatch(/review_status <> 'deleted'/);
    expect(body).toMatch(/now\(\) - interval '72 hours'/);
    expect(body).toMatch(/least\(coalesce\(p_checked_in_at, now\(\)\), now\(\)\)/);
    expect(body).toMatch(/greatest\(v_at, v_origin, now\(\) - interval '72 hours'\)/);
  });

  it("is rate limited to 10 an hour", () => {
    expect(body).toMatch(/interval '1 hour'/);
    expect(body).toMatch(/v_recent >= 10/);
  });

  it("a late check-in cannot revive an undone one (tombstone)", () => {
    const retract = fn("retract_checkin");
    expect(retract).toMatch(/where client_id = p_client_id and user_id = v_uid/);
    expect(retract).toMatch(/values \(p_client_id, v_uid, null, 'retracted'/);
    expect(sql).toMatch(/check \(status = 'retracted' or event_id is not null\)/);
  });
});

describe("family_checkins: who may read", () => {
  const body = fn("family_checkins");
  it("approved members of an active home only", () => {
    expect(body).toMatch(/not public\.is_home_member\(p_tag\)/);
    expect(body).toMatch(/t\.status = 'active'/);
    expect(body).toMatch(/members only' using errcode = '42501'/);
    expect(body).toMatch(/m\.status = 'approved'/);
  });

  it("respects each member's switch, the reader's join time and blocks both ways", () => {
    expect(body).toMatch(/m\.share_checkins/);
    expect(body).toMatch(/c\.created_at >= v_since/);
    expect(body).toMatch(/coalesce\(m\.decided_at, m\.requested_at\)/);
    const blocks = body.match(
      /\(b\.blocker_id = v_uid and b\.blocked_id = (m|c)\.user_id\)\s+or \(b\.blocker_id = (m|c)\.user_id and b\.blocked_id = v_uid\)/g,
    );
    expect(blocks?.length).toBe(2);
  });

  it("shows only 'safe' rows of the last week, a few per person", () => {
    expect(body).toMatch(/c\.status = 'safe'/);
    expect(body).toMatch(/interval '7 days'/);
    expect(body).toMatch(/x\.n <= 5/);
  });

  it("does not read followers (D78 audience narrowed to home members in v1)", () => {
    expect(body).not.toMatch(/follows/);
  });
});

describe("remove a home member (owner) with a 10-minute undo", () => {
  it("owners only, never the owner, memory kept for undo", () => {
    const remove = fn("remove_home_member");
    expect(remove).toMatch(/not public\.is_home_owner\(p_tag\)/);
    expect(remove).toMatch(/v_m\.role = 'owner' or p_user = auth\.uid\(\)/);
    expect(remove.indexOf("insert into public.home_member_undo")).toBeLessThan(
      remove.indexOf("delete from public.home_members"),
    );
  });

  it("restore needs the same owner's memory from the last 10 minutes", () => {
    const restore = fn("restore_home_member");
    expect(restore).toMatch(/not public\.is_home_owner\(p_tag\)/);
    expect(restore).toMatch(/removed_by = auth\.uid\(\)/);
    expect(restore).toMatch(/removed_at > now\(\) - interval '10 minutes'/);
    expect(restore).toMatch(/delete from public\.home_member_undo/);
  });
});

describe("retention", () => {
  it("purges check-ins after 30 days and undo memory after a day, nightly", () => {
    const purge = fn("purge_safety_checkins");
    expect(purge).toMatch(
      /delete from public\.safety_checkins where created_at < now\(\) - interval '30 days'/,
    );
    expect(purge).toMatch(
      /delete from public\.home_member_undo where removed_at < now\(\) - interval '1 day'/,
    );
    expect(sql).toMatch(/cron\.schedule\('purge_safety_checkins', '35 3 \* \* \*'/);
  });

  it("goes with the account (cascade)", () => {
    expect(tableBody("safety_checkins")).toMatch(
      /user_id uuid not null references auth\.users \(id\) on delete cascade/,
    );
  });
});

describe("grants", () => {
  const userFunctions = [
    "check_in(uuid, uuid, timestamptz)",
    "retract_checkin(uuid)",
    "my_checkins()",
    "family_checkins(uuid)",
    "set_checkin_sharing(uuid, boolean)",
    "remove_home_member(uuid, uuid)",
    "restore_home_member(uuid, uuid)",
  ];

  it("every function is security definer with a pinned search path", () => {
    for (const name of createdFunctions(sql)) {
      expect([name, fn(name)]).toEqual([name, expect.stringMatching(/security definer/)]);
      expect([name, fn(name)]).toEqual([
        name,
        expect.stringMatching(/set search_path = public, pg_temp/),
      ]);
    }
  });

  it("signed-in users only; the purge for the service role only", () => {
    for (const signature of userFunctions) {
      expect(sql).toContain(
        `revoke all on function public.${signature} from public, anon;`,
      );
      expect(sql).toContain(
        `grant execute on function public.${signature} to authenticated;`,
      );
    }
    expect(sql).toContain(
      "revoke all on function public.purge_safety_checkins() from public, anon, authenticated;",
    );
    expect(sql).toContain(
      "grant execute on function public.purge_safety_checkins() to service_role;",
    );
  });

  it("writes no audit rows (no admin acts here)", () => {
    expect(sql).not.toMatch(/write_audit/);
  });
});
