import { readFileSync } from "fs";
import { join } from "path";

/**
 * Static checks of migration 0041: the registry starts the SHAKEmap worker
 * through GitHub's workflow_dispatch when an event is new or materially
 * revised — with the worker's own revision thresholds, a 3-minute throttle,
 * the token read from Vault (never written in SQL), and nothing callable by
 * app users.
 */
const sql = readFileSync(join(__dirname, "..", "0041_shake_worker_dispatch.sql"), "utf8");
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("0041_shake_worker_dispatch.sql", () => {
  it("uses the worker's revision thresholds", () => {
    expect(code).toMatch(
      /abs\(coalesce\(new\.magnitude, 0\) - coalesce\(old\.magnitude, 0\)\) >= 0\.1/,
    );
    expect(code).toMatch(
      /abs\(coalesce\(new\.depth_km, 0\) - coalesce\(old\.depth_km, 0\)\) >= 5/,
    );
    expect(code).toMatch(/km_between\(old\.lat, old\.lon, new\.lat, new\.lon\) >= 5/);
  });

  it("only reacts to recent, published, unmerged events", () => {
    expect(code).toMatch(/new\.status is distinct from 'published'/);
    expect(code).toMatch(/new\.merged_into is not null/);
    expect(code).toMatch(/interval '14 days'/);
  });

  it("throttles to one start per 3 minutes and retries a failed one", () => {
    expect(code).toMatch(/interval '3 minutes'/);
    expect(code).toMatch(/between 200 and 299 then pending else true/);
  });

  it("dispatches the atlas shake-worker on main with the token from Vault", () => {
    expect(code).toContain(
      "https://api.github.com/repos/Peshawa-LH/bumelerze-atlas/actions/workflows/shake-worker.yml/dispatches",
    );
    expect(code).toMatch(/jsonb_build_object\('ref', 'main'\)/);
    expect(code).toMatch(
      /from vault\.decrypted_secrets where name = 'github_dispatch_token'/,
    );
    // No token literal ever lives in the migration.
    expect(sql).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/);
  });

  it("keeps the state and functions away from app users", () => {
    expect(code).toMatch(
      /alter table public\.worker_dispatch_state enable row level security/,
    );
    expect(code).toMatch(
      /revoke all on function public\.request_shake_worker\(text\) from public, anon, authenticated/,
    );
    expect(code).toMatch(
      /revoke all on function public\.dispatch_shake_worker\(\) from public, anon, authenticated/,
    );
  });

  it("runs the dispatcher every minute with pg_cron", () => {
    expect(code).toMatch(/cron\.schedule\('dispatch_shake_worker', '\* \* \* \* \*'/);
  });
});
