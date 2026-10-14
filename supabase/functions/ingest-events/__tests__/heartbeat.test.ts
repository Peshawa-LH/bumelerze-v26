import { readFileSync } from "fs";
import { join } from "path";

import { buildFeedHeartbeatRow, HEARTBEAT_ERROR_MAX_LENGTH } from "../heartbeat";
import type { ChannelIngestSummary } from "../types";

/** Column names of `create table ... public.feed_heartbeats (...)` in 0067,
 * read from the migration itself so the row and the table cannot drift. */
function feedHeartbeatColumns(): string[] {
  const sql = readFileSync(
    join(__dirname, "..", "..", "..", "migrations", "0067_ops_and_hygiene.sql"),
    "utf8",
  );
  const match = sql.match(
    /create table if not exists public\.feed_heartbeats \(([\s\S]*?)\n\);/,
  );
  if (!match) {
    throw new Error("feed_heartbeats definition not found in 0067");
  }
  return match[1]!
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"))
    .map((line) => line.split(/\s+/)[0]!);
}

const SUMMARY: ChannelIngestSummary = {
  channel: "emsc",
  fetched: 3,
  skippedParsing: 1,
  created: 1,
  updated: 1,
  unchanged: 1,
  errors: 0,
  results: [],
};
const NOW = "2026-10-14T18:00:00.000Z";

describe("buildFeedHeartbeatRow", () => {
  it("writes only real feed_heartbeats columns (migration 0067)", () => {
    const columns = feedHeartbeatColumns();
    expect(columns).toEqual(
      expect.arrayContaining([
        "provider",
        "last_ok_at",
        "last_summary",
        "last_error_at",
        "last_error",
      ]),
    );
    for (const row of [
      buildFeedHeartbeatRow(
        "emsc",
        { ok: true, summary: SUMMARY, emptyBody: false },
        NOW,
      ),
      buildFeedHeartbeatRow("usgs", { ok: false, error: "request failed: 502" }, NOW),
    ]) {
      for (const key of Object.keys(row)) {
        expect(columns).toContain(key);
      }
    }
  });

  it("a successful run stamps last_ok_at and the counts, and says whether the feed sent an empty body", () => {
    const row = buildFeedHeartbeatRow(
      "emsc",
      { ok: true, summary: SUMMARY, emptyBody: true },
      NOW,
    );
    expect(row).toEqual({
      provider: "emsc",
      last_ok_at: NOW,
      last_summary: {
        fetched: 3,
        skippedParsing: 1,
        created: 1,
        updated: 1,
        unchanged: 1,
        errors: 0,
        emptyBody: true,
      },
      updated_at: NOW,
    });
    // the per-record results list is never copied: the row stays small
    expect(row.last_summary).not.toHaveProperty("results");
  });

  it("a failed run stamps the error only, leaving last_ok_at alone so the watchdog's clock keeps running", () => {
    const row = buildFeedHeartbeatRow(
      "usgs",
      { ok: false, error: "The signal has been aborted" },
      NOW,
    );
    expect(row).toEqual({
      provider: "usgs",
      last_error_at: NOW,
      last_error: "The signal has been aborted",
      updated_at: NOW,
    });
    expect(row).not.toHaveProperty("last_ok_at");
    expect(row).not.toHaveProperty("last_summary");
  });

  it("cuts the error to the column's 500 characters", () => {
    const row = buildFeedHeartbeatRow("usgs", { ok: false, error: "x".repeat(900) }, NOW);
    expect(row.last_error).toHaveLength(HEARTBEAT_ERROR_MAX_LENGTH);
  });
});
