import { GAZETTEER_CITIES } from "@/features/geo/gazetteer";
import { AREA_CITY_MAX_KM } from "@/features/eventhub/area";

import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0065 (the Event hub as a post, the profile
 * redesign). Pasted into the SQL editor as one line, so the paste rules are
 * pinned; so are the promises: hearts are for accounts only (as Helpful on
 * posts), never across a block, never from a suspended account, and leave
 * with the account; the carousel aggregates never let a coordinate, a report
 * or a person leave the server and leave withdrawn reports out; the profile
 * header names people only where the followers list may be seen. The
 * behaviour was exercised against a real Postgres (PGlite: 0035-0064 then
 * 0065 twice, 78 checks; the 0064 suite again on top of 0065, 103 checks)
 * when it was written; these keep it from being edited away.
 */
const raw = readMigration("0065_hub_post.sql");
const sql = readCode("0065_hub_post.sql");
const fn = (name: string) => functionSource(sql, name);

describe("0065 can be pasted into the SQL editor as one line", () => {
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
    expect(sql).not.toMatch(/create (unique )?index (?!if not exists)/i);
    expect(sql).not.toMatch(/create function/i);
    expect(sql).not.toMatch(/add column (?!if not exists)/i);
    expect(sql).toContain(
      "on conflict (town_id) do update set lat = excluded.lat, lon = excluded.lon;",
    );
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0065:/);
  });

  it("creates exactly its three tables, each closed behind RLS", () => {
    expect(createdTables(sql)).toEqual(["hub_likes", "post_comment_likes", "felt_towns"]);
    for (const table of ["hub_likes", "post_comment_likes", "felt_towns"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`revoke all on public.${table} from public, anon, authenticated;`);
    }
  });
});

describe("hearts", () => {
  it("are for real accounts only, as Helpful on posts", () => {
    for (const name of ["set_hub_like", "set_post_comment_like"]) {
      const body = fn(name);
      expect(body).toContain("if v_uid is null or not public.is_real_account() then");
      expect(body).toContain(`raise exception '${name}: not_account'`);
      expect(body).toContain("perform public.assert_not_restricted(v_uid,");
    }
    expect(sql).toContain(
      "grant execute on function public.set_hub_like(uuid, boolean) to authenticated;",
    );
    expect(sql).toContain(
      "revoke all on function public.set_hub_like(uuid, boolean) from public, anon;",
    );
    expect(sql).not.toMatch(/grant execute on function public\.set_\w+\([^)]*\) to anon/);
  });

  it("never count across a block, nor a suspended account on the hub", () => {
    const hub = fn("hub_like_count");
    expect(hub).toContain("not public.blocked_between(auth.uid(), h.user_id)");
    expect(hub).toContain("not public.is_suspended(h.user_id)");
    const comment = fn("post_comment_like_count");
    expect(comment).toContain("not public.blocked_between(l.user_id, p_author)");
    expect(comment).toContain("not public.blocked_between(l.user_id, auth.uid())");
  });

  it("only go on a comment the person may read, and not on their own", () => {
    const body = fn("set_post_comment_like");
    expect(body).toContain("not public.can_read_post_comment(v_uid, p_comment_id)");
    expect(body).toContain("'set_post_comment_like: own_comment'");
    expect(fn("post_comment_likes_of")).toContain(
      "public.can_read_post_comment(auth.uid(), c.comment_id)",
    );
  });

  it("leave with the account", () => {
    expect(sql).toMatch(
      /create table if not exists public\.hub_likes \([\s\S]*?user_id uuid not null references auth\.users \(id\) on delete cascade/,
    );
    expect(sql).toMatch(
      /create table if not exists public\.post_comment_likes \([\s\S]*?user_id uuid not null references auth\.users \(id\) on delete cascade/,
    );
  });
});

describe("carousel aggregates", () => {
  it("leave withdrawn reports out", () => {
    for (const name of ["event_felt_towns", "event_felt_timeline"]) {
      expect(fn(name)).toContain("and r.withdrawn_at is null");
    }
  });

  it("return only a town id, a count and a level: no place, report or person", () => {
    const body = fn("event_felt_towns");
    expect(body).toContain(
      "returns table (town_id text, reports integer, level smallint)",
    );
    expect(body).not.toMatch(/report_id|user_id|device_id|geohash/);
    expect(fn("event_felt_timeline")).not.toMatch(
      /report_id|user_id|device_id|geohash|\blat\b|\blon\b/,
    );
  });

  it("show a typical level only with 3 reports, placed within the hub's own distance", () => {
    const body = fn("event_felt_towns");
    expect(body).toContain("case when count(*) >= 3");
    expect(body).toContain("percentile_disc(0.5) within group (order by p.lvl)");
    expect(body).toContain(`where n.km <= ${AREA_CITY_MAX_KM}`);
  });

  it("counts the first 24 hours after the origin, hour by hour", () => {
    const body = fn("event_felt_timeline");
    expect(body).toContain("live.created_at < ev.t0 + interval '24 hours'");
    expect(body).toContain("generate_series(0, 23)");
  });

  it("seeds exactly the app's gazetteer towns (ids and centres)", () => {
    const seeded = new Map<string, [number, number]>();
    for (const match of sql.matchAll(/\('([a-z0-9-]+)', (-?[\d.]+), (-?[\d.]+)\)/g)) {
      seeded.set(match[1] as string, [Number(match[2]), Number(match[3])]);
    }
    expect(seeded.size).toBe(GAZETTEER_CITIES.length);
    for (const city of GAZETTEER_CITIES) {
      expect(seeded.get(city.id)).toEqual([city.lat, city.lon]);
    }
  });
});

describe("profile header", () => {
  it("hides behind a block or a suspension and names people only where the followers list may be seen", () => {
    const body = fn("profile_header");
    expect(body).toContain("if public.blocked_between(v_viewer, v_id) then");
    expect(body).toContain("if public.is_suspended(v_id) and not v_self then");
    expect(body).toContain("v_may_list := v_self or not coalesce(v_private, false) or exists (");
    expect(body).toContain(
      "'followed_by', case when v_may_list and not v_self and v_viewer is not null",
    );
    expect(body).toContain("and not public.blocked_between(v_viewer, p.user_id)");
    expect(body).toContain("limit 2");
  });
});

describe("Download my data", () => {
  it("wraps the 0064 export once and adds the hearts", () => {
    expect(sql).toContain("and p.prosrc like '%export_my_data_0064%'");
    expect(sql).toContain("alter function public.export_my_data() rename to export_my_data_0064;");
    const body = fn("export_my_data");
    expect(body).toContain("return public.export_my_data_0064()");
    expect(body).toContain("'hub_likes'");
    expect(body).toContain("'post_comment_likes'");
    expect(sql).toContain(
      "revoke all on function public.export_my_data_0064() from public, anon, authenticated;",
    );
  });

  it("defines only the functions it documents", () => {
    expect(createdFunctions(sql).sort()).toEqual(
      [
        "event_felt_timeline",
        "event_felt_towns",
        "event_hub_likes",
        "export_my_data",
        "hub_like_count",
        "post_comment_like_count",
        "post_comment_likes_of",
        "profile_header",
        "set_hub_like",
        "set_post_comment_like",
      ].sort(),
    );
  });
});
