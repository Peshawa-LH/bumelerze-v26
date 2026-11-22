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
 * Static checks of migration 0080 (security audit A2.5 and the server half of
 * A2.6: DB-08, DB-10, DB-12, LIVE-14, CI-07, APP-09). Pasted into the SQL
 * editor as one line, so the paste rules are pinned; so are the promises:
 * client roles keep only the table privileges a policy uses (SELECT also where
 * another table's policy reads the table), never TRUNCATE / REFERENCES /
 * TRIGGER / MAINTAIN, views stay read-only; home_tags loses its direct update;
 * a felt photo row is written only through submit_felt_photo, for the report's
 * own session at <uid>/<report_id>.jpg; bidi controls are stripped from user
 * text by BEFORE triggers that run first. The behaviour was exercised against
 * a real Postgres (PGlite, live order: 0001-0075 without 0041, 0077, 0078,
 * 0079, then 0080 twice in its one-line form, 58 checks: 304 privileges
 * removed and the same 50 kept as a dry run on the live database showed, no
 * privilege a policy uses lost, guests still read events, felt cells, public
 * profiles and hub comments (the comment policy reads blocks, so blocks keeps
 * SELECT), owners still send reports, feedback, profiles and details, anon
 * reads of 11 private tables and writes to 4 now answer 42501, table locks and
 * truncation refused, the photo function's 9 cases, home_tags update refused,
 * the bidi function and triggers incl. Sorani text with ZWNJ untouched, a new
 * table's stray privilege removed on a second paste, a table without row level
 * security fails the whole paste and keeps its grant) when it was written;
 * these keep it from being edited away.
 */
const FILE = "0080_grants_hygiene.sql";
const raw = readMigration(FILE);
const sql = readCode(FILE);

/** Whitespace collapsed, as the one-line paste does. */
const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const line = flat(sql);

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
const fn = (name: string) => flat(fnText(sql, name));

function migrationFiles(): string[] {
  return readdirSync(join(__dirname, ".."))
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && !f.startsWith("0041_"))
    .sort();
}

describe("0080 can be pasted into the SQL editor as one line", () => {
  it("has no transaction statements", () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });

  it("has only full-line comments", () => {
    for (const text of sql.split("\n")) {
      expect(text).not.toContain("--");
    }
  });

  it("is plain ASCII and has no question marks (editors read ? as a parameter)", () => {
    expect(raw).not.toMatch(/[^\x00-\x7f]/);
    expect(raw).not.toContain("?");
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0080:/);
  });

  it("is idempotent: no new tables, functions replaced, triggers and the policy dropped first", () => {
    expect(createdTables(sql)).toEqual([]);
    expect(sql).not.toMatch(/create function/i);
    expect(sql).not.toMatch(/drop (table|function)/i);
    expect(sql).not.toMatch(/create policy/i);
    const creates = sql.match(/create trigger aa_strip_bidi [^;]* on public\.(\w+)/gi) ?? [];
    expect(creates).toHaveLength(6);
    for (const table of ["profiles", "home_tags", "profile_posts", "post_comments", "event_comments", "felt_comments"]) {
      expect(sql).toContain(`drop trigger if exists aa_strip_bidi on public.${table};`);
    }
  });

  it("defines four new functions and no other", () => {
    expect(createdFunctions(sql).sort()).toEqual([
      "client_privilege_in_use",
      "strip_bidi_controls",
      "strip_bidi_trigger",
      "submit_felt_photo",
    ]);
    const earlier = migrationFiles()
      .filter((f) => f < FILE)
      .map((f) => stripComments(readMigration(f)));
    for (const name of createdFunctions(sql)) {
      for (const code of earlier) {
        expect(code).not.toMatch(
          new RegExp(`create or replace function public\\.${name}\\s*\\(`, "i"),
        );
      }
    }
  });
});

describe("1. client privileges: only what a policy uses", () => {
  it("revokes TRUNCATE, REFERENCES, TRIGGER and MAINTAIN everywhere, now and for future tables", () => {
    expect(sql).toContain(
      "revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated;",
    );
    expect(sql).toContain(
      "alter default privileges in schema public revoke truncate, references, trigger, maintain on tables from anon, authenticated;",
    );
  });

  it("the rule: a permissive policy for the command, SELECT also for UPDATE/DELETE policies and for tables another policy reads", () => {
    const body = fn("client_privilege_in_use");
    expect(body).toContain("returns boolean language sql stable set search_path = pg_catalog, pg_temp");
    expect(body).toContain("and p.polpermissive");
    expect(body).toContain("(p_priv = 'SELECT' and p.polcmd in ('r', 'w', 'd'))");
    expect(body).toContain("(p_priv = 'INSERT' and p.polcmd = 'a')");
    expect(body).toContain("(p_priv = 'UPDATE' and p.polcmd = 'w')");
    expect(body).toContain("(p_priv = 'DELETE' and p.polcmd = 'd')");
    expect(body).toContain(
      "or (p_priv = 'SELECT' and exists ( select 1 from pg_depend d join pg_policy q on q.oid = d.objid where d.classid = 'pg_policy'::regclass and d.refclassid = 'pg_class'::regclass and d.refobjid = p_table and q.polrelid <> p_table",
    );
    expect(line).toContain(
      "revoke all on function public.client_privilege_in_use(oid, text, text) from public, anon, authenticated;",
    );
  });

  it("revokes table privileges only on tables with row level security, by that rule", () => {
    expect(line).toContain(
      "where c.relkind in ('r', 'p') and c.relrowsecurity and has_table_privilege(ro.rolname, c.oid, pr.priv) and not public.client_privilege_in_use(c.oid, ro.rolname, pr.priv) order by 1, 2, 3 loop execute format('revoke %s on table public.%I from %I', r.priv, r.relname, r.rolname);",
    );
  });

  it("leaves views readable and makes them read-only", () => {
    expect(line).toContain(
      "where c.relkind in ('v', 'm') order by 1 loop execute format('revoke insert, update, delete on table public.%I from anon, authenticated', r.relname);",
    );
  });

  it("does not touch column grants (the public column lists of 0077)", () => {
    expect(sql).not.toMatch(/revoke [^;]*\([a-z_, ]+\) on/i);
    expect(sql).not.toMatch(/grant (select|insert|update)/i);
  });
});

describe("2. home_tags: no direct update", () => {
  it("drops the owner's update policy (the privilege then goes by rule 1)", () => {
    expect(sql).toContain("drop policy if exists home_tags_update on public.home_tags;");
  });
});

describe("3. submit_felt_photo: the report's own session, the app's one path", () => {
  const body = fn("submit_felt_photo");

  it("is security definer with a fixed search_path", () => {
    expect(body).toContain(
      "create or replace function public.submit_felt_photo(p_report_id uuid, p_storage_path text) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$",
    );
  });

  it("needs a session that owns the report, else not_found", () => {
    expect(body).toContain(
      "if v_uid is null or p_report_id is null or not public.owns_felt_report(p_report_id, null) then raise exception 'submit_felt_photo: not_found' using errcode = '22023';",
    );
  });

  it("accepts only <uid>/<report_id>.jpg, else invalid", () => {
    expect(body).toContain(
      "if p_storage_path is distinct from (v_uid::text || '/' || p_report_id::text || '.jpg') then raise exception 'submit_felt_photo: invalid' using errcode = '22023';",
    );
  });

  it("writes a pending row once and returns the existing one on a repeat", () => {
    expect(body).toContain(
      "insert into public.felt_photos (report_id, storage_path) values (p_report_id, p_storage_path) on conflict (report_id) do nothing returning photo_id into v_photo;",
    );
    expect(body).not.toMatch(/moderation_status|moderated_by|moderated_at/);
  });

  it("runs for authenticated only", () => {
    expect(sql).toContain("revoke all on function public.submit_felt_photo(uuid, text) from public, anon;");
    expect(sql).toContain("grant execute on function public.submit_felt_photo(uuid, text) to authenticated;");
  });
});

describe("4. bidi controls stripped from user text", () => {
  it("removes U+202A..U+202E and U+2066..U+2069 only, written without non-ASCII", () => {
    expect(fn("strip_bidi_controls")).toContain(
      "select regexp_replace( p_text, '[' || chr(8234) || '-' || chr(8238) || chr(8294) || '-' || chr(8297) || ']', '', 'g')",
    );
    expect(fn("strip_bidi_controls")).toContain("returns text language sql immutable parallel safe");
  });

  it("cleans each table's text columns in a BEFORE trigger that runs first (aa_)", () => {
    expect(line).toContain(
      "create trigger aa_strip_bidi before insert or update of display_name, bio, city_name on public.profiles for each row execute function public.strip_bidi_trigger();",
    );
    expect(line).toContain(
      "create trigger aa_strip_bidi before insert or update of label, unit_label on public.home_tags for each row execute function public.strip_bidi_trigger();",
    );
    for (const table of ["profile_posts", "post_comments", "event_comments", "felt_comments"]) {
      expect(line).toContain(
        `create trigger aa_strip_bidi before insert or update of body on public.${table} for each row execute function public.strip_bidi_trigger();`,
      );
    }
    expect(sql).toContain(
      "revoke all on function public.strip_bidi_trigger() from public, anon, authenticated;",
    );
  });
});

describe("6. the check at the end", () => {
  it("raises when anything is missing, so a partial paste is rolled back", () => {
    expect(line).toContain("raise exception '0080: not in place: %', array_to_string(v_missing, '; ');");
    for (const item of [
      "row level security on ",
      "privilege without policy: ",
      "public reads and own writes kept",
      "home_tags without client update",
      "client_privilege_in_use internal",
      "submit_felt_photo grants",
      "strip_bidi_controls",
      "aa_strip_bidi triggers",
    ]) {
      expect(sql).toContain(item);
    }
  });

  it("checks that guests keep the public reads, including blocks for the hub comment policy", () => {
    expect(line).toContain("or not has_table_privilege('anon', 'public.blocks', 'select')");
    expect(line).toContain("or not has_column_privilege('anon', 'public.event_comments', 'body', 'select')");
  });
});
