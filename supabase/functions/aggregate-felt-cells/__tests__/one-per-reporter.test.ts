/**
 * One report per reporter per event (migration 0073): the reporter is the
 * report's account (`user_id`), else its legacy device id; a tier-2 report
 * beats a tier-1 one; within a tier the latest `created_at` wins. Applied
 * before `groupIntoCells`, so one person with many device ids, or with
 * reports in many cells, counts once for the whole event.
 */

import {
  computeCellRow,
  groupIntoCells,
  joinReportsAndDetails,
  onePerReporter,
} from "../aggregate-event";
import type { FeltReportDetailRow, FeltReportRow } from "../types";

function row(overrides: Partial<FeltReportRow>): FeltReportRow {
  return {
    report_id: "r1",
    device_id: "d1",
    user_id: null,
    event_id: "evt-1",
    created_at: "2026-11-20T10:00:00+00:00",
    cartoon_level: 5,
    lat: 35.56,
    lon: 45.43,
    geohash_p5: "u4pru",
    ...overrides,
  };
}

function details(feltReportId: string): FeltReportDetailRow {
  return {
    felt_report_id: feltReportId,
    situation: "inside",
    felt_answer: "yes",
    others_felt_answer: "most",
    motion_answer: "moderate",
    reaction_answer: "excitement",
    stand_answer: "no",
    shelf_answer: "rattled",
    picture_answer: "no",
    furniture_answer: "no",
    building_damage_level: null,
    damage_typology: null,
    road_damage_level: null,
  };
}

const USER = "6f0f7d3e-1111-4c4c-9a9a-000000000001";
const OTHER = "6f0f7d3e-2222-4c4c-9a9a-000000000002";

/** Total reports over every p5 cell of an event, the way the function
 * builds them (join, one per reporter, cells, CDI rows). */
function p5Totals(rows: FeltReportRow[], detailRows: FeltReportDetailRow[] = []) {
  const groups = groupIntoCells(onePerReporter(joinReportsAndDetails(rows, detailRows)));
  const p5 = groups
    .filter((g) => g.precision === 5)
    .map((g) => computeCellRow("evt-1", g, 1))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  return {
    cells: p5.length,
    reports: p5.reduce((sum, r) => sum + r.n_reports, 0),
    p4Cells: groups.filter((g) => g.precision === 4).length,
  };
}

describe("the reporter key", () => {
  it("is the account when the report has one, else the device", () => {
    const joined = joinReportsAndDetails(
      [
        row({ report_id: "a", device_id: "dev-a", user_id: USER }),
        row({ report_id: "b", device_id: "dev-b", user_id: null }),
      ],
      [],
    );
    expect(joined.map((r) => r.deviceId)).toEqual([USER, "dev-b"]);
    expect(joined.map((r) => r.createdAt)).toEqual([
      "2026-11-20T10:00:00+00:00",
      "2026-11-20T10:00:00+00:00",
    ]);
  });
});

describe("onePerReporter", () => {
  it("one reporter with many device ids in many cells counts once for the event", () => {
    // Five device ids, five different p5 cells under three p4 prefixes.
    const cells = ["u4pru", "u4prv", "u4prw", "u4pxa", "u4qab"];
    const rows = cells.map((geohash, i) =>
      row({
        report_id: `r${i}`,
        device_id: `forged-${i}`,
        user_id: USER,
        geohash_p5: geohash,
        cartoon_level: 9,
        created_at: `2026-11-20T10:0${i}:00+00:00`,
      }),
    );
    const kept = onePerReporter(joinReportsAndDetails(rows, []));
    expect(kept).toHaveLength(1);
    // the latest of the five
    expect(kept[0]?.reportId).toBe("r4");

    const totals = p5Totals(rows);
    expect(totals).toEqual({ cells: 1, reports: 1, p4Cells: 1 });
  });

  it("cannot lift a cell past the trust gate (n_reports >= 3) alone", () => {
    const rows = [0, 1, 2, 3].map((i) =>
      row({ report_id: `r${i}`, device_id: `forged-${i}`, user_id: USER }),
    );
    const [cell] = groupIntoCells(onePerReporter(joinReportsAndDetails(rows, [])))
      .filter((g) => g.precision === 5)
      .map((g) => computeCellRow("evt-1", g, 1));
    expect(cell?.n_reports).toBe(1);
  });

  it("different people stay separate, including legacy reports keyed by device", () => {
    const rows = [
      row({ report_id: "a", device_id: "dev-a", user_id: USER }),
      row({ report_id: "b", device_id: "dev-b", user_id: OTHER }),
      row({ report_id: "c", device_id: "dev-c", user_id: null }),
      row({ report_id: "d", device_id: "dev-d", user_id: null }),
    ];
    expect(onePerReporter(joinReportsAndDetails(rows, []))).toHaveLength(4);
    expect(p5Totals(rows).reports).toBe(4);
  });

  it("a tier-2 report beats a tier-1 one, even an older one", () => {
    const rows = [
      row({ report_id: "old-t2", device_id: "dev-1", user_id: USER, created_at: "2026-11-20T10:00:00+00:00" }),
      row({ report_id: "new-t1", device_id: "dev-2", user_id: USER, created_at: "2026-11-20T11:00:00+00:00" }),
    ];
    const kept = onePerReporter(joinReportsAndDetails(rows, [details("old-t2")]));
    expect(kept).toHaveLength(1);
    expect(kept[0]?.reportId).toBe("old-t2");
    expect(kept[0]?.tier).toBe("tier2");
    // order of the rows does not matter
    const reversed = onePerReporter(joinReportsAndDetails([...rows].reverse(), [details("old-t2")]));
    expect(reversed[0]?.reportId).toBe("old-t2");
  });

  it("within tier 1 the latest created_at wins, whatever the row order", () => {
    const rows = [
      row({ report_id: "t1-late", device_id: "dev-1", user_id: USER, cartoon_level: 7, created_at: "2026-11-20T12:00:00+00:00" }),
      row({ report_id: "t1-early", device_id: "dev-2", user_id: USER, cartoon_level: 3, created_at: "2026-11-20T09:00:00+00:00" }),
      row({ report_id: "t1-mid", device_id: "dev-3", user_id: USER, cartoon_level: 4, created_at: "2026-11-20T10:30:00+00:00" }),
    ];
    for (const order of [rows, [...rows].reverse(), [rows[1]!, rows[0]!, rows[2]!]]) {
      const kept = onePerReporter(joinReportsAndDetails(order, []));
      expect(kept.map((r) => r.reportId)).toEqual(["t1-late"]);
      expect(kept[0]?.cartoonLevel).toBe(7);
    }
  });

  it("within tier 2 the latest created_at wins", () => {
    const rows = [
      row({ report_id: "t2-early", device_id: "dev-1", user_id: USER, created_at: "2026-11-20T09:00:00+00:00" }),
      row({ report_id: "t2-late", device_id: "dev-2", user_id: USER, created_at: "2026-11-20T12:00:00+00:00" }),
    ];
    const kept = onePerReporter(
      joinReportsAndDetails(rows, [details("t2-early"), details("t2-late")]),
    );
    expect(kept.map((r) => r.reportId)).toEqual(["t2-late"]);
  });

  it("an equal created_at is settled by report id, not by row order", () => {
    const rows = [
      row({ report_id: "aaa", device_id: "dev-1", user_id: USER }),
      row({ report_id: "bbb", device_id: "dev-2", user_id: USER }),
    ];
    expect(onePerReporter(joinReportsAndDetails(rows, []))[0]?.reportId).toBe("bbb");
    expect(onePerReporter(joinReportsAndDetails([...rows].reverse(), []))[0]?.reportId).toBe("bbb");
  });

  it("an unreadable created_at loses to a readable one", () => {
    const rows = [
      row({ report_id: "zzz-bad", device_id: "dev-1", user_id: USER, created_at: "not a time" }),
      row({ report_id: "aaa-ok", device_id: "dev-2", user_id: USER, created_at: "2026-11-20T09:00:00+00:00" }),
    ];
    expect(onePerReporter(joinReportsAndDetails(rows, []))[0]?.reportId).toBe("aaa-ok");
  });

  it("leaves an event without duplicates exactly as it was", () => {
    const rows = [
      row({ report_id: "a", device_id: "dev-a", geohash_p5: "u4pru" }),
      row({ report_id: "b", device_id: "dev-b", geohash_p5: "u4prv" }),
    ];
    const joined = joinReportsAndDetails(rows, []);
    expect(onePerReporter(joined)).toEqual(joined);
  });
});
