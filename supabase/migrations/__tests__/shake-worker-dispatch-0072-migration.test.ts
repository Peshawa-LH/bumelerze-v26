import { readFileSync } from "fs";
import { join } from "path";

import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0072 (the registry starts the SHAKEmap worker
 * through GitHub's workflow_dispatch; supersedes the parked 0041). Pasted
 * into the SQL editor as one line, so the paste rules are pinned; so are the
 * promises: the worker's own trigger policy and revision thresholds, one
 * start per 3 minutes at most and a growing pause after failures, the token
 * read from Vault and never stored, nothing at all without the token,
 * nothing callable by the app, the admin card built on the 0070 body. The
 * behaviour was exercised against a real Postgres (PGlite: 0001-0071 then
 * 0072 twice, 81 checks; the 0071, 0070 and 0068 proofs again on top) when
 * it was written; these keep it from being edited away.
 */
const raw = readMigration("0072_shake_worker_dispatch.sql");
const sql = readCode("0072_shake_worker_dispatch.sql");
const fn = (name: string) => functionSource(sql, name);
const workflow = (() => {
  try {
    return readFileSync(
      join(__dirname, "../../../../bumelerze-atlas/.github/workflows/shake-worker.yml"),
      "utf8",
    );
  } catch {
    return null;
  }
})();

describe("0072 can be pasted into the SQL editor as one line", () => {
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
    expect(sql).toContain(
      "insert into public.worker_dispatch_state (id) values (1) on conflict (id) do nothing;",
    );
    expect(sql).toContain(
      "drop trigger if exists events_request_shake_worker on public.events;",
    );
    expect(sql).toContain(
      "if exists (select 1 from cron.job where cron.job.jobname = 'dispatch_shake_worker') then",
    );
  });

  it("documents itself, the owner's token steps included", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0072:/);
    expect(raw).toContain("Supersedes the parked 0041");
    for (const step of [
      "Fine-grained tokens",
      "Only select repositories -> bumelerze-atlas.",
      "Actions: Read and write.",
      "Name: github_dispatch_token.",
    ]) {
      expect(raw).toContain(step);
    }
  });
});

describe("state and functions stay on the server", () => {
  it("one table, RLS on, no client grant, no policy", () => {
    expect(createdTables(sql)).toEqual(["worker_dispatch_state"]);
    expect(sql).toContain(
      "alter table public.worker_dispatch_state enable row level security;",
    );
    expect(sql).toContain(
      "revoke all on public.worker_dispatch_state from public, anon, authenticated;",
    );
    expect(sql).not.toMatch(/create policy/);
  });

  it("creates exactly these functions; only the admin card is callable by an account", () => {
    expect(createdFunctions(sql).sort()).toEqual(
      [
        "admin_source_status",
        "dispatch_shake_worker",
        "events_request_shake_worker",
        "request_shake_worker",
        "shake_dispatch_token_set",
        "shake_worker_wanted",
      ].sort(),
    );
    for (const name of [
      "dispatch_shake_worker",
      "events_request_shake_worker",
      "request_shake_worker",
      "shake_dispatch_token_set",
    ]) {
      expect(fn(name)).toContain("security definer");
      expect(fn(name)).toContain("set search_path = public, pg_temp");
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`,
        ),
      );
    }
    expect(
      [...sql.matchAll(/grant execute on function public\.(\w+)/g)].map((m) => m[1]),
    ).toEqual(["admin_source_status"]);
  });
});

describe("which events start the worker", () => {
  it("mirrors the worker's trigger policy (Iraq, or a footprint reaching the Kurdistan box)", () => {
    const body = fn("shake_worker_wanted");
    expect(body).toContain(
      "(p_lat between 29.0 and 37.5 and p_lon between 38.8 and 48.8)",
    );
    expect(body).toContain("least(greatest(p_lat, 33.0), 38.5)");
    expect(body).toContain("least(greatest(p_lon, 41.0), 48.5)");
    expect(body).toContain("when coalesce(p_magnitude, 0) >= 6.5 then 300");
    expect(body).toContain("when coalesce(p_magnitude, 0) >= 5.0 then 200");
    expect(body).toContain("else 100");
  });

  it("only published, unmerged, undeleted events of the last 14 days", () => {
    const body = fn("events_request_shake_worker");
    expect(body).toContain("if new.status is distinct from 'published'");
    expect(body).toContain("or new.merged_into is not null");
    expect(body).toContain("or new.review_status = 'deleted'");
    expect(body).toContain("or new.origin_time < now() - interval '14 days'");
    expect(body).toContain(
      "or not public.shake_worker_wanted(new.lat, new.lon, new.magnitude) then",
    );
  });

  it("new, newly mapped, or revised by the worker's thresholds", () => {
    const body = fn("events_request_shake_worker");
    expect(body).toContain("perform public.request_shake_worker('new ' || v_key);");
    expect(body).toContain(
      "perform public.request_shake_worker('now mapped ' || v_key);",
    );
    expect(body).toContain(
      "elsif abs(coalesce(new.magnitude, 0) - coalesce(old.magnitude, 0)) >= 0.1",
    );
    expect(body).toContain(
      "or public.alert_distance_km(old.lat, old.lon, new.lat, new.lon) >= 5",
    );
    expect(body).toContain(">= greatest(5, 0.25 * abs(coalesce(old.depth_km, 0))) then");
    expect(sql).toContain(
      "after insert or update of magnitude, lat, lon, depth_km, status, merged_into, review_status\n  on public.events",
    );
  });

  it("a burst of revisions writes the state row once", () => {
    expect(fn("request_shake_worker")).toContain("where id = 1\n     and not pending;");
  });
});

describe("the dispatcher", () => {
  it("starts shake-worker.yml in bumelerze-atlas on main through pg_net", () => {
    const body = fn("dispatch_shake_worker");
    expect(body).toContain(
      "url := 'https://api.github.com/repos/Peshawa-LH/bumelerze-atlas/actions/workflows/shake-worker.yml/dispatches',",
    );
    expect(body).toContain("body := jsonb_build_object('ref', 'main'),");
    expect(body).toContain("'X-GitHub-Api-Version', '2022-11-28',");
    expect(body).toContain("timeout_milliseconds := 10000");
  });

  it("reads the token from Vault, never writes it anywhere", () => {
    const body = fn("dispatch_shake_worker");
    expect(body).toContain(
      "from vault.decrypted_secrets ds\n     where ds.name = 'github_dispatch_token'",
    );
    expect(body).toContain("'Authorization', 'Bearer ' || v_token,");
    // used only to read it, test it and build the header: never stored or returned
    const uses = body.split("\n").filter((line) => line.includes("v_token"));
    expect(uses.map((line) => line.trim())).toEqual([
      "v_token text;",
      "v_token := null;",
      "select btrim(ds.decrypted_secret) into v_token",
      "v_token := null;",
      "if v_token is null or v_token = '' then",
      "'Authorization', 'Bearer ' || v_token,",
    ]);
    expect(raw).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/);
  });

  it("without a token: records it once and sends nothing", () => {
    const body = fn("dispatch_shake_worker");
    const noToken = body.indexOf("if v_token is null or v_token = '' then");
    const post = body.indexOf("select net.http_post(");
    expect(noToken).toBeGreaterThan(0);
    expect(noToken).toBeLessThan(post);
    expect(body).toContain("if s.last_outcome is distinct from 'no_token' then");
    expect(body.slice(noToken, post)).toContain("return 'no token';");
  });

  it("at most one start per 3 minutes, a growing pause after failures (at most 6 hours)", () => {
    const body = fn("dispatch_shake_worker");
    expect(body).toContain("when s.failures = 0 then interval '3 minutes'");
    expect(body).toContain(
      "else least(interval '3 minutes' * power(2, least(s.failures, 10) - 1)::integer, interval '6 hours')",
    );
    expect(body).toContain("return 'throttled';");
    expect(body).toContain("return 'waiting for the answer';");
  });

  it("reads GitHub's answer; 2xx closes the alert, a failure is retried and alerts after two", () => {
    const body = fn("dispatch_shake_worker");
    expect(body).toContain(
      "from net._http_response r\n     where r.id = s.last_request_id;",
    );
    expect(body).toContain("if v_found and v_status between 200 and 299 then");
    expect(body).toContain(
      "elsif v_found or s.last_dispatched_at < now() - interval '10 minutes' then",
    );
    expect(body).toContain(
      "pending = true, pending_since = coalesce(pending_since, now()),",
    );
    expect(body).toContain("if s.failures >= 2 and not exists (");
    expect(body).toContain("'shake_dispatch',");
    expect(body).toContain("jsonb_build_object('provider', 'github',");
    expect(body).toContain("perform public.ops_notify_admins();");
    expect(body).toMatch(/where kind = 'shake_dispatch'\s+and closed_at is null;/);
  });

  it("runs every minute", () => {
    expect(sql).toContain(
      "perform cron.schedule('dispatch_shake_worker', '* * * * *', $cron$select public.dispatch_shake_worker();$cron$);",
    );
  });

  it("knows no-token from a Vault it cannot read, without failing", () => {
    expect(fn("shake_dispatch_token_set")).toMatch(
      /exception when others then\s+v_set := false;/,
    );
    expect(fn("dispatch_shake_worker")).toMatch(
      /exception when others then\s+v_token := null;/,
    );
  });
});

describe("the admin card", () => {
  it("is the 0070 body plus the worker line", () => {
    const before = functionSource(
      readCode("0070_feed_watchdog_all_sources.sql"),
      "admin_source_status",
    );
    const after = fn("admin_source_status");
    const tail = "       where a.closed_at is null), '[]'::jsonb)\n  );";
    expect(before).toContain(tail);
    const worker = after.slice(
      after.indexOf(",\n    'shake_worker'"),
      after.lastIndexOf("\n  );"),
    );
    expect(after.replace(worker, "")).toBe(before);
    for (const key of [
      "'token_set', public.shake_dispatch_token_set()",
      "'last_dispatched_at'",
      "'last_outcome'",
      "'last_status'",
      "'failures'",
    ]) {
      expect(worker).toContain(key);
    }
    expect(worker).not.toContain("decrypted_secret");
  });
});

describe("the workflow it starts (bumelerze-atlas, when the sibling clone is there)", () => {
  const maybe = workflow ? it : it.skip;

  maybe("accepts workflow_dispatch with every input optional", () => {
    expect(workflow).toContain("workflow_dispatch:");
    const inputs = workflow!.slice(
      workflow!.indexOf("inputs:"),
      workflow!.indexOf("# Never run two sweeps"),
    );
    expect(inputs).not.toMatch(/required: true/);
  });

  maybe("queues starts in one concurrency group, never two sweeps at once", () => {
    expect(workflow).toMatch(
      /concurrency:\s+group: shake-worker\s+cancel-in-progress: false/,
    );
  });
});
