import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0068 (phone alerts: Expo push receipts, and a
 * phone releasing its token after a sign-out). The behaviour was exercised
 * against a real Postgres (PGlite with PostGIS: 0001-0067 then 0068 twice;
 * a test alert through the real planner, tickets, receipts ok / gone /
 * failed / pending / expired, the 5-minute hold, the run counts, the
 * release from another account, the web results of 0062 unchanged, the
 * grants) when it was written; these keep it from being edited away.
 */
const raw = readMigration("0068_phone_alert_receipts.sql");
const sql = readCode("0068_phone_alert_receipts.sql");
const fn = (name: string) => functionSource(sql, name);
const v0062 = readCode("0062_alert_sender.sql");

describe("0068 can be pasted into the SQL editor as one line", () => {
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
    expect(sql).not.toMatch(/create table/i);
    expect(sql).not.toMatch(/create (unique )?index (?!if not exists)/i);
    expect(sql).not.toMatch(/create function/i);
    expect(sql).not.toMatch(/add column (?!if not exists)/i);
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0068:/);
  });

  it("creates no table and exactly these functions, each security definer with its search path", () => {
    expect(createdTables(sql)).toEqual([]);
    expect(createdFunctions(sql).sort()).toEqual(
      [
        "alert_receipts_due",
        "alert_record_receipts",
        "alert_record_results",
        "alert_work_pending",
        "alerts_release_expo_push",
      ].sort(),
    );
    for (const name of createdFunctions(sql)) {
      expect(fn(name)).toContain("security definer");
      expect(fn(name)).toContain("set search_path = public, pg_temp");
    }
  });
});

describe("tickets and receipts", () => {
  it("adds the ticket and the due time to alert_deliveries, with an index for due receipts", () => {
    expect(sql).toContain(
      "alter table public.alert_deliveries add column if not exists expo_ticket text\n  check (expo_ticket is null or char_length(expo_ticket) <= 100);",
    );
    expect(sql).toContain("alter table public.alert_deliveries add column if not exists receipt_due_at timestamptz;");
    expect(sql).toContain(
      "create index if not exists alert_deliveries_receipt_due_idx\n  on public.alert_deliveries (receipt_due_at) where receipt_due_at is not null;",
    );
  });

  it("alert_record_results is 0062's, plus the ticket of an accepted Expo push (due in 15 minutes)", () => {
    const now = fn("alert_record_results");
    expect(now).toContain("from jsonb_to_recordset(p_results) as x(delivery_id uuid, outcome text, error text, ticket text)");
    expect(now).toContain("when r.outcome = 'sent' and r.ticket ~ '^[A-Za-z0-9_-]{1,100}$' then r.ticket");
    expect(now).toContain("receipt_due_at = case when v_ticket is not null then now() + interval '15 minutes' else d.receipt_due_at end");
    // Everything else is 0062's text, line for line.
    const added = [
      /^\s*v_ticket text;$/,
      /^\s*select x\.delivery_id, x\.outcome, x\.error, x\.ticket$/,
      /^\s*from jsonb_to_recordset\(p_results\) as x\(delivery_id uuid, outcome text, error text, ticket text\)$/,
      /^\s*v_ticket := case$/,
      /^\s*when r\.outcome = 'sent' and r\.ticket/,
      /^\s*else null$/,
      /^\s*end;$/,
      /^\s*last_error = case when r\.outcome = 'sent' then null else left\(r\.error, 300\) end,$/,
      /^\s*expo_ticket = coalesce/,
      /^\s*receipt_due_at = case when v_ticket/,
    ];
    const keep = (text: string) =>
      text
        .split("\n")
        .filter((line) => !added.some((pattern) => pattern.test(line)))
        .filter((line) => !/^\s*(select x\.delivery_id, x\.outcome, x\.error|from jsonb_to_recordset\(p_results\) as x\(delivery_id uuid, outcome text, error text\)|last_error = case when r\.outcome = 'sent' then null else left\(r\.error, 300\) end)$/.test(line))
        .join("\n");
    expect(keep(now)).toBe(keep(functionSource(v0062, "alert_record_results")));
  });

  it("hands out due tickets at most 1000 at a time, holds them 5 minutes, gives up after 23 hours", () => {
    const body = fn("alert_receipts_due");
    expect(body).toContain("v_limit integer := least(greatest(coalesce(p_limit, 300), 1), 1000);");
    expect(body).toContain("and d.sent_at < now() - interval '23 hours';");
    expect(body).toContain("for update of d skip locked");
    expect(body).toContain("set receipt_due_at = now() + interval '5 minutes'");
  });

  it("DeviceNotRegistered switches the phone off; other errors never count against it", () => {
    const body = fn("alert_record_receipts");
    expect(body).toContain("r.outcome not in ('ok', 'gone', 'failed', 'pending')");
    expect(body).toContain("set disabled_at = coalesce(disabled_at, now()), disabled_reason = 'gone',");
    expect(body).toContain("set sent = greatest(sent - 1, 0), gone = gone + 1");
    expect(body).toContain("set sent = greatest(sent - 1, 0), failed = failed + 1");
    expect(body).not.toContain("fail_count");
    expect(body).toContain("set receipt_due_at = now() + interval '15 minutes'");
    expect(body).toContain("and d.status = 'sent'");
  });

  it("alert_work_pending is 0062's, plus due receipts", () => {
    const now = fn("alert_work_pending");
    const before = functionSource(v0062, "alert_work_pending");
    const extra = "      or exists (\n           select 1 from public.alert_deliveries d\n            where d.receipt_due_at <= now()\n         )\n";
    expect(now).toContain(extra);
    expect(now.replace(extra, "")).toBe(before);
  });
});

describe("a phone releases its token", () => {
  it("anyone signed in, a valid Expo token, Expo rows only", () => {
    const body = fn("alerts_release_expo_push");
    expect(body).toContain("if auth.uid() is null then");
    expect(body).toContain("raise exception 'alerts_release_expo_push: not_signed_in' using errcode = '42501';");
    expect(body).toContain("p_token !~ '^Expo(nent){0,1}PushToken\\[[A-Za-z0-9_-]{10,100}\\]$'");
    expect(body).toContain("raise exception 'alerts_release_expo_push: token_invalid' using errcode = '22023';");
    expect(body).toContain("where ps.kind = 'expo'\n     and ps.expo_token = p_token;");
  });
});

describe("who may call what", () => {
  it("the receipt functions are the service role's only; the release is for signed-in users", () => {
    for (const signature of [
      "alert_record_results(uuid, jsonb)",
      "alert_receipts_due(integer)",
      "alert_record_receipts(jsonb)",
      "alert_work_pending()",
    ]) {
      expect(sql).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${signature} to service_role;`);
    }
    expect(sql).toContain("revoke all on function public.alerts_release_expo_push(text) from public, anon;");
    expect(sql).toContain("grant execute on function public.alerts_release_expo_push(text) to authenticated;");
    expect(sql).not.toMatch(/grant execute on function public\.alert_(receipts_due|record_receipts|record_results|work_pending)[^;]*to (anon|authenticated)/);
  });
});
