import {
  CDI_WEIGHTS,
  aggregateCell,
  applyCorroborationGate,
  cdiFromCWS,
  computeCWS,
  computeIndexMeans,
  trimmedMeanIntensity,
} from "../cell-aggregation";
import { EMPTY_TIER2_ANSWERS } from "@/features/felt/types";
import type { Tier2Answers } from "@/features/felt/types";
import type { AggregationInputReport, Tier1InputReport, Tier2InputReport } from "../types";

function tier1(deviceId: string, cartoonLevel: Tier1InputReport["cartoonLevel"]): Tier1InputReport {
  return { tier: "tier1", deviceId, cartoonLevel };
}
function tier2(deviceId: string, overrides: Partial<Tier2Answers>): Tier2InputReport {
  return { tier: "tier2", deviceId, answers: { ...EMPTY_TIER2_ANSWERS, ...overrides } };
}

describe("computeCWS — §2.1 weights (5/1/1/2/5/2/3/5)", () => {
  it("sums mean x weight per index", () => {
    const cws = computeCWS({
      felt: 1,
      motion: 2,
      reaction: 3,
      stand: 0.5,
      shelf: 1,
      picture: 0.5,
      furniture: 1,
      damage: 1,
    });
    // 1*5 + 2*1 + 3*1 + 0.5*2 + 1*5 + 0.5*2 + 1*3 + 1*5
    // = 5 + 2 + 3 + 1 + 5 + 1 + 3 + 5 = 25
    expect(cws).toBeCloseTo(25, 10);
  });

  it("an index with a null mean contributes nothing (not zero-weighted)", () => {
    const cws = computeCWS({
      felt: 1,
      motion: null,
      reaction: null,
      stand: null,
      shelf: null,
      picture: null,
      furniture: null,
      damage: null,
    });
    expect(cws).toBe(CDI_WEIGHTS.felt * 1); // = 5
  });
});

describe("cdiFromCWS — §3.2 steps 2-3, exact formula (3.3996*ln(CWS)-4.3781)", () => {
  it("CWS <= 0 -> CDI = 1.0 (not felt), bypassing the floor", () => {
    expect(cdiFromCWS(0)).toBe(1.0);
    expect(cdiFromCWS(-5)).toBe(1.0);
  });

  it("max CWS = 42 -> CDI ~ 8.33, rounds to 8.3 (below the 9.0 cap, R11)", () => {
    // Hand computation: ln(42) = 3.7376696183... ; 3.3996 * ln(42) =
    // 12.70977...; minus 4.3781 = 8.33167...; round to 0.1 = 8.3.
    // (matches the science pack's own worked example, §2.1: "CDI(42) ...
    // ~= 8.33")
    expect(cdiFromCWS(42)).toBe(8.3);
  });

  it("small positive CWS floors to 2.0 (felt-but-weak floor, no lower-bound carve-out)", () => {
    // CWS=1: raw = 3.3996*ln(1) - 4.3781 = 0 - 4.3781 = -4.3781 < 2 -> 2.0.
    expect(cdiFromCWS(1)).toBe(2.0);
    // CWS=5: raw = 3.3996*ln(5) - 4.3781 = 3.3996*1.60944 - 4.3781
    //      = 5.4711... - 4.3781 = 1.093... < 2 -> 2.0.
    expect(cdiFromCWS(5)).toBe(2.0);
  });

  it("CWS=10 -> CDI 3.4 (mid-range hand check)", () => {
    // raw = 3.3996*ln(10) - 4.3781 = 3.3996*2.302585 - 4.3781
    //     = 7.8278... - 4.3781 = 3.4497... -> round 3.4.
    expect(cdiFromCWS(10)).toBe(3.4);
  });

  it("cap respected even for CWS far beyond the natural 42 maximum (sanity)", () => {
    expect(cdiFromCWS(1000)).toBe(9.0);
    expect(cdiFromCWS(1e6)).toBe(9.0);
  });

  it("is monotone non-decreasing in CWS (sanity property)", () => {
    const samples = [0, 0.5, 1, 2, 5, 10, 20, 30, 42, 100, 1000];
    let prev = -Infinity;
    for (const cws of samples) {
      const cdi = cdiFromCWS(cws);
      expect(cdi).toBeGreaterThanOrEqual(prev);
      prev = cdi;
    }
  });
});

describe("null-exclusion vs zero-counting divergence (§3.2 step 1)", () => {
  it("excluding unanswered from the denominator gives a materially different CWS than zero-counting would", () => {
    // Report A answers only `shelf` (many_fell -> 1.0); report B answers
    // only `felt` (yes -> 1.0). Correct rule: shelf mean = mean of [1.0]
    // (only A answered) = 1.0; felt mean = mean of [1.0] (only B answered)
    // = 1.0. CWS = felt(1.0*5) + shelf(1.0*5) = 10 -> CDI 3.4 (per the
    // cdiFromCWS test above).
    //
    // If unanswered were WRONGLY zero-counted instead: shelf mean =
    // (1.0+0)/2 = 0.5, felt mean = (0+1.0)/2 = 0.5, CWS = 0.5*5+0.5*5 = 5
    // -> CDI floors to 2.0. The two readings diverge (3.4 vs 2.0), so this
    // test is a genuine discriminator, not just a restatement.
    const reportA = tier2("device-a", { shelf: "many_fell" });
    const reportB = tier2("device-b", { felt: "yes" });
    const means = computeIndexMeans([reportA, reportB]);
    expect(means.shelf).toBe(1.0);
    expect(means.felt).toBe(1.0);
    const cws = computeCWS(means);
    expect(cws).toBe(10);
    expect(cdiFromCWS(cws)).toBe(3.4);
  });
});

describe("trimmedMeanIntensity — §3.3 (drop min+max when n >= 5)", () => {
  it("n=4: plain mean, no trimming", () => {
    // cartoons [1,2,3,9] -> intensities [1,2,3,9] (identity table for <=9)
    // mean = 15/4 = 3.75
    expect(trimmedMeanIntensity([1, 2, 3, 9])).toBeCloseTo(3.75, 10);
  });

  it("n=5: trims exactly one min and one max by sorted position", () => {
    // sorted [1,2,3,5,9] -> trim to [2,3,5] -> mean = 10/3 = 3.333...
    expect(trimmedMeanIntensity([9, 1, 5, 2, 3])).toBeCloseTo(10 / 3, 10);
  });

  it("empty input returns null, not 0", () => {
    expect(trimmedMeanIntensity([])).toBeNull();
  });

  it("cartoon levels 10-12 are pre-capped at 9.0 by the identity table before trimming", () => {
    expect(trimmedMeanIntensity([10, 11, 12])).toBeCloseTo(9.0, 10);
  });
});

describe("aggregateCell — end to end", () => {
  it("returns {ok:false} for an empty report list", () => {
    const outcome = aggregateCell([]);
    expect(outcome).toEqual({ ok: false, reason: "no_reports" });
  });

  it("single not-felt tier-2 report -> CDI 1.0 (CWS<=0 sentinel, not floored)", () => {
    const outcome = aggregateCell([tier2("d1", { felt: "no" })]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.cell.cdi).toBe(1.0);
    expect(outcome.cell.cws).toBe(0);
    expect(outcome.cell.nReports).toBe(1);
    expect(outcome.cell.nTier2).toBe(1);
  });

  it("single not-felt tier-1 report (cartoon level 1) -> CDI 1.0 (same sentinel, via the trimmed-mean path)", () => {
    const outcome = aggregateCell([tier1("d1", 1)]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.cell.cdi).toBe(1.0);
    expect(outcome.cell.cws).toBeNull();
    expect(outcome.cell.nTier2).toBe(0);
  });

  it("CWS=42 (every index at max) -> CDI 8.3, single report", () => {
    const outcome = aggregateCell([
      tier2("d1", {
        felt: "yes",
        othersFelt: "everyone",
        motion: "violent",
        reaction: "extremely_frightened",
        stand: "fell",
        shelf: "many_fell",
        picture: "yes",
        furniture: "yes",
        buildingDamageLevel: 3,
      }),
    ]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.cell.cws).toBe(42);
    expect(outcome.cell.cdi).toBe(8.3);
  });

  it("dedup: tier-2 supersedes tier-1 for the same device, not additive", () => {
    // Same device submits a tier-1 pick then a tier-2 questionnaire — only
    // the tier-2 answers should count; nReports must stay 1, not 2.
    const outcome = aggregateCell([tier1("same-device", 9), tier2("same-device", { felt: "no" })]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.cell.nReports).toBe(1);
    expect(outcome.cell.nTier2).toBe(1);
    expect(outcome.cell.cdi).toBe(1.0); // the tier-2 "no" answer wins, not the tier-1 "9"
  });

  it("mixed tier-1 + tier-2 combination (§3.3 count-weighted mean)", () => {
    // 2 identical tier-2 reports -> CWS = 35 (felt 5 + motion 4 + reaction 4
    // + stand 2 + shelf 5 + picture 2 + furniture 3 + damage 10 = 35),
    // CDI2 = cdiFromCWS(35) = 7.7 (see cdiFromCWS's own coverage for the
    // log-formula arithmetic). 3 tier-1-only reports at cartoon levels
    // [4,5,6] (n1=3 < 5, no trimming) -> Ibar1 = 15/3 = 5.0.
    // I_cell = (2*7.7 + 3*5.0) / 5 = (15.4 + 15) / 5 = 30.4/5 = 6.08 ->
    // rounds to 6.1.
    const tier2Overrides: Partial<Tier2Answers> = {
      felt: "yes",
      motion: "strong",
      reaction: "very_frightened",
      stand: "difficult",
      shelf: "many_fell",
      picture: "yes",
      furniture: "yes",
      buildingDamageLevel: 2,
    };
    const outcome = aggregateCell([
      tier2("t2-a", tier2Overrides),
      tier2("t2-b", tier2Overrides),
      tier1("t1-a", 4),
      tier1("t1-b", 5),
      tier1("t1-c", 6),
    ]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.cell.cws).toBe(35);
    expect(outcome.cell.nReports).toBe(5);
    expect(outcome.cell.nTier2).toBe(2);
    expect(outcome.cell.cdi).toBe(6.1);
  });

  it("meetsDisplayThreshold flags n_reports >= 3 (§3.2 step 4)", () => {
    const two = aggregateCell([tier1("a", 4), tier1("b", 4)]);
    const three = aggregateCell([tier1("a", 4), tier1("b", 4), tier1("c", 4)]);
    expect(two.ok && two.cell.meetsDisplayThreshold).toBe(false);
    expect(three.ok && three.cell.meetsDisplayThreshold).toBe(true);
    expect(two.ok && two.cell.displayIntensity).toBeNull();
    expect(three.ok && three.cell.displayIntensity).not.toBeNull();
  });
});

describe("applyCorroborationGate — §1.2/D18 R14, standalone", () => {
  // See cell-aggregation.ts's doc comment on this function: under the
  // formulas this module implements, `intensity` can never structurally
  // reach 10 (the 9.0 cap always applies first), so the gate is exercised
  // here directly against synthetic values rather than via `aggregateCell`.

  it("passes trivially when intensity < 10, regardless of corroboration", () => {
    expect(applyCorroborationGate(8.3, 0).corroborationGatePassed).toBe(true);
    expect(applyCorroborationGate(9.0, 0).corroborationGatePassed).toBe(true);
  });

  it("fails when intensity >= 10 and fewer than 3 reports are >= level 8", () => {
    expect(applyCorroborationGate(10, 0).corroborationGatePassed).toBe(false);
    expect(applyCorroborationGate(10, 2).corroborationGatePassed).toBe(false);
  });

  it("passes when intensity >= 10 AND the >=3-report/>=level-8 threshold is met", () => {
    expect(applyCorroborationGate(10, 3).corroborationGatePassed).toBe(true);
    expect(applyCorroborationGate(12, 5).corroborationGatePassed).toBe(true);
  });

  it("real aggregateCell output always has corroborationGatePassed=true (structural invariant, given the 9.0 cap)", () => {
    const outcome = aggregateCell([
      tier1("a", 12),
      tier1("b", 12),
      tier1("c", 12),
      tier1("d", 12),
      tier1("e", 12),
    ]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.cell.cdi).toBeLessThanOrEqual(9.0);
    expect(outcome.cell.corroborationGatePassed).toBe(true);
  });
});

describe("dedup edge cases", () => {
  it("multiple different devices are never merged", () => {
    const reports: AggregationInputReport[] = [tier1("a", 1), tier1("b", 1), tier1("c", 1)];
    const outcome = aggregateCell(reports);
    expect(outcome.ok && outcome.cell.nReports).toBe(3);
  });
});
