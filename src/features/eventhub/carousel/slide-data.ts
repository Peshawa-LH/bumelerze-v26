import type { RiskSummary } from "@/features/shakemap/types";

/** IMS-25 vulnerability classes, A the most vulnerable. */
export const VULNERABILITY_CLASSES = ["A", "B", "C", "D", "E", "F"] as const;
export type VulnerabilityClassLetter = (typeof VULNERABILITY_CLASSES)[number];

export interface ClassDamageRow {
  vulnerabilityClass: VulnerabilityClassLetter;
  buildings: number;
  /** Share (0..1) of the class's buildings at DG1..DG5, index 0 = DG1. */
  shares: [number, number, number, number, number];
  /** Share (0..1) at DG4 or worse. */
  dg4Plus: number;
}

/**
 * "Damage by building class": the damage estimate's per-type DG0..DG5 counts
 * summed per vulnerability class through the product's own type catalogue.
 * Empty when the run does not carry per-type grades (every product published
 * before schema 2), so the slide simply does not appear.
 */
export function buildClassDamage(summary: RiskSummary | null): ClassDamageRow[] {
  if (!summary?.buildingsByType || !summary.typeCatalog) {
    return [];
  }
  const totals = new Map<VulnerabilityClassLetter, number[]>();
  for (const type of summary.buildingsByType) {
    const grades = type.buildingsByGrade;
    const letter = summary.typeCatalog[type.code]?.vulnerabilityClass?.toUpperCase();
    const vc = VULNERABILITY_CLASSES.find((candidate) => candidate === letter);
    if (!vc || !grades || grades.length !== 6) {
      continue;
    }
    const sum = totals.get(vc) ?? [0, 0, 0, 0, 0, 0];
    grades.forEach((count, grade) => {
      sum[grade] = (sum[grade] ?? 0) + Math.max(0, count);
    });
    totals.set(vc, sum);
  }
  const rows: ClassDamageRow[] = [];
  for (const vc of VULNERABILITY_CLASSES) {
    const sum = totals.get(vc);
    const buildings = sum ? sum.reduce((a, b) => a + b, 0) : 0;
    if (!sum || buildings <= 0) {
      continue;
    }
    const share = (grade: number) => (sum[grade] ?? 0) / buildings;
    rows.push({
      vulnerabilityClass: vc,
      buildings,
      shares: [share(1), share(2), share(3), share(4), share(5)],
      dg4Plus: share(4) + share(5),
    });
  }
  return rows;
}

/** Running total of hourly counts (the line over the bars). */
export function runningTotal(hours: readonly number[]): number[] {
  const out: number[] = [];
  let sum = 0;
  for (const value of hours) {
    sum += value;
    out.push(sum);
  }
  return out;
}

/** A share as whole percent text: "<1" for a share above zero that rounds to
 * nothing, otherwise the rounded number (digits are localized by the caller). */
export function percentValue(share: number): string {
  if (share > 0 && share < 0.005) {
    return "<1";
  }
  return String(Math.round(share * 100));
}
