import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import {
  createdFunctions,
  createdTables,
  readCode,
  readMigration,
  stripComments,
} from "../sql-test-utils";

/**
 * Static checks of migration 0078 (security checklist A1.3, audit finding
 * DB-06: guest write and storage flooding). Pasted into the SQL editor as one
 * line, so the paste rules are pinned; so are the promises: no client write
 * without a session on feedback, feedback_photos and telemetry_pings, each row
 * tied to the session, per-session daily limits, a per-person 24-hour file
 * count in the felt-photos and feedback-photos buckets, and size caps on the
 * jsonb columns the app writes. The behaviour was exercised against a real
 * Postgres (PGlite: 0001-0077 without 0041, then 0078 twice in its one-line
 * form, 83 checks: anon refused with 42501 on the three tables, the app's own
 * rows land (feedback with and without user_id, a badge request, the photo
 * upsert that was refused before, a telemetry ping), every limit lands at N
 * and refuses N+1 with P0001 and its hint, a refused write counts nothing,
 * server callers are never counted, a review request counts as feedback, the
 * next UTC day starts afresh, the hourly purge drops old day rows, 20 felt
 * and 150 feedback files in 24 hours then 42501, older files do not count,
 * 16383 bytes of jsonb land and 16384 do not, an old oversize row never
 * blocks the paste, the end-of-paste check bites; the 0073, 0074, 0076 and
 * 0077 suites again on chains ending in 0078) when it was written; these keep
 * it from being edited away.
 */
const FILE = "0078_guest_write_limits.sql";
const raw = readMigration(FILE);
const sql = readCode(FILE);
const REPO = join(__dirname, "..", "..", "..");

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

/** The text of `create policy <name> on ... ;` in a file's code. */
function policyIn(code: string, name: string): string {
  const match = new RegExp(`create policy ${name}\\s`).exec(code);
  if (!match) {
    throw new Error(`policy ${name} not found`);
  }
  return flat(code.slice(match.index, code.indexOf(";", match.index) + 1));
}
const policy = (name: string) => policyIn(sql, name);
const earlierPolicy = (file: string, name: string) => policyIn(readCode(file), name);

/** The one-line form the SQL editor receives. */
const line = flat(sql);

describe("0078 can be pasted into the SQL editor as one line", () => {
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
    expect(raw.split("\n")[0]).toMatch(/^-- 0078:/);
  });

  it("is idempotent", () => {
    expect(createdTables(sql)).toEqual([]);
    expect(sql).not.toMatch(/create (unique )?index/i);
    expect(sql).not.toMatch(/create function/i);
    const triggers = [...sql.matchAll(/create trigger (\w+)\s+\w+[\s\S]*? on (public\.\w+)/g)];
    expect(triggers.map((m) => m[1]).sort()).toEqual([
      "feedback_fill_user",
      "feedback_photos_rate_limit",
      "feedback_rate_limit",
      "telemetry_pings_rate_limit",
    ]);
    for (const [, name, table] of triggers) {
      expect(sql).toContain(`drop trigger if exists ${name} on ${table};`);
    }
    const policies = [...sql.matchAll(/create policy (\w+)\s+on ((?:public|storage)\.\w+)/g)];
    expect(policies.map((m) => m[1]).sort()).toEqual([
      "feedback_insert",
      "feedback_photos_insert",
      "feedback_photos_select_own",
      "feedback_photos_storage_insert_own",
      "feedback_photos_update_own",
      "felt_photos_storage_insert_own",
      "telemetry_pings_insert",
    ]);
    for (const [, name, table] of policies) {
      expect(sql).toContain(`drop policy if exists ${name} on ${table};`);
    }
    const constraints = [...sql.matchAll(/alter table (public\.\w+)\s+add constraint (\w+)/g)];
    expect(constraints.map((m) => m[2]).sort()).toEqual([
      "felt_report_details_raw_answers_size",
      "home_assessments_json_size",
      "home_surveys_answers_size",
      "write_rate_counters_window_kind_check",
    ]);
    for (const [, table, name] of constraints) {
      if (name === "write_rate_counters_window_kind_check") {
        // dropped by the loop over every window_kind check, whatever its name
        expect(line).toContain(
          "where conrelid = 'public.write_rate_counters'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%window_kind%' loop execute format('alter table public.write_rate_counters drop constraint %I', c.conname);",
        );
      } else {
        expect(sql).toContain(`alter table ${table} drop constraint if exists ${name};`);
      }
    }
  });

  it("defines exactly four new functions, none of them defined before", () => {
    const names = createdFunctions(sql).sort();
    expect(names).toEqual([
      "client_daily_write_limit",
      "feedback_fill_user",
      "my_recent_upload_count",
      "write_rate_take_day",
    ]);
    const earlier = readdirSync(join(__dirname, ".."))
      .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f < FILE)
      .map((f) => stripComments(readMigration(f)));
    for (const name of names) {
      for (const code of earlier) {
        expect(code).not.toMatch(
          new RegExp(`create or replace function public\\.${name}\\s*\\(`, "i"),
        );
      }
    }
  });
});

describe("1. every client write needs a session and carries it", () => {
  it("anon loses every write privilege on the three tables; authenticated keeps only what the app uses", () => {
    expect(line).toContain(
      "revoke insert, update, delete, truncate, references, trigger on public.feedback, public.feedback_photos, public.telemetry_pings from anon;",
    );
    expect(line).toContain(
      "revoke update, delete, truncate, references, trigger on public.feedback, public.telemetry_pings from authenticated;",
    );
    // the app upserts photo rows: an upsert needs INSERT and UPDATE
    expect(line).toContain(
      "revoke delete, truncate, references, trigger on public.feedback_photos from authenticated;",
    );
    expect(sql).not.toMatch(/grant [^;]* to anon/);
  });

  it("feedback_insert is 0033's, for authenticated only, with the caller's own user_id", () => {
    const old = earlierPolicy("0033_security_hardening.sql", "feedback_insert");
    expect(policy("feedback_insert")).toBe(
      old
        .replace("to anon, authenticated", "to authenticated")
        .replace("(user_id is null or user_id = auth.uid())", "user_id = auth.uid()"),
    );
  });

  it("a null user_id is filled from the session before the policy check (as 0073 does for felt comments)", () => {
    const body = fn("feedback_fill_user");
    expect(body).toContain("if new.user_id is null and v_uid is not null then new.user_id := v_uid;");
    expect(body).not.toContain("security definer");
    expect(line).toContain(
      "create trigger feedback_fill_user before insert on public.feedback for each row execute function public.feedback_fill_user();",
    );
    expect(sql).toContain(
      "revoke all on function public.feedback_fill_user() from public, anon, authenticated;",
    );
  });

  it("feedback_photos: rows point into the caller's own folder; read and update only those", () => {
    const own = "split_part(storage_path, '/', 1) = auth.uid()::text";
    expect(policy("feedback_photos_insert")).toBe(
      `create policy feedback_photos_insert on public.feedback_photos for insert to authenticated with check (${own});`,
    );
    expect(policy("feedback_photos_select_own")).toBe(
      `create policy feedback_photos_select_own on public.feedback_photos for select to authenticated using (${own});`,
    );
    expect(policy("feedback_photos_update_own")).toBe(
      `create policy feedback_photos_update_own on public.feedback_photos for update to authenticated using (${own}) with check (${own});`,
    );
    expect(earlierPolicy("0020_feedback.sql", "feedback_photos_insert")).toContain(
      "with check (true)",
    );
  });

  it("the app's photo path starts with the session's folder", () => {
    const transport = readFileSync(
      join(REPO, "src/features/feedback/supabase-transport.ts"),
      "utf8",
    );
    expect(transport).toMatch(/\$\{userId\}\/\$\{submission\.feedbackId\}\/\$\{photo\.photoId\}\.jpg/);
  });

  it("telemetry_pings: a session is required, and the table still holds nothing about the person", () => {
    expect(policy("telemetry_pings_insert")).toBe(
      "create policy telemetry_pings_insert on public.telemetry_pings for insert to authenticated with check (auth.uid() is not null);",
    );
    expect(sql).not.toMatch(/alter table public\.telemetry_pings/);
  });
});

describe("2. per-session daily limits", () => {
  it("write_rate_counters (0071) gains a 'day' window", () => {
    expect(line).toContain(
      "alter table public.write_rate_counters add constraint write_rate_counters_window_kind_check check (window_kind in ('minute', 'hour', 'day'));",
    );
  });

  it("write_rate_take_day counts in the current UTC day, server only, like 0071's write_rate_take", () => {
    const body = fn("write_rate_take_day");
    expect(body).toContain("security definer set search_path = public, pg_temp");
    expect(body).toContain(
      "values (p_bucket, 'day', date_trunc('day', now(), 'UTC'), 1) on conflict (bucket, window_kind, window_start) do update set hits = c.hits + 1 returning c.hits into v_day; return v_day <= p_per_day;",
    );
    expect(sql).toContain(
      "revoke all on function public.write_rate_take_day(text, integer) from public, anon, authenticated;",
    );
  });

  it("the trigger counts app callers only, by an md5 of the session, and refuses in 0071's style", () => {
    const body = fn("client_daily_write_limit");
    expect(body).toContain("security definer set search_path = public, pg_temp");
    expect(body).toContain("if not public.request_is_client() then return new; end if;");
    expect(body).toContain("v_limit := tg_argv[0]::integer;");
    expect(body).toContain("'u:' || md5(v_uid::text)");
    expect(body).toContain(
      "if not public.write_rate_take_day(tg_table_name || ':' || v_caller, v_limit) then raise exception '%: rate_limited', tg_table_name using errcode = 'P0001', hint = format('At most %s a day from one device.', v_limit);",
    );
    expect(sql).toContain(
      "revoke all on function public.client_daily_write_limit() from public, anon, authenticated;",
    );
  });

  it("limits: feedback 30, feedback_photos 150, telemetry_pings 50 a day", () => {
    for (const [table, limit] of [
      ["feedback", "30"],
      ["feedback_photos", "150"],
      ["telemetry_pings", "50"],
    ]) {
      expect(line).toContain(
        `create trigger ${table}_rate_limit before insert on public.${table} for each row execute function public.client_daily_write_limit('${limit}');`,
      );
    }
  });

  it("the photo limits follow the form's own cap: 5 photos per message, times 30 messages", () => {
    const queue = readFileSync(join(REPO, "src/features/feedback/queue.ts"), "utf8");
    const perMessage = Number(/FEEDBACK_PHOTO_MAX_COUNT = (\d+)/.exec(queue)?.[1]);
    expect(perMessage).toBe(5);
    const messages = Number(
      /public\.feedback for each row execute function public\.client_daily_write_limit\('(\d+)'\)/.exec(line)?.[1],
    );
    expect(messages).toBe(30);
    expect(line).toContain(`client_daily_write_limit('${perMessage * messages}')`);
    expect(line).toContain(`my_recent_upload_count('feedback-photos') < ${perMessage * messages}`);
  });
});

describe("3. storage: files per person per bucket in the last 24 hours", () => {
  it("my_recent_upload_count counts the caller's own folder only (the home_photo_count pattern of 0042)", () => {
    const body = fn("my_recent_upload_count");
    expect(body).toContain("returns integer language sql stable security definer set search_path = public, storage, pg_temp");
    expect(body).toContain(
      "where o.bucket_id = p_bucket and o.name like auth.uid()::text || '/%' and o.created_at > now() - interval '1 day'",
    );
    expect(sql).toContain(
      "revoke all on function public.my_recent_upload_count(text) from public, anon;",
    );
    expect(sql).toContain(
      "grant execute on function public.my_recent_upload_count(text) to authenticated;",
    );
  });

  it("felt-photos: 0016's insert policy plus fewer than 20 files a day", () => {
    const old = earlierPolicy("0016_felt_photos_storage.sql", "felt_photos_storage_insert_own");
    expect(policy("felt_photos_storage_insert_own")).toBe(
      old.replace(" );", " and public.my_recent_upload_count('felt-photos') < 20 );"),
    );
  });

  it("feedback-photos: 0020's insert policy plus fewer than 150 files a day", () => {
    const old = earlierPolicy("0020_feedback.sql", "feedback_photos_storage_insert_own");
    expect(policy("feedback_photos_storage_insert_own")).toBe(
      old.replace(" );", " and public.my_recent_upload_count('feedback-photos') < 150 );"),
    );
  });

  it("the update policies of both buckets are left as they were (a re-upload adds no file)", () => {
    expect(sql).not.toMatch(/storage_update_own/);
  });
});

describe("4. jsonb size caps", () => {
  it("every jsonb column the app writes is capped below 16384 bytes, NOT VALID first", () => {
    expect(line).toContain(
      "alter table public.felt_report_details add constraint felt_report_details_raw_answers_size check (octet_length(raw_answers::text) < 16384) not valid;",
    );
    expect(line).toContain(
      "alter table public.home_surveys add constraint home_surveys_answers_size check (octet_length(answers::text) < 16384) not valid;",
    );
    expect(line).toContain(
      "alter table public.home_assessments add constraint home_assessments_json_size check ( octet_length(ims_type_probs::text) < 16384 and octet_length(vc_probs::text) < 16384 and (hazard is null or octet_length(hazard::text) < 16384) ) not valid;",
    );
  });

  it("old rows are validated where they fit; a larger old row only leaves a notice", () => {
    for (const [table, name] of [
      ["felt_report_details", "felt_report_details_raw_answers_size"],
      ["home_surveys", "home_surveys_answers_size"],
      ["home_assessments", "home_assessments_json_size"],
    ]) {
      expect(line).toContain(
        `begin alter table public.${table} validate constraint ${name}; exception when check_violation then raise notice`,
      );
    }
  });
});

describe("the end-of-paste check", () => {
  const last = line.slice(line.lastIndexOf("do $$"));

  it("is the last statement and fails the paste when a part is missing", () => {
    expect(last).toMatch(/^do \$\$ declare v_missing text\[\] := '\{\}'::text\[\]; begin /);
    expect(last).toMatch(
      /raise exception '0078: not in place: %', array_to_string\(v_missing, ', '\); end if; end \$\$;$/,
    );
  });

  it("checks the grants, the policies, the triggers, the day window, the storage counts and the caps", () => {
    for (const piece of [
      "has_table_privilege('anon', 'public.feedback', 'insert')",
      "has_table_privilege('anon', 'public.feedback_photos', 'insert')",
      "has_table_privilege('anon', 'public.telemetry_pings', 'insert')",
      "not has_table_privilege('authenticated', 'public.feedback_photos', 'update')",
      "policyname = 'feedback_insert' and roles = '{authenticated}' and with_check like '%user_id = auth.uid()%' and with_check not like '%user_id IS NULL%'",
      "policyname in ('feedback_photos_select_own', 'feedback_photos_update_own')",
      "policyname = 'telemetry_pings_insert' and roles = '{authenticated}'",
      "('public.feedback'::regclass, 'feedback_rate_limit')",
      "('public.telemetry_pings'::regclass, 'telemetry_pings_rate_limit')",
      "conname = 'write_rate_counters_window_kind_check' and pg_get_constraintdef(oid) like '%day%'",
      "has_function_privilege('authenticated', 'public.write_rate_take_day(text, integer)', 'execute')",
      "with_check like '%my_recent_upload_count(%felt-photos%) < 20%'",
      "with_check like '%my_recent_upload_count(%feedback-photos%) < 150%'",
      "('public.home_assessments'::regclass, 'home_assessments_json_size')",
    ]) {
      expect(last).toContain(piece);
    }
  });
});
