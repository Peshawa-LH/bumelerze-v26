import { readdirSync } from "fs";
import { join } from "path";

import {
  createdFunctions,
  createdTables,
  readCode,
  readMigration,
  stripComments,
} from "../sql-test-utils";

/**
 * Static checks of migration 0077 (security checklist A1.2 and A1.5: events
 * the app registers wait for their provider; public columns say no more than
 * the app shows). Pasted into the SQL editor as one line, so the paste rules
 * are pinned; so are the promises. The behaviour was exercised against a real
 * Postgres (PGlite: 0001-0076 without 0041, then 0077 twice in its one-line
 * form, 129 checks: server ingest publishes as before, a client registration
 * waits and is published by each of the four verification paths, a felt
 * report on a waiting event keeps its link, the SHAKEmap worker starts only
 * with a verified source, every hidden column answers 42501 to anon and
 * authenticated while every column the app reads stays readable, removed
 * comments are read only by their author and moderators, the end-of-paste
 * check bites; the 0073, 0074 and 0076 suites again on a chain ending in
 * 0077) when it was written; these keep it from being edited away.
 */
const FILE = "0077_events_and_public_data.sql";
const raw = readMigration(FILE);
const sql = readCode(FILE);
/** `create or replace function public.<name>(...) ... as $tag$ ... $tag$`,
 * whatever the dollar tag ($$ or $function$, as in 0033). */
function fnText(code: string, name: string): string {
  const start = code.search(
    new RegExp(`create or replace function public\\.${name}\\s*\\(`, "i"),
  );
  if (start < 0) {
    throw new Error(`function ${name} not found`);
  }
  const rest = code.slice(start);
  const open = rest.match(/\bas\s+(\$\w*\$)/i);
  if (!open || open.index === undefined) {
    throw new Error(`function ${name} has no body`);
  }
  const tag = open[1] as string;
  const close = rest.indexOf(tag, open.index + open[0].length);
  return rest.slice(0, close + tag.length);
}
const fn = (name: string) => fnText(sql, name);
/** Whitespace collapsed, as the one-line paste does. */
const flat = (text: string) => text.replace(/\s+/g, " ").trim();
/** The function's text in an earlier file, comments out, whitespace collapsed. */
const before = (file: string, name: string) => flat(fnText(readCode(file), name));
const after = (name: string) => flat(fn(name));
/** 0077's body with the given added fragments taken out again. */
function without(name: string, ...added: string[]): string {
  let text = after(name);
  for (const piece of added) {
    const flatPiece = flat(piece);
    expect(text).toContain(flatPiece);
    text = text.replace(flatPiece, "").replace(/\s+/g, " ").trim();
  }
  return text;
}

/** The text of `create policy <name> on <table> ... ;`. */
function policy(name: string): string {
  const start = sql.indexOf(`create policy ${name}`);
  if (start < 0) {
    throw new Error(`policy ${name} not found`);
  }
  return flat(sql.slice(start, sql.indexOf(";", start) + 1));
}

/** Columns of a `grant select (...) on public.<table>` statement. */
function grantedColumns(table: string): string[] {
  const m = sql.match(
    new RegExp(`grant select \\(([^)]*)\\) on public\\.${table} to anon, authenticated;`),
  );
  if (!m) {
    throw new Error(`no column grant on ${table}`);
  }
  return (m[1] as string).split(",").map((c) => c.trim());
}

describe("0077 can be pasted into the SQL editor as one line", () => {
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
    expect(createdTables(sql)).toEqual([]);
    expect(sql).not.toMatch(/create (unique )?index/i);
    expect(sql).not.toMatch(/create function/i);
    expect(sql).toContain(
      "alter table public.event_comments add column if not exists area_town text;",
    );
    const triggers = [
      ...sql.matchAll(/create trigger (\w+)\s+\w+[\s\S]*? on (public\.\w+)/g),
    ];
    expect(triggers.map((m) => m[1]).sort()).toEqual([
      "event_comments_set_area_town",
      "felt_reports_server_times",
      "source_records_publish_event",
    ]);
    for (const [, name, table] of triggers) {
      expect(sql).toContain(`drop trigger if exists ${name} on ${table};`);
    }
    const policies = [...sql.matchAll(/create policy (\w+)\s+on (public\.\w+)/g)];
    expect(policies.map((m) => m[1]).sort()).toEqual([
      "event_comments_read",
      "events_public_select",
    ]);
    for (const [, name, table] of policies) {
      expect(sql).toContain(`drop policy if exists ${name} on ${table};`);
    }
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0077:/);
  });

  it("defines exactly these functions", () => {
    expect(createdFunctions(sql).sort()).toEqual(
      [
        "admin_hub_events",
        "event_comments_set_area_town",
        "event_hub_removed",
        "event_hub_roles",
        "events_request_shake_worker",
        "felt_reports_server_times",
        "geohash_area_town",
        "share_event_to_profile",
        "source_records_publish_event",
        "surge_state",
        "upsert_event_from_client",
      ].sort(),
    );
  });

  it("is the latest definition of each function it replaces, in the whole chain 0001-0077", () => {
    const files = readdirSync(join(__dirname, ".."))
      .filter((f) => /^\d{4}_.*\.sql$/.test(f) && !f.startsWith("0041_"))
      .sort();
    expect(files[files.length - 1]).toBe(FILE);
    for (const name of createdFunctions(sql)) {
      const last = [...files]
        .reverse()
        .find((f) =>
          new RegExp(`create or replace function public\\.${name}\\s*\\(`, "i").test(
            stripComments(readMigration(f)),
          ),
        );
      expect(last).toBe(FILE);
    }
  });
});

describe("A1.2: events the app registers wait for their provider", () => {
  it("nobody reads an unconfirmed event through the API", () => {
    expect(policy("events_public_select")).toBe(
      "create policy events_public_select on public.events for select to anon, authenticated using (status <> 'unconfirmed');",
    );
  });

  it("the registration is 0033's, plus the place rule, the window and the status", () => {
    const placeRule = `if v_client and p_place_name is not null
     and (public.text_has_link(p_place_name)
          or p_place_name ~ '[[:cntrl:]]'
          or p_place_name ~ ('[' || chr(8234) || '-' || chr(8238) || chr(8294) || '-' || chr(8297) || ']')) then
    raise exception 'upsert_event_from_client: place must be plain text' using errcode = '22023';
  end if;`;
    const window = `if v_client
     and (p_origin_time < now() - interval '400 days'
          or p_origin_time > now() + interval '5 minutes') then
    raise exception 'upsert_event_from_client: origin_time out of sane range: %', p_origin_time
      using errcode = '22023';
  end if;`;
    const reduced = without(
      "upsert_event_from_client",
      placeRule,
      window,
      ", status",
      ", case when v_client then 'unconfirmed' else 'published' end",
    );
    expect(reduced).toBe(
      before("0033_security_hardening.sql", "upsert_event_from_client"),
    );
  });

  it("a lookup of a known record is never refused; the window applies to a NEW event only", () => {
    const body = after("upsert_event_from_client");
    const known = body.indexOf("return v_event_id; end if;");
    const place = body.indexOf("place must be plain text");
    const matched = body.indexOf("return v_match_event_id; end if;");
    const window = body.indexOf("interval '400 days'");
    const allocate = body.indexOf("public.allocate_bumelerze_id(");
    expect(known).toBeGreaterThan(0);
    expect(place).toBeGreaterThan(known);
    expect(matched).toBeGreaterThan(place);
    expect(window).toBeGreaterThan(matched);
    expect(allocate).toBeGreaterThan(window);
  });

  it("needs a session: anon loses EXECUTE, authenticated and the service role keep it", () => {
    const sig =
      "public.upsert_event_from_client(text, text, timestamp with time zone, double precision, double precision, numeric, numeric, text, text)";
    expect(sql).toContain(`revoke all on function ${sig} from public, anon;`);
    expect(sql).toContain(
      `grant execute on function ${sig} to authenticated, service_role;`,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.upsert_event_from_client[^;]*\banon\b/,
    );
  });

  it("a verified, live provider record publishes the event that waited for it", () => {
    const body = after("source_records_publish_event");
    expect(body).toContain("security definer set search_path = public, pg_temp");
    expect(body).toContain(
      "update public.events e set status = 'published', updated_at = now() where e.event_id = new.event_id and e.status = 'unconfirmed' and e.review_status <> 'deleted' and e.merged_into is null and e.magnitude is not null;",
    );
    expect(flat(sql)).toContain(
      "create trigger source_records_publish_event after insert or update on public.event_source_records for each row when (new.verified_at is not null and new.review_status <> 'deleted' and new.provider <> 'bumelerze-crowd') execute function public.source_records_publish_event();",
    );
    expect(sql).toContain(
      "revoke all on function public.source_records_publish_event() from public, anon, authenticated;",
    );
  });

  it("felt reports keep a waiting event: 0073's trigger plus that rule, as security definer", () => {
    const reduced = without(
      "felt_reports_server_times",
      "security definer",
      "v_review text; v_magnitude numeric;",
      ", e.review_status, e.magnitude",
      ", v_review, v_magnitude",
      ", e.review_status, e.magnitude",
      ", v_review, v_magnitude",
      ", 'unconfirmed'",
      "or (v_status = 'unconfirmed' and (v_review = 'deleted' or v_magnitude is null))",
    );
    expect(reduced).toBe(
      before("0073_felt_writes_need_session.sql", "felt_reports_server_times"),
    );
    expect(after("felt_reports_server_times")).toContain(
      "not in ('published', 'possible', 'unconfirmed')",
    );
    expect(flat(sql)).toContain(
      "create trigger felt_reports_server_times before insert on public.felt_reports for each row execute function public.felt_reports_server_times();",
    );
  });

  it("the SHAKEmap worker needs a verified source: 0072's trigger plus that check", () => {
    const check = `if (tg_op = 'UPDATE' or public.request_is_client())
     and not exists (
       select 1
         from public.event_source_records esr
        where esr.event_id = new.event_id
          and esr.review_status <> 'deleted'
          and esr.verified_at is not null
     ) then
    return new;
  end if;`;
    expect(without("events_request_shake_worker", check)).toBe(
      before("0072_shake_worker_dispatch.sql", "events_request_shake_worker"),
    );
    const body = after("events_request_shake_worker");
    expect(body.indexOf("esr.verified_at is not null")).toBeLessThan(
      body.indexOf("perform public.request_shake_worker('new '"),
    );
  });

  it("profiles, busy time and the officials' hub list leave unconfirmed events out (one condition each)", () => {
    expect(
      without("share_event_to_profile", "and e.status <> 'unconfirmed'").replace(
        "where e.event_id = v_event",
        "e.event_id = v_event",
      ),
    ).toBe(
      before("0059_content_filter_surge_pin.sql", "share_event_to_profile").replace(
        "where e.event_id = v_event",
        "e.event_id = v_event",
      ),
    );
    expect(without("surge_state", "and e.status = 'published'")).toBe(
      before("0064_share_safe_withdraw.sql", "surge_state"),
    );
    expect(without("admin_hub_events", "and e.status <> 'unconfirmed'")).toBe(
      before("0066_admin_authority.sql", "admin_hub_events"),
    );
    expect(sql).toContain(
      "revoke all on function public.share_event_to_profile(text, text) from public, anon;",
    );
    expect(sql).toContain(
      "grant execute on function public.share_event_to_profile(text, text) to authenticated;",
    );
    expect(sql).toContain(
      "revoke all on function public.surge_state() from public, anon, authenticated;",
    );
    expect(sql).toContain(
      "grant execute on function public.admin_hub_events(text, integer) to authenticated;",
    );
  });
});

describe("A1.5: public columns say no more than the app shows", () => {
  it("each column grant follows a revoke of the table grant", () => {
    for (const table of [
      "event_comments",
      "felt_comments",
      "felt_photos",
      "event_source_records",
      "shakemap_products",
    ]) {
      const revoke = sql.indexOf(
        `revoke select on public.${table} from anon, authenticated;`,
      );
      const grant = sql.indexOf(`) on public.${table} to anon, authenticated;`);
      expect(revoke).toBeGreaterThan(0);
      expect(grant).toBeGreaterThan(revoke);
    }
    expect(sql).not.toMatch(/grant (select|all)[^;(]* on (table )?public\.\w+ to/i);
  });

  it("event_comments: the hub's columns, the town instead of the cell, no moderation trail", () => {
    expect(grantedColumns("event_comments")).toEqual([
      "comment_id",
      "event_id",
      "parent_id",
      "user_id",
      "body",
      "area_town",
      "status",
      "helpful_count",
      "reply_count",
      "created_at",
      "pinned_at",
    ]);
  });

  it("felt comments and photos: no device id, owner, storage path or moderator", () => {
    expect(grantedColumns("felt_comments")).toEqual([
      "comment_id",
      "report_id",
      "body",
      "moderation_status",
      "created_at",
    ]);
    expect(grantedColumns("felt_photos")).toEqual([
      "photo_id",
      "report_id",
      "moderation_status",
      "created_at",
    ]);
  });

  it("source records lose raw_payload only; map products lose reviewed_by only", () => {
    const esr = grantedColumns("event_source_records");
    expect(esr).not.toContain("raw_payload");
    expect(esr).toEqual(
      expect.arrayContaining([
        "event_id",
        "provider",
        "provider_event_id",
        "fetched_at",
        "verified_at",
      ]),
    );
    expect(esr).toHaveLength(19);
    const maps = grantedColumns("shakemap_products");
    expect(maps).not.toContain("reviewed_by");
    expect(maps).toEqual(
      expect.arrayContaining([
        "event_id",
        "version",
        "product_type",
        "storage_path",
        "data_used",
      ]),
    );
    expect(maps).toHaveLength(14);
  });

  it("user_roles is no longer a client table", () => {
    expect(sql).toContain("revoke select on public.user_roles from anon, authenticated;");
    expect(sql).toContain("drop policy if exists user_roles_read on public.user_roles;");
    expect(sql).not.toMatch(/grant [^;]* on public\.user_roles/);
  });

  it("removed comments: 0054's read policy with 'removed' taken out of the public part", () => {
    const prev54 = readCode("0054_social_p1_restrictions.sql");
    const start = prev54.indexOf("create policy event_comments_read");
    const old = flat(prev54.slice(start, prev54.indexOf(";", start) + 1));
    expect(policy("event_comments_read")).toBe(
      old.replace("status in ('visible', 'removed')", "status = 'visible'"),
    );
  });

  it("event_hub_removed: a removed top-level comment with a visible reply, id and time only", () => {
    const body = after("event_hub_removed");
    expect(body).toContain("returns table (comment_id uuid, created_at timestamptz)");
    expect(body).toContain("security definer set search_path = public, pg_temp");
    expect(body).toContain(
      "select c.comment_id, c.created_at from public.event_comments c",
    );
    expect(body).toContain("and c.parent_id is null and c.status = 'removed'");
    expect(body).toContain("r.status = 'visible'");
    expect(body).not.toMatch(/user_id,|hidden_reason|body/);
    expect(sql).toContain(
      "grant execute on function public.event_hub_removed(uuid) to anon, authenticated;",
    );
  });

  it("event_hub_roles: role and organisation of the people whose comments the caller sees", () => {
    const body = after("event_hub_roles");
    expect(body).toContain("returns table (user_id uuid, role text, org_name text)");
    expect(body).toContain(
      "select ur.user_id, ur.role, ur.org_name from public.user_roles ur",
    );
    expect(body).toContain("where c.event_id = p_event_id");
    expect(body).toContain(
      "(c.status = 'visible' and not public.is_suspended(c.user_id))",
    );
    expect(body).toContain("or c.user_id = auth.uid()");
    expect(body).toContain(
      "or (c.status = 'pending' and public.my_has_permission('comments.moderate'))",
    );
    expect(body).not.toMatch(/granted_at|granted_by|note/);
    expect(sql).toContain(
      "grant execute on function public.event_hub_roles(uuid) to anon, authenticated;",
    );
  });

  it("the town is filled by a trigger from the cell; the helpers are internal", () => {
    expect(after("geohash_area_town")).toContain(
      "return public.area_town(extensions.st_y(v_point), extensions.st_x(v_point));",
    );
    expect(after("geohash_area_town")).toContain(
      "exception when others then return null;",
    );
    expect(after("event_comments_set_area_town")).toContain(
      "new.area_town := public.geohash_area_town(new.area_geohash);",
    );
    expect(flat(sql)).toContain(
      "create trigger event_comments_set_area_town before insert or update of area_geohash on public.event_comments for each row execute function public.event_comments_set_area_town();",
    );
    for (const name of ["geohash_area_town(text)", "event_comments_set_area_town()"]) {
      expect(sql).toContain(
        `revoke all on function public.${name} from public, anon, authenticated;`,
      );
    }
  });
});

describe("the end-of-paste check", () => {
  const line = flat(sql);
  const last = line.slice(line.lastIndexOf("do $$"));

  it("is the last statement and fails the paste when a part is missing", () => {
    expect(last).toMatch(
      /^do \$\$ declare v_missing text\[\] := '\{\}'::text\[\]; begin /,
    );
    expect(last).toMatch(
      /raise exception '0077: not in place: %', array_to_string\(v_missing, ', '\); end if; end \$\$;$/,
    );
  });

  it("checks the policy, the grants, the triggers and each rule", () => {
    for (const piece of [
      "policyname = 'events_public_select' and qual like '%unconfirmed%'",
      "has_function_privilege('anon', 'public.upsert_event_from_client(",
      "t.tgname = 'source_records_publish_event'",
      "p.proname = 'felt_reports_server_times' and p.prosecdef",
      "p.prosrc like '%esr.verified_at is not null%'",
      "policyname = 'event_comments_read' and qual like '%removed%'",
      "has_column_privilege('anon', 'public.event_comments', 'area_geohash', 'select')",
      "has_column_privilege('anon', 'public.felt_comments', 'device_id', 'select')",
      "has_column_privilege('anon', 'public.felt_photos', 'storage_path', 'select')",
      "has_column_privilege('anon', 'public.event_source_records', 'raw_payload', 'select')",
      "has_column_privilege('anon', 'public.shakemap_products', 'reviewed_by', 'select')",
      "has_table_privilege('anon', 'public.user_roles', 'select')",
      "not has_column_privilege('anon', 'public.shakemap_products', 'storage_path', 'select')",
      "policyname = 'user_roles_read'",
    ]) {
      expect(last).toContain(piece);
    }
  });

  it("each pattern it looks for is really in the new bodies", () => {
    expect(after("upsert_event_from_client")).toContain(
      "then 'unconfirmed' else 'published'",
    );
    expect(after("upsert_event_from_client")).toContain("interval '400 days'");
    expect(after("upsert_event_from_client")).toContain(
      "public.text_has_link(p_place_name)",
    );
    expect(after("felt_reports_server_times")).toContain(
      "'published', 'possible', 'unconfirmed'",
    );
    expect(after("share_event_to_profile")).toContain("e.status <> 'unconfirmed'");
    expect(after("surge_state")).toContain("e.status = 'published'");
    expect(after("admin_hub_events")).toContain("e.status <> 'unconfirmed'");
  });
});
