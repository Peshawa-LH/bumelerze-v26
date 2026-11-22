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
 * Static checks of migration 0079 (security audit DB-03: the install's device
 * id worked as a password for a guest's felt reports, comments and feedback).
 * Pasted into the SQL editor as one line, so the paste rules are pinned; so are
 * the promises: a guest's rows move into an account only with a one-time token
 * the guest session prepared (stored as its sha256, 10 minutes, once), a report
 * belongs to its session only (the device id is ignored), and the old
 * device-id claim cannot be run by any client. The behaviour was exercised
 * against a real Postgres (PGlite, live order: 0001-0075 without 0041, 0077,
 * 0078, then 0079 twice in its one-line form, 76 checks: only a guest session
 * prepares and only a real account claims (42501 otherwise, also when the JWT
 * and the user row disagree), a token is 64 lowercase hex and only its hash is
 * stored, a newer prepare replaces the older token, old expired rows are
 * cleared, malformed / unknown / expired / used / replaced tokens return 0,
 * a claim moves the guest's reports, comments and feedback (details and photos
 * follow by id) and nobody else's, a guest that became an account keeps its
 * rows, a deleted guest takes its tokens along, the table and
 * claim_device_reports answer 42501 to clients, owns_felt_report is false on a
 * device-id-only match and withdraw / restore / details still work for the
 * owner's session, felt_comments.device_id stays closed, the end-of-paste check
 * bites, 0076 applies cleanly after 0079, and 0079 without 0077 fails the
 * whole paste and leaves nothing; the 0073, 0074, 0076, 0077 and 0078 suites
 * again on chains ending in 0079) when it was written; these keep it from
 * being edited away.
 */
const FILE = "0079_device_handover.sql";
const raw = readMigration(FILE);
const sql = readCode(FILE);

/** Whitespace collapsed, as the one-line paste does. */
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

/** `create or replace function public.<name>(...) ... as $$ ... $$`. */
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

/** Migration files in apply order (0041 is parked). */
function migrationFiles(): string[] {
  return readdirSync(join(__dirname, ".."))
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && !f.startsWith("0041_"))
    .sort();
}

/** The last definition of a function in the files before 0079. */
function latestBefore(name: string): { file: string; text: string } {
  let found: { file: string; text: string } | null = null;
  for (const file of migrationFiles().filter((f) => f < FILE)) {
    const code = readCode(file);
    if (
      new RegExp(`create or replace function public\\.${name}\\s*\\(`, "i").test(code)
    ) {
      found = { file, text: flat(fnText(code, name)) };
    }
  }
  if (!found) {
    throw new Error(`function ${name} not defined before ${FILE}`);
  }
  return found;
}

/** The one-line form the SQL editor receives. */
const line = flat(sql);

describe("0079 can be pasted into the SQL editor as one line", () => {
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
    expect(raw.split("\n")[0]).toMatch(/^-- 0079:/);
  });

  it("is idempotent", () => {
    expect(createdTables(sql)).toEqual(["device_handovers"]);
    expect(sql).toContain("create table if not exists public.device_handovers (");
    expect(sql).toContain(
      "create index if not exists device_handovers_guest_uid_idx on public.device_handovers (guest_uid);",
    );
    expect(sql).not.toMatch(/create function/i);
    expect(sql).not.toMatch(/create (unique )?index (?!if not exists)/i);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/create trigger/i);
    expect(sql).not.toMatch(/drop (table|function)/i);
  });

  it("defines two new functions and redefines owns_felt_report, nothing else", () => {
    expect(createdFunctions(sql).sort()).toEqual([
      "claim_device_handover",
      "owns_felt_report",
      "prepare_device_handover",
    ]);
    const earlier = migrationFiles()
      .filter((f) => f < FILE)
      .map((f) => stripComments(readMigration(f)));
    for (const name of ["claim_device_handover", "prepare_device_handover"]) {
      for (const code of earlier) {
        expect(code).not.toMatch(
          new RegExp(`create or replace function public\\.${name}\\s*\\(`, "i"),
        );
      }
    }
  });
});

describe("1. device_handovers: hashed one-time tokens, closed to clients", () => {
  it("has exactly the contract's columns, the hash as key, the guest following auth.users", () => {
    const start = line.indexOf("create table if not exists public.device_handovers (");
    const table = line.slice(start, line.indexOf(");", start) + 2);
    expect(table).toBe(
      "create table if not exists public.device_handovers ( token_hash bytea primary key, guest_uid uuid not null references auth.users (id) on delete cascade, created_at timestamptz not null default now(), expires_at timestamptz not null, used_at timestamptz, constraint device_handovers_hash_length check (octet_length(token_hash) = 32) );",
    );
  });

  it("RLS on, no policies, every privilege revoked from the client roles", () => {
    expect(sql).toContain(
      "alter table public.device_handovers enable row level security;",
    );
    expect(sql).toContain(
      "revoke all on public.device_handovers from public, anon, authenticated;",
    );
    expect(sql).not.toMatch(/grant [^;]* on public\.device_handovers/i);
  });
});

describe("2. prepare_device_handover: the guest session asks for a token", () => {
  const body = fn("prepare_device_handover");

  it("is security definer with a fixed search_path and returns text", () => {
    expect(body).toContain(
      "create or replace function public.prepare_device_handover() returns text language plpgsql volatile security definer set search_path = public, pg_temp as $$",
    );
  });

  it("refuses anything but an anonymous session, by its JWT and by its user row (42501)", () => {
    expect(body).toContain(
      "if v_uid is null or not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) or not exists (select 1 from auth.users u where u.id = v_uid and u.is_anonymous) then raise exception 'prepare_device_handover: guest_only' using errcode = '42501';",
    );
  });

  it("replaces the guest's older tokens and clears rows expired more than a day ago", () => {
    expect(body).toContain(
      "delete from public.device_handovers h where h.guest_uid = v_uid or h.expires_at < now() - interval '1 day';",
    );
  });

  it("makes 32 random bytes as 64 hex characters and stores only their sha256, for 10 minutes", () => {
    expect(body).toContain("v_token := encode(extensions.gen_random_bytes(32), 'hex');");
    expect(body).toContain(
      "values (sha256(convert_to(v_token, 'UTF8')), v_uid, now(), now() + interval '10 minutes'); return v_token;",
    );
    // the token itself is never written anywhere
    expect(body.match(/insert into/g)).toHaveLength(1);
  });

  it("runs for authenticated only", () => {
    expect(sql).toContain(
      "revoke all on function public.prepare_device_handover() from public, anon;",
    );
    expect(sql).toContain(
      "grant execute on function public.prepare_device_handover() to authenticated;",
    );
  });
});

describe("3. claim_device_handover: the account takes the guest's rows with the token", () => {
  const body = fn("claim_device_handover");

  it("is security definer with a fixed search_path and returns integer", () => {
    expect(body).toContain(
      "create or replace function public.claim_device_handover(p_token text) returns integer language plpgsql volatile security definer set search_path = public, pg_temp as $$",
    );
  });

  it("refuses anything but a real account (42501), by its JWT and by its user row", () => {
    expect(body).toContain(
      "if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) or not exists (select 1 from auth.users u where u.id = v_uid and not u.is_anonymous) then raise exception 'claim_device_handover: sign in with an account first' using errcode = '42501';",
    );
  });

  it("answers 0 without an error for a malformed, unknown, expired or used token", () => {
    expect(body).toContain("v_token text := lower(btrim(p_token));");
    expect(body).toContain(
      "if v_token is null or v_token !~ '^[0-9a-f]{64}$' then return 0; end if;",
    );
    expect(body).toContain(
      "select h.guest_uid into v_guest from public.device_handovers h where h.token_hash = v_hash and h.used_at is null and h.expires_at > now() for update; if not found then return 0; end if;",
    );
    expect(body).not.toMatch(/raise exception '[^']*(token|expired|used)/);
  });

  it("burns the token before anything moves, and moves nothing for a guest that is no longer one", () => {
    expect(body).toContain(
      "update public.device_handovers set used_at = now() where token_hash = v_hash; if v_guest = v_uid or not exists (select 1 from auth.users u where u.id = v_guest and u.is_anonymous) then return 0; end if;",
    );
  });

  it("moves the guest's felt reports, felt comments and feedback (the three tables of 0035) by user, never by device id", () => {
    expect(body).toContain(
      "update public.felt_reports fr set user_id = v_uid, withdrawn_by = case when fr.withdrawn_by = v_guest then v_uid else fr.withdrawn_by end where fr.user_id = v_guest;",
    );
    expect(body).toContain(
      "update public.felt_comments fc set user_id = v_uid where fc.user_id = v_guest;",
    );
    expect(body).toContain(
      "update public.feedback f set user_id = v_uid where f.user_id = v_guest;",
    );
    expect(body).not.toContain("device_id");
    expect(body.match(/get diagnostics k = row_count; n := n \+ k;/g)).toHaveLength(3);
    expect(body).toMatch(/return n; end \$\$$/);
  });

  it("runs for authenticated only", () => {
    expect(sql).toContain(
      "revoke all on function public.claim_device_handover(text) from public, anon;",
    );
    expect(sql).toContain(
      "grant execute on function public.claim_device_handover(text) to authenticated;",
    );
  });
});

describe("4. owns_felt_report: a report belongs to its session only", () => {
  const before = latestBefore("owns_felt_report");
  const after = fn("owns_felt_report");

  it("builds on the live definition (0064)", () => {
    expect(before.file).toBe("0064_share_safe_withdraw.sql");
    expect(before.text).toContain(
      "or (p_device_id is not null and char_length(p_device_id) >= 8 and r.device_id = p_device_id)",
    );
  });

  it("keeps the signature, language, security and search_path; the device id branch is gone", () => {
    const head =
      "create or replace function public.owns_felt_report(p_report_id uuid, p_device_id text) returns boolean language sql stable security definer set search_path = public, pg_temp as $$";
    expect(before.text.startsWith(head)).toBe(true);
    expect(after).toBe(
      `${head} select exists ( select 1 from public.felt_reports r where r.report_id = p_report_id and auth.uid() is not null and r.user_id = auth.uid() ) $$`,
    );
  });

  it("stays internal", () => {
    expect(sql).toContain(
      "revoke all on function public.owns_felt_report(uuid, text) from public, anon, authenticated;",
    );
    expect(sql).not.toMatch(/grant [^;]* function public\.owns_felt_report/i);
  });

  it("its three callers are not changed here and still ask it with the report and the (ignored) device id", () => {
    for (const name of [
      "withdraw_felt_report",
      "restore_felt_report",
      "submit_felt_report_details",
    ]) {
      expect(sql).not.toMatch(
        new RegExp(`create or replace function public\\.${name}\\s*\\(`, "i"),
      );
      expect(latestBefore(name).text).toContain(
        "if p_report_id is null or not public.owns_felt_report(p_report_id, p_device_id) then",
      );
    }
  });
});

describe("5. claim_device_reports is switched off, kept for a one-grant rollback", () => {
  it("execute is revoked from every client role and the function is not dropped or changed", () => {
    expect(sql).toContain(
      "revoke all on function public.claim_device_reports(text) from public, anon, authenticated;",
    );
    expect(sql).not.toMatch(
      /create or replace function public\.claim_device_reports\s*\(/i,
    );
    expect(sql).not.toMatch(/grant [^;]* function public\.claim_device_reports/i);
    expect(latestBefore("claim_device_reports").file).toBe("0035_accounts_profiles.sql");
  });

  it("the header names the rollback statement", () => {
    expect(flat(raw.replace(/^-- ?/gm, ""))).toContain(
      "grant execute on function public.claim_device_reports(text) to authenticated",
    );
  });
});

describe("the end-of-paste check", () => {
  const last = line.slice(line.lastIndexOf("do $$"));

  it("is the last statement and fails the paste when a part is missing", () => {
    expect(last).toMatch(/^do \$\$ declare v_missing text\[\] := '\{\}'::text\[\]; /);
    expect(last).toMatch(
      /raise exception '0079: not in place: %', array_to_string\(v_missing, ', '\); end if; end \$\$;$/,
    );
  });

  it("checks the table, the functions, their grants, owns_felt_report, the old claim and 0077's column grant", () => {
    for (const piece of [
      "v_all constant text := 'select, insert, update, delete, truncate, references, trigger';",
      "select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.device_handovers')",
      "exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'device_handovers')",
      "has_table_privilege('anon', 'public.device_handovers', v_all) or has_table_privilege('authenticated', 'public.device_handovers', v_all)",
      "column_name in ('token_hash', 'guest_uid', 'created_at', 'expires_at', 'used_at')",
      "and p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']",
      "has_function_privilege('anon', 'public.prepare_device_handover()', 'execute')",
      "has_function_privilege('anon', 'public.claim_device_handover(text)', 'execute')",
      "not has_function_privilege('authenticated', 'public.claim_device_handover(text)', 'execute')",
      "p.prosrc like '%r.user_id = auth.uid()%' and p.prosrc not like '%device_id%'",
      "has_function_privilege('authenticated', 'public.owns_felt_report(uuid, text)', 'execute')",
      "to_regprocedure('public.claim_device_reports(text)') is null",
      "has_function_privilege('authenticated', 'public.claim_device_reports(text)', 'execute')",
      "has_column_privilege('anon', 'public.felt_comments', 'device_id', 'select')",
      "has_column_privilege('authenticated', 'public.felt_comments', 'device_id', 'select')",
    ]) {
      expect(last).toContain(piece);
    }
  });
});
