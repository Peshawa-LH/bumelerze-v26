/**
 * §3.2/§3.3 aggregation algorithm — the exact per-cell CDI computation,
 * verbatim from felt-report-science-v1.md (as amended by PART 5).
 *
 * See `types.ts` for the portability constraint (no RN/Expo imports here).
 */

import { CARTOON_TO_INTENSITY, scoreTier2Report } from "./cdi-scoring";
import type {
  AggregateCellOutcome,
  AggregationInputReport,
  IndexMeans,
  Tier1InputReport,
  Tier2InputReport,
} from "./types";

/** §2.1 CWS weights, verbatim from DYFI v4 `cdiWeights`. Every index's max
 * mean is 1 except `damage` (range 0-3), so max weighted contributions are
 * felt 5, motion 1, reaction 1, stand 2, shelf 5, picture 2, furniture 3,
 * damage 5*3=15 — documented max CWS = 5+1+1+2+5+2+3+15 = 42 (§2.1). */
export const CDI_WEIGHTS: Record<keyof IndexMeans, number> = {
  felt: 5,
  motion: 1,
  reaction: 1,
  stand: 2,
  shelf: 5,
  picture: 2,
  furniture: 3,
  damage: 5,
};

const INDEX_KEYS = Object.keys(CDI_WEIGHTS) as readonly (keyof IndexMeans)[];

/** Arithmetic mean over non-null values; `null` (not 0) when the list is
 * empty — §3.2 step 1: "Indices with no value are not counted. They DO NOT
 * have zero value!" This is the single choke point that rule flows through:
 * every mean in this module is computed via this function. */
function meanOf(values: readonly (number | null)[]): number | null {
  const answered = values.filter((v): v is number => v !== null);
  if (answered.length === 0) {
    return null;
  }
  return answered.reduce((sum, v) => sum + v, 0) / answered.length;
}

/** §3.2 step 1: per-question consensus mean over all tier-2 reports that
 * answered that question. */
export function computeIndexMeans(tier2Reports: readonly Tier2InputReport[]): IndexMeans {
  const scored = tier2Reports.map((r) => scoreTier2Report(r.answers));
  return {
    felt: meanOf(scored.map((s) => s.felt)),
    motion: meanOf(scored.map((s) => s.motion)),
    reaction: meanOf(scored.map((s) => s.reaction)),
    stand: meanOf(scored.map((s) => s.stand)),
    shelf: meanOf(scored.map((s) => s.shelf)),
    picture: meanOf(scored.map((s) => s.picture)),
    furniture: meanOf(scored.map((s) => s.furniture)),
    damage: meanOf(scored.map((s) => s.damage)),
  };
}

/**
 * §3.2 step 2: CWS = Σ(mean_index × weight). An index with no answering
 * reports (`mean === null`) contributes nothing to the sum — mathematically
 * identical to a 0 contribution here (the null-exclusion rule lives in
 * `meanOf` above, at the per-index denominator; by the time we're summing
 * weighted means, "no data" and "0 contribution to the total" coincide).
 */
export function computeCWS(means: IndexMeans): number {
  let total = 0;
  for (const key of INDEX_KEYS) {
    const mean = means[key];
    if (mean !== null) {
      total += mean * CDI_WEIGHTS[key];
    }
  }
  return total;
}

function roundToTenth(x: number): number {
  return Math.round((x + Number.EPSILON) * 10) / 10;
}

/**
 * §3.2 step 3, floor/cap/round, literal: floor anything < 2 up to 2.0 (no
 * lower bound carve-out — matches the science pack's exact wording, "floor:
 * if CDI < 2 → CDI = 2.0"), cap at 9.0, round to 0.1. Used only inside
 * `cdiFromCWS`'s "else" branch below, where the CWS<=0 sentinel has already
 * been handled by an earlier, separate terminal return and can never reach
 * this function — so there is no 1.0 to protect here: any raw formula
 * output < 2 in that branch genuinely means "some evidence of feeling, but
 * weak", and floors to 2.0 with no exception.
 */
function floorCapRound(x: number): number {
  const floored = x < 2 ? 2.0 : x;
  const capped = Math.min(floored, 9.0);
  return roundToTenth(capped);
}

/**
 * §3.3's "then apply the §3.2 floor/cap/rounding" re-application to the
 * COMBINED I_cell value — distinct from `floorCapRound` above because here
 * an input of exactly 1.0 CAN legitimately mean "every constituent value
 * (CDI2 and/or Ibar1) was itself exactly 1.0", i.e. unanimous "not felt"
 * (CDI2 only ever equals exactly 1.0 via the CWS<=0 sentinel — `cdiFromCWS`
 * never returns a value in (0, 2) otherwise; Ibar1's minimum possible value
 * is 1.0, the cartoon-1 "not felt" pick). A weighted mean of values >= 1.0
 * cannot go below 1.0, so it lands on exactly 1.0 only when every input
 * was 1.0 — re-flooring that to 2.0 would incorrectly claim "some
 * corroborating evidence of feeling" where there was none. Anything
 * strictly above 1.0 (mixed evidence) still floors normally at the 2.0
 * boundary. This is a documented reading, not a literal transcription — the
 * wave brief's one-line paraphrase ("floor 2.0 when 0<CDI<2") numerically
 * includes 1.0, but the brief's own golden-test list ("single not-felt
 * report -> 1.0") requires 1.0 to survive untouched, which only the
 * open-interval reading satisfies.
 */
function combineFloorCapRound(x: number): number {
  if (x <= 1.0) {
    return 1.0;
  }
  return floorCapRound(x);
}

/**
 * §3.2 steps 2-3: CWS -> CDI.
 *   - CWS <= 0 -> CDI = 1.0 ("not felt"; terminal, bypasses the floor below)
 *   - else CDI = 3.3996 * ln(CWS) - 4.3781 (verbatim `cdi.py` constants)
 *   - floor: CDI < 2 -> 2.0 ("felt-but-weak floor", verbatim in code)
 *   - cap: CDI = min(CDI, 9.0) (D18 R11)
 *   - round to 0.1
 */
export function cdiFromCWS(cws: number): number {
  if (cws <= 0) {
    return 1.0;
  }
  const raw = 3.3996 * Math.log(cws) - 4.3781;
  return floorCapRound(raw);
}

/** §3.3: cartoon(1-12) -> CDI-path intensity, trimmed mean when n >= 5
 * (drop exactly one min and one max, by sorted position — not "all
 * instances of the extreme value"). Returns `null` for an empty list. */
export function trimmedMeanIntensity(
  cartoonLevels: readonly Tier1InputReport["cartoonLevel"][],
): number | null {
  if (cartoonLevels.length === 0) {
    return null;
  }
  const values = cartoonLevels.map((level) => CARTOON_TO_INTENSITY[level]).sort((a, b) => a - b);
  const sample = values.length >= 5 ? values.slice(1, -1) : values;
  return meanOf(sample);
}

/**
 * Corroboration gate (§1.2 point 2, D18 R14): "a cell never displays an
 * intensity >= 10 unless the >=3-report threshold is met by reports >= 8."
 *
 * AMBIGUITY FLAG (documented in the wave's final report, not just here):
 * §3.2/§3.3's floor/cap/round pipeline caps every CDI/I_cell value at 9.0
 * — including the identity cartoon table (§3.3), which itself caps levels
 * 10-12 at 9.0 before the trimmed mean ever runs. So under the formulas
 * this module implements, `intensity` can structurally never reach 10, and
 * this gate is inert on that value today. It is implemented faithfully to
 * the letter of R14 anyway (verified directly via `highLevelReportCount`
 * evidence, independent of the capped `intensity`), because (a) the brief
 * asks for it explicitly as a `displayIntensity` output field, and (b) the
 * gate's evidence-counting logic is exactly what a future uncapped
 * intensity value (most likely `ems_int`, §3.4, out of scope this wave)
 * will need — this function is written to be reusable then, not just
 * decorative now. `highLevelReportCount` counts RAW per-report levels >= 8
 * (tier-1 `cartoonLevel`, or a tier-2 report's optional carried-over
 * `cartoonLevel` — see `Tier2InputReport.cartoonLevel`'s doc comment in
 * `types.ts`), not the post-table CDI-path value.
 */
export function applyCorroborationGate(
  intensity: number,
  highLevelReportCount: number,
): { displayIntensity: number; corroborationGatePassed: boolean } {
  const needsCorroboration = intensity >= 10;
  const corroborationGatePassed = !needsCorroboration || highLevelReportCount >= 3;
  return {
    corroborationGatePassed,
    // No natural fallback value is specified for a failed gate (the
    // parallel n_reports>=3 threshold's "no color" behavior is the closest
    // precedent) — see this file's exported `aggregateCell`, which turns
    // this into `null` at the `meetsDisplayThreshold`/gate boundary rather
    // than inventing a substitute number here.
    displayIntensity: intensity,
  };
}

function isTier1(r: AggregationInputReport): r is Tier1InputReport {
  return r.tier === "tier1";
}
function isTier2(r: AggregationInputReport): r is Tier2InputReport {
  return r.tier === "tier2";
}

/**
 * §3.2 step 1: "one report per device ID per event; a tier-2 submission
 * supersedes — not adds to — that device's tier-1 record." Deterministic:
 * iterates input order, a tier-2 report always overrides any tier-1 (or
 * earlier tier-2) report already recorded for that device.
 */
function dedupeByDevice(
  reports: readonly AggregationInputReport[],
): readonly AggregationInputReport[] {
  const byDevice = new Map<string, AggregationInputReport>();
  for (const report of reports) {
    const existing = byDevice.get(report.deviceId);
    if (!existing || (existing.tier === "tier1" && report.tier === "tier2")) {
      byDevice.set(report.deviceId, report);
    }
  }
  return Array.from(byDevice.values());
}

/**
 * Aggregates a pre-filtered list of reports (all belonging to one event +
 * one geohash cell) into a `FeltCellAggregate`, implementing
 * felt-report-science-v1.md §3.2 (tier-2 CDI path), §3.3 (tier-1-only path
 * and the count-weighted combination), §1.2/D18-R14 (corroboration gate).
 */
export function aggregateCell(reports: readonly AggregationInputReport[]): AggregateCellOutcome {
  const deduped = dedupeByDevice(reports);
  if (deduped.length === 0) {
    return { ok: false, reason: "no_reports" };
  }

  const tier2Reports = deduped.filter(isTier2);
  const tier1Reports = deduped.filter(isTier1);
  const n2 = tier2Reports.length;
  const n1 = tier1Reports.length;

  const indexMeans: IndexMeans =
    n2 > 0
      ? computeIndexMeans(tier2Reports)
      : {
          felt: null,
          motion: null,
          reaction: null,
          stand: null,
          shelf: null,
          picture: null,
          furniture: null,
          damage: null,
        };
  const cws = n2 > 0 ? computeCWS(indexMeans) : null;
  const cdi2 = cws !== null ? cdiFromCWS(cws) : null;

  const ibar1 = trimmedMeanIntensity(tier1Reports.map((r) => r.cartoonLevel));

  // §3.3: I_cell = (n2*CDI2 + n1*Ibar1) / (n2+n1), then floor/cap/round
  // again. n2===0 reduces to Ibar1 (pure tier-1 cell); n1===0 reduces to
  // CDI2 (pure tier-2 cell — the re-application is then idempotent, see
  // `combineFloorCapRound`'s doc comment for why the 1.0 sentinel still
  // survives it).
  let combined: number;
  if (n2 > 0 && n1 > 0 && cdi2 !== null && ibar1 !== null) {
    combined = (n2 * cdi2 + n1 * ibar1) / (n2 + n1);
  } else if (n2 > 0 && cdi2 !== null) {
    combined = cdi2;
  } else if (ibar1 !== null) {
    combined = ibar1;
  } else {
    // Unreachable: deduped.length > 0 guarantees n1 + n2 > 0, so either
    // cdi2 or ibar1 must be non-null. Kept as an explicit branch (rather
    // than a non-null assertion) so the type checker — not a runtime
    // assumption — proves `combined` is always assigned.
    return { ok: false, reason: "no_reports" };
  }

  const intensity = combineFloorCapRound(combined);
  const nReports = deduped.length;
  const meetsDisplayThreshold = nReports >= 3;

  const highLevelReportCount =
    tier1Reports.filter((r) => r.cartoonLevel >= 8).length +
    tier2Reports.filter((r) => r.cartoonLevel !== undefined && r.cartoonLevel >= 8).length;
  const gate = applyCorroborationGate(intensity, highLevelReportCount);

  return {
    ok: true,
    cell: {
      nReports,
      nTier2: n2,
      cdi: intensity,
      cws,
      indexMeans,
      meetsDisplayThreshold,
      displayIntensity:
        meetsDisplayThreshold && gate.corroborationGatePassed ? gate.displayIntensity : null,
      corroborationGatePassed: gate.corroborationGatePassed,
    },
  };
}
