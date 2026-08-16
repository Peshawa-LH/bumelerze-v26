/**
 * Unit tests for this function's own (non-vendored) orchestration logic —
 * grouping into p4/p5/p6 cells, the p6 >=20-report trigger, and the
 * idempotent skip-if-unchanged compare. The CDI math itself is proven
 * correct/non-drifted by `src/lib/felt-aggregation/__tests__/
 * vendored-sync.test.ts` and this folder's own vendored copy's relationship
 * to it — these tests exercise the surrounding decision logic instead
 * (`aggregate-event.ts`, `cell-extras.ts`), run under Jest/Node the same
 * way the rest of this repo's jest tests run despite this function's
 * Deno-flavored `.ts`-suffixed relative imports (Jest resolves an
 * explicit `./foo.ts` import to the literal file `foo.ts` without any
 * special config).
 */

import {
  cellRowUnchanged,
  computeCellRow,
  groupIntoCells,
  isDebounced,
  joinReportsAndDetails,
  pickLatestPerGeohash,
} from "../aggregate-event";
import { computeDamageDist, computeGroundEffectsDist } from "../cell-extras";
import type { CellReport, FeltCellInsertRow, FeltReportDetailRow, FeltReportRow } from "../types";

function feltReportRow(overrides: Partial<FeltReportRow>): FeltReportRow {
  return {
    report_id: "r1",
    device_id: "d1",
    event_id: "evt-1",
    cartoon_level: 5,
    lat: 35.56,
    lon: 45.43,
    geohash_p5: "u4pru",
    ...overrides,
  };
}

const EMPTY_DETAIL_ANSWERS = {
  situation: null,
  felt_answer: null,
  others_felt_answer: null,
  motion_answer: null,
  reaction_answer: null,
  stand_answer: null,
  shelf_answer: null,
  picture_answer: null,
  furniture_answer: null,
  building_damage_level: null,
  damage_typology: null,
  road_damage_level: null,
};

function detailRow(overrides: Partial<FeltReportDetailRow>): FeltReportDetailRow {
  return { felt_report_id: "r1", ...EMPTY_DETAIL_ANSWERS, ...overrides };
}

describe("joinReportsAndDetails", () => {
  it("marks a report with no matching detail row as tier1", () => {
    const [joined] = joinReportsAndDetails([feltReportRow({ report_id: "r1" })], []);
    expect(joined?.tier).toBe("tier1");
  });

  it("marks a report WITH a matching detail row as tier2 and maps every answer column", () => {
    const [joined] = joinReportsAndDetails(
      [feltReportRow({ report_id: "r1" })],
      [
        detailRow({
          felt_report_id: "r1",
          felt_answer: "yes",
          others_felt_answer: "most",
          building_damage_level: 2,
          damage_typology: "lowrise",
          road_damage_level: 1,
        }),
      ],
    );
    expect(joined?.tier).toBe("tier2");
    if (joined?.tier !== "tier2") throw new Error("unreachable");
    expect(joined.answers.felt).toBe("yes");
    expect(joined.answers.othersFelt).toBe("most");
    expect(joined.answers.buildingDamageLevel).toBe(2);
    expect(joined.answers.damageTypology).toBe("lowrise");
    expect(joined.answers.roadDamageLevel).toBe(1);
  });

  it("every joined report keeps cartoon_level regardless of tier (tier-2 supersedes in felt_report_details, not in felt_reports)", () => {
    const [joined] = joinReportsAndDetails(
      [feltReportRow({ report_id: "r1", cartoon_level: 9 })],
      [detailRow({ felt_report_id: "r1", felt_answer: "yes" })],
    );
    expect(joined?.cartoonLevel).toBe(9);
  });
});

function tier1Cell(deviceId: string, geohashP5: string, cartoonLevel = 5): CellReport {
  return {
    tier: "tier1",
    reportId: `r-${deviceId}`,
    deviceId,
    lat: 35.56,
    lon: 45.43,
    geohashP5,
    cartoonLevel: cartoonLevel as CellReport["cartoonLevel"],
  };
}

describe("groupIntoCells", () => {
  it("produces one p4 rollup + one p5 row for a small cell (below the p6 trigger)", () => {
    const reports = [tier1Cell("a", "u4pru"), tier1Cell("b", "u4pru")];
    const groups = groupIntoCells(reports);

    const p4 = groups.filter((g) => g.precision === 4);
    const p5 = groups.filter((g) => g.precision === 5);
    const p6 = groups.filter((g) => g.precision === 6);

    expect(p4).toHaveLength(1);
    expect(p4[0]?.geohash).toBe("u4pr");
    expect(p4[0]?.reports).toHaveLength(2);
    expect(p5).toHaveLength(1);
    expect(p5[0]?.geohash).toBe("u4pru");
    expect(p6).toHaveLength(0);
  });

  it("computes p6 refinement additionally once a p5 cell reaches 20 reports, without removing the p5 row", () => {
    const reports = Array.from({ length: 20 }, (_, i) => tier1Cell(`d${i}`, "u4pru"));
    const groups = groupIntoCells(reports);

    const p5 = groups.filter((g) => g.precision === 5);
    const p6 = groups.filter((g) => g.precision === 6);

    expect(p5).toHaveLength(1);
    expect(p5[0]?.reports).toHaveLength(20);
    // Every synthetic report shares the same lat/lon, so all 20 collapse
    // into a single p6 sub-cell — still proves p6 rows exist ADDITIONALLY.
    expect(p6.length).toBeGreaterThan(0);
    expect(p6.reduce((sum, g) => sum + g.reports.length, 0)).toBe(20);
  });

  it("separate p5 cells under the same p4 prefix both roll up into the one p4 group", () => {
    // "u4pru" and "u4prv" share the 4-char prefix "u4pr".
    const reports = [tier1Cell("a", "u4pru"), tier1Cell("b", "u4prv")];
    const groups = groupIntoCells(reports);

    const p4 = groups.filter((g) => g.precision === 4);
    expect(p4).toHaveLength(1);
    expect(p4[0]?.reports).toHaveLength(2);

    const p5 = groups.filter((g) => g.precision === 5);
    expect(p5).toHaveLength(2);
  });
});

describe("computeCellRow", () => {
  it("returns a FeltCellInsertRow with the requested version and event id", () => {
    const group = { geohash: "u4pru", precision: 5 as const, reports: [tier1Cell("a", "u4pru")] };
    const row = computeCellRow("evt-1", group, 3);
    expect(row).not.toBeNull();
    expect(row?.event_id).toBe("evt-1");
    expect(row?.geohash).toBe("u4pru");
    expect(row?.precision).toBe(5);
    expect(row?.version).toBe(3);
    expect(row?.n_reports).toBe(1);
  });
});

describe("cellRowUnchanged (idempotency compare)", () => {
  const base: FeltCellInsertRow = {
    event_id: "evt-1",
    geohash: "u4pru",
    precision: 5,
    n_reports: 3,
    n_tier2: 1,
    cdi: 4.5,
    cws: 12,
    index_means: { felt: 1, motion: null, reaction: null, stand: null, shelf: null, picture: null, furniture: null, damage: null },
    damage_dist: { byGrade: {}, byTypology: {} },
    ground_effects: { byLevel: {} },
    version: 1,
  };

  it("false when there is no existing row (first-ever compute for this cell)", () => {
    expect(cellRowUnchanged(base, undefined)).toBe(false);
  });

  it("true when every comparable field matches, regardless of key order in nested JSONB fields", () => {
    const existing: FeltCellInsertRow = {
      ...base,
      version: 1,
      index_means: { damage: null, felt: 1, furniture: null, motion: null, picture: null, reaction: null, shelf: null, stand: null },
    };
    expect(cellRowUnchanged(base, existing)).toBe(true);
  });

  it("false when a comparable field differs (e.g. a new report changed n_reports)", () => {
    const existing: FeltCellInsertRow = { ...base, n_reports: 2 };
    expect(cellRowUnchanged(base, existing)).toBe(false);
  });

  it("ignores version differing between computed and existing", () => {
    const existing: FeltCellInsertRow = { ...base, version: 7 };
    expect(cellRowUnchanged({ ...base, version: 8 }, existing)).toBe(true);
  });
});

describe("pickLatestPerGeohash", () => {
  it("keeps only the highest-version row per geohash, given version-desc input", () => {
    const rows = [
      { event_id: "e", geohash: "a", precision: 5 as const, n_reports: 1, n_tier2: 0, cdi: 2, cws: null, index_means: {}, damage_dist: {}, ground_effects: {}, version: 3 },
      { event_id: "e", geohash: "a", precision: 5 as const, n_reports: 1, n_tier2: 0, cdi: 2, cws: null, index_means: {}, damage_dist: {}, ground_effects: {}, version: 2 },
      { event_id: "e", geohash: "b", precision: 5 as const, n_reports: 1, n_tier2: 0, cdi: 2, cws: null, index_means: {}, damage_dist: {}, ground_effects: {}, version: 1 },
    ];
    const latest = pickLatestPerGeohash(rows);
    expect(latest.get("a")?.version).toBe(3);
    expect(latest.get("b")?.version).toBe(1);
    expect(latest.size).toBe(2);
  });
});

describe("isDebounced", () => {
  it("never debounces a cell that has no prior computed_at", () => {
    expect(isDebounced(null)).toBe(false);
  });

  it("debounces within 60s of the latest computed_at", () => {
    const now = 1_700_000_100_000;
    const latest = new Date(now - 30_000).toISOString();
    expect(isDebounced(latest, now)).toBe(true);
  });

  it("does not debounce once 60s have passed", () => {
    const now = 1_700_000_100_000;
    const latest = new Date(now - 61_000).toISOString();
    expect(isDebounced(latest, now)).toBe(false);
  });
});

describe("computeDamageDist / computeGroundEffectsDist", () => {
  function tier2Report(overrides: {
    buildingDamageLevel?: number | null;
    damageTypology?: string | null;
    roadDamageLevel?: number | null;
  }) {
    return {
      tier: "tier2" as const,
      reportId: "r1",
      deviceId: "d1",
      lat: 0,
      lon: 0,
      geohashP5: "u4pru",
      cartoonLevel: 5 as const,
      answers: {
        situation: null,
        felt: null,
        othersFelt: null,
        motion: null,
        reaction: null,
        stand: null,
        shelf: null,
        picture: null,
        furniture: null,
        buildingDamageLevel: overrides.buildingDamageLevel ?? null,
        damageTypology: overrides.damageTypology ?? null,
        roadDamageLevel: overrides.roadDamageLevel ?? null,
        comment: null,
      },
    };
  }

  it("counts building-damage grades and buckets by typology, skipping unanswered", () => {
    const dist = computeDamageDist([
      tier2Report({ buildingDamageLevel: 2, damageTypology: "lowrise" }),
      tier2Report({ buildingDamageLevel: 2, damageTypology: "lowrise" }),
      tier2Report({ buildingDamageLevel: 0, damageTypology: null }),
      tier2Report({ buildingDamageLevel: null }),
    ]);
    expect(dist.byGrade).toEqual({ "2": 2, "0": 1 });
    expect(dist.byTypology.lowrise).toEqual({ "2": 2 });
    expect(dist.byTypology.none).toEqual({ "0": 1 });
  });

  it("counts road-damage levels, skipping unanswered", () => {
    const dist = computeGroundEffectsDist([
      tier2Report({ roadDamageLevel: 1 }),
      tier2Report({ roadDamageLevel: 1 }),
      tier2Report({ roadDamageLevel: 3 }),
      tier2Report({ roadDamageLevel: null }),
    ]);
    expect(dist.byLevel).toEqual({ "1": 2, "3": 1 });
  });
});
