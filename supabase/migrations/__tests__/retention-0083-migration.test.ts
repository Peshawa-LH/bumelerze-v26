import { functionSource, readCode, readMigration } from "../sql-test-utils";

/**
 * Static checks of migration 0083 (security checklist A2.2; audit PRIV-03,
 * PRIV-05, PRIV-06, DB-09): retention and deletion. Exercised against
 * PGlite when it was written (live order 0001-0075, 0077-0082, then 0083
 * twice; 50 checks): deleting an account queues its avatar, felt-photo and
 * feedback-photo folders and the file of every photo row of its reports and
 * feedback (also one a guest uploaded before a handover), keeps the reports
 * and feedback without account, contact or install id and the reports at
 * 0.01 degrees; felt locations are stored at 0.001 degrees, old rows once;
 * the nightly purge removes reports withdrawn over 30 days ago, feedback
 * over a year old, launch counts over 13 months old and guests unused for
 * 90 days that hold nothing, and keeps every guest with a report,
 * feedback, a recent session, a recent daily record or a stored file; the
 * queue is closed to clients; and 0076 applies after it unchanged.
 */
const FILE = "0083_retention.sql";
const raw = readMigration(FILE);
const sql = readCode(FILE);
const line = sql.replace(/\s+/g, " ").trim();

describe("0083 can be pasted into the SQL editor as one line", () => {
  it("has no transaction statements, only full-line comments, ASCII, no question marks", () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    for (const text of sql.split("\n")) {
      expect(text).not.toContain("--");
    }
    expect(raw).not.toMatch(/[^\x00-\x7f]/);
    expect(raw).not.toContain("?");
    expect(raw.split("\n")[0]).toMatch(/^-- 0083:/);
  });

  it("is idempotent", () => {
    expect(sql).toContain("create table if not exists public.storage_purge (");
    expect(sql).toContain(
      "drop trigger if exists felt_photos_after_delete on public.felt_photos;",
    );
    expect(sql).toContain(
      "drop trigger if exists feedback_photos_after_delete on public.feedback_photos;",
    );
    expect(sql).toContain(
      "drop trigger if exists felt_reports_round_location on public.felt_reports;",
    );
    expect(line).toContain(
      "if exists (select 1 from cron.job where jobname = 'purge_retention') then perform cron.unschedule('purge_retention');",
    );
    expect(line).toContain("on conflict (bucket_id, object_path) do nothing");
    expect(sql).not.toMatch(/create function /i);
  });
});

describe("the storage queue", () => {
  it("holds only the three photo buckets and uuid folders or files in them, for service_role only", () => {
    expect(line).toContain(
      "check (bucket_id in ('avatars', 'felt-photos', 'feedback-photos'))",
    );
    expect(line).toContain(
      "revoke all on public.storage_purge from public, anon, authenticated;",
    );
    expect(line).toContain(
      "grant select, delete on public.storage_purge to service_role;",
    );
    expect(line).toContain("alter table public.storage_purge enable row level security;");
  });

  it("queues the file of every deleted felt or feedback photo row, never raising", () => {
    const queue = functionSource(sql, "queue_storage_purge");
    expect(queue).not.toContain("raise");
    expect(line).toContain(
      "perform public.queue_storage_purge('felt-photos', old.storage_path);",
    );
    expect(line).toContain(
      "perform public.queue_storage_purge('feedback-photos', old.storage_path);",
    );
    expect(line).toContain("after delete on public.felt_photos for each row");
    expect(line).toContain("after delete on public.feedback_photos for each row");
  });
});

describe("delete my account", () => {
  const body = functionSource(sql, "delete_my_account").replace(/\s+/g, " ");

  it("queues the account's three folders and deletes its photo rows before unlinking", () => {
    for (const bucket of ["avatars", "felt-photos", "feedback-photos"]) {
      expect(body).toContain(
        `perform public.queue_storage_purge('${bucket}', v_uid::text);`,
      );
    }
    expect(body.indexOf("delete from public.felt_photos")).toBeLessThan(
      body.indexOf("update public.felt_reports"),
    );
    expect(body.indexOf("delete from public.feedback_photos")).toBeLessThan(
      body.indexOf("update public.feedback"),
    );
  });

  it("keeps reports and feedback without account, contact or install, reports at 0.01 degrees", () => {
    expect(body).toContain(
      "device_id = 'deleted-' || left(encode(sha256(convert_to(v_salt || device_id, 'UTF8')), 'hex'), 32)",
    );
    expect(body).toContain("lat = round(lat::numeric, 2)::double precision");
    expect(body).toContain("lon = round(lon::numeric, 2)::double precision");
    expect(body).toContain("set user_id = null, contact = null,");
    expect(body).toContain("v_salt text := gen_random_uuid()::text;");
  });

  it("still refuses a guest and keeps the 0056 steps", () => {
    expect(body).toContain(
      "raise exception 'delete_my_account: no account to delete' using errcode = '42501';",
    );
    expect(body).toContain("delete from public.home_tags where tag_id = any (v_tags);");
    expect(body).toContain(
      "delete from public.moderation_evidence where author_id = v_uid;",
    );
    expect(body).toContain("delete from auth.users where id = v_uid;");
    expect(line).toContain(
      "grant execute on function public.delete_my_account() to authenticated;",
    );
  });
});

describe("felt report locations", () => {
  it("are rounded to 0.001 degrees on every insert or change, and once for old rows", () => {
    expect(line).toContain("new.lat := round(new.lat::numeric, 3)::double precision;");
    expect(line).toContain("before insert or update of lat, lon on public.felt_reports");
    expect(line).toContain(
      "update public.felt_reports set lat = round(lat::numeric, 3)::double precision, lon = round(lon::numeric, 3)::double precision",
    );
  });
});

describe("nightly retention", () => {
  const body = functionSource(sql, "purge_retention").replace(/\s+/g, " ");

  it("uses the periods the privacy policy states", () => {
    expect(body).toContain("withdrawn_at < now() - interval '30 days'");
    expect(body).toContain(
      "delete from public.feedback where created_at < now() - interval '1 year';",
    );
    expect(body).toContain(
      "delete from public.telemetry_pings where created_at < now() - interval '13 months';",
    );
    expect(body).toContain("'90 days'");
  });

  it("removes only guests, with no row in any table pointing at auth.users and no stored file", () => {
    expect(body).toContain("where u.is_anonymous");
    expect(body).toContain("c.confrelid = 'auth.users'::regclass");
    expect(body).toContain(
      "c.conrelid not in ('public.app_presence'::regclass, 'public.device_handovers'::regclass)",
    );
    expect(body).toContain("select 1 from storage.objects o");
    expect(body).toContain(
      "delete from auth.users where id = any (v_ids) and is_anonymous;",
    );
    expect(body).toContain("limit 500");
  });

  it("runs nightly at 04:05, before the 04:15 file purge, and only from the job", () => {
    expect(line).toContain(
      "perform cron.schedule('purge_retention', '5 4 * * *', $cron$select public.purge_retention();$cron$);",
    );
    expect(line).toContain(
      "revoke all on function public.purge_retention() from public, anon, authenticated;",
    );
  });
});

describe("the check at the end", () => {
  it("refuses to finish when a piece is missing", () => {
    expect(line).toContain("raise exception '0083: not in place: %'");
  });
});
