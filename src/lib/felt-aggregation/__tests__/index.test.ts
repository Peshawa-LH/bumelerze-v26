import { aggregateCell, encodeGeohash, scoreTier2Report } from "../index";
import { EMPTY_TIER2_ANSWERS } from "@/features/felt/types";

/** Smoke test for the public barrel — guards against a re-export typo
 * silently breaking the module's only public surface. Not a re-test of the
 * underlying logic (covered exhaustively in the other __tests__ files). */
describe("felt-aggregation barrel", () => {
  it("re-exports the geohash encoder", () => {
    expect(encodeGeohash(35.56, 45.43, 5)).toBe("tn263");
  });

  it("re-exports the per-report scorer", () => {
    expect(scoreTier2Report({ ...EMPTY_TIER2_ANSWERS, felt: "yes" }).felt).toBe(1);
  });

  it("re-exports the cell aggregator", () => {
    const outcome = aggregateCell([]);
    expect(outcome).toEqual({ ok: false, reason: "no_reports" });
  });
});
