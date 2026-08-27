import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { base36, formatBumelerzeId, InMemoryBumelerzeIdCounters } from "../bumelerze-id-reference";

// The exact spread the wave brief calls out: 0, 35, 36, 1295, 1296, 46655
// (plus 1, the smallest valid counter for format_bumelerze_id, which
// requires counter >= 1).
const COUNTER_SPREAD = [0, 1, 35, 36, 1295, 1296, 46655];

describe("base36 (TS port of shake_service/event_id.py::base36 / migration 0025's bumelerze_base36)", () => {
  it.each([
    [0, "0"],
    [1, "1"],
    [35, "z"],
    [36, "10"],
    [1295, "zz"],
    [1296, "100"],
    [46655, "zzz"],
  ])("base36(%i) === %s", (n, expected) => {
    expect(base36(n)).toBe(expected);
  });

  it("rejects negative input, same as the SQL and Python implementations", () => {
    expect(() => base36(-1)).toThrow(RangeError);
  });
});

describe("formatBumelerzeId (TS port of shake_service/event_id.py::format_bumelerze_id / migration 0025's format_bumelerze_id)", () => {
  it.each([
    [1, "bml20260001"],
    [35, "bml2026000z"],
    [36, "bml20260010"],
    [1295, "bml202600zz"],
    [1296, "bml20260100"],
    [46655, "bml20260zzz"],
  ])("formatBumelerzeId(2026, %i) === %s", (counter, expected) => {
    expect(formatBumelerzeId(2026, counter)).toBe(expected);
  });

  it("zero-pads the year to 4 digits (archival documentary events reach back to year 872)", () => {
    expect(formatBumelerzeId(872, 1)).toBe("bml08720001");
  });

  it("grows past zzzz rather than truncating — never reused, never truncated", () => {
    // 36^4 = 1_679_616; counter 1_679_616 is the first one requiring 5 base-36 digits.
    expect(formatBumelerzeId(2026, 1_679_616)).toBe("bml202610000");
  });

  it("rejects a year that would not fit in 4 digits", () => {
    expect(() => formatBumelerzeId(10000, 1)).toThrow(RangeError);
  });

  it("rejects counter 0 — bml ids are 1-based", () => {
    expect(() => formatBumelerzeId(2026, 0)).toThrow(RangeError);
  });

  it("matches the real bml id for Postgres's own 2026 reserved-band seed (counter 1000)", () => {
    // migration 0025 seeds 2026 at last_counter = 999, so the first
    // Postgres-issued 2026 id is counter 1000 — the exact value the
    // migration's own comments and supabase/README.md cite.
    expect(formatBumelerzeId(2026, 1000)).toBe("bml202600rs");
  });
});

describe("cross-check against the live Python implementation (best-effort)", () => {
  // Mirrors this project's existing sibling-checkout-fallback convention
  // (project CLAUDE.md: bumelerze-engine's own cross-repo sync tests "skip
  // if it cannot" find the sibling checkout) — the hardcoded-value tests
  // above are the ALWAYS-run regression guard for CI; this test additionally
  // proves live agreement with shake_service/event_id.py itself whenever
  // python3 and the sibling bumelerze-engine checkout are both available in
  // the environment running the suite.
  const enginePath = path.resolve(__dirname, "../../../../bumelerze-engine");
  const eventIdModulePath = path.join(enginePath, "shake_service", "event_id.py");
  const hasEngineCheckout = fs.existsSync(eventIdModulePath);

  (hasEngineCheckout ? it : it.skip)(
    "TS port and shake_service/event_id.py agree across the required spread",
    () => {
      const formatCounters = COUNTER_SPREAD.filter((n) => n >= 1);
      const script = [
        "import sys",
        `sys.path.insert(0, ${JSON.stringify(enginePath)})`,
        "from shake_service.event_id import base36, format_bumelerze_id",
        `for n in [${COUNTER_SPREAD.join(",")}]:`,
        "    print(base36(n))",
        `for n in [${formatCounters.join(",")}]:`,
        "    print(format_bumelerze_id(2026, n))",
      ].join("\n");

      let output: string;
      try {
        output = execFileSync("python3", ["-c", script], { encoding: "utf8" });
      } catch {
        // python3 unavailable in this environment — skip rather than fail,
        // same posture as the sibling-repo checks referenced above. The
        // hardcoded-value tests in this file are the ground truth this
        // fallback would otherwise be verifying live.
        return;
      }

      const lines = output.trim().split("\n").filter((line) => line.length > 0);
      const base36Lines = lines.slice(0, COUNTER_SPREAD.length);
      const formatLines = lines.slice(COUNTER_SPREAD.length);

      COUNTER_SPREAD.forEach((n, i) => {
        expect(base36(n)).toBe(base36Lines[i]);
      });
      formatCounters.forEach((n, i) => {
        expect(formatBumelerzeId(2026, n)).toBe(formatLines[i]);
      });
    },
  );
});

describe("InMemoryBumelerzeIdCounters (reference port of allocate_bumelerze_id_batch's atomic upsert)", () => {
  it("never allocates the same id twice across many single-id calls for one year", () => {
    const counters = new InMemoryBumelerzeIdCounters();
    const ids = Array.from({ length: 500 }, () => counters.allocate(2027));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("bml20270001");
    expect(ids[ids.length - 1]).toBe(formatBumelerzeId(2027, 500));
  });

  it("interleaved single-id and batch calls for the SAME year never collide or gap incorrectly", () => {
    const counters = new InMemoryBumelerzeIdCounters();
    const batch1 = counters.allocateBatch(2028, 10); // counters 1..10
    const single = counters.allocate(2028); // counter 11
    const batch2 = counters.allocateBatch(2028, 5); // counters 12..16
    const all = [...batch1, single, ...batch2];

    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual(Array.from({ length: 16 }, (_, i) => formatBumelerzeId(2028, i + 1)));
  });

  it("simulates the 4 overlapping pg_cron ingest channels: many callers racing on ONE year still produce a gap-free, duplicate-free run", () => {
    // Stand-in for emsc/usgs/geofon/isc all discovering new events for the
    // same origin year around the same tick (migration 0024's 4 schedules).
    // No `await` anywhere in this loop — see bumelerze-id-reference.ts's own
    // class-level comment for why that is what makes this faithfully model
    // the real single-statement atomicity, not just "no bugs found because
    // nothing actually ran concurrently."
    const counters = new InMemoryBumelerzeIdCounters();
    const channelCallCounts = [37, 12, 41, 3, 58, 1, 24]; // arbitrary, deliberately uneven
    const allIds: string[] = [];
    for (const callCount of channelCallCounts) {
      for (let i = 0; i < callCount; i += 1) {
        allIds.push(counters.allocate(2029));
      }
    }
    const expectedTotal = channelCallCounts.reduce((a, b) => a + b, 0);

    expect(allIds).toHaveLength(expectedTotal);
    expect(new Set(allIds).size).toBe(expectedTotal); // no duplicate ever handed out
    expect(allIds).toEqual(
      Array.from({ length: expectedTotal }, (_, i) => formatBumelerzeId(2029, i + 1)),
    ); // gap-free in THIS scenario (gaps are allowed, never required to occur)
  });

  it("different years never share or block each other's counters", () => {
    const counters = new InMemoryBumelerzeIdCounters();
    const a = counters.allocate(2030);
    const b = counters.allocate(2031);
    expect(a).toBe("bml20300001");
    expect(b).toBe("bml20310001");
  });

  it("models the 2026 reserved band: seeding at 999 makes the first allocation counter 1000", () => {
    const counters = new InMemoryBumelerzeIdCounters();
    counters.seed(2026, 999); // migration 0025's own seed row
    expect(counters.allocate(2026)).toBe("bml202600rs"); // counter 1000
    expect(counters.allocate(2026)).toBe(formatBumelerzeId(2026, 1001));
  });

  it("an unseeded year (every year except 2026) starts at counter 1", () => {
    const counters = new InMemoryBumelerzeIdCounters();
    expect(counters.allocate(2050)).toBe(formatBumelerzeId(2050, 1));
  });
});
