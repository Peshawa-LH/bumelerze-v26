import { nearestCities } from "@/features/geo/nearest";
import { VS30_GRID } from "@/features/handbook/data";
import { readHazard } from "@/features/handbook/hazard-source";
import { siteClassFromVs30 } from "@/features/handbook/site-class";
import { sampleVs30 } from "@/features/handbook/vs30-sample";

import {
  DAMAGE_INTENSITIES,
  DAMAGE_LOGIC,
  IMS_TYPES,
  TYPE_PRIORS,
  VULNERABILITY_CLASSES,
  imsType,
  type DamageGrade,
  type DamageQuantity,
  type ImsTypeProbs,
  type IntensityLevel,
  type StockRegion,
  type StockSettlement,
  type StoreyBand,
  type VcProbs,
  type VulnerabilityClass,
} from "./ims25";
import { isAnswered, visibleQuestions, type Answers } from "./questionnaire";

/**
 * "auto-v0": the automatic, layperson-questionnaire assessment of one home.
 * Pure and deterministic: the same answers and place give the same result.
 * Never a measurement; it turns a few answers into a probability
 * distribution over IMS-25 building types and vulnerability classes (VC).
 *
 * Rules (owner decisions, design draft rounds 1-2):
 *  - Block or fired-brick walls: confined by concrete belts and corner
 *    columns -> M7; otherwise M6 with a concrete slab, M5 with jack arches,
 *    wood or metal. "I don't know" splits 50/50 (belts) and 80/20 (slab).
 *  - Stone -> M3; M4 when an engineer designed it AND it is dressed stone
 *    (0.3 when either is unknown). Mud brick -> M2.
 *  - Concrete frame -> RC1-L; RC1-M 0.6 / RC1-L 0.4 only when an engineer
 *    designed it AND it is under about 25 years old. Never RC1-H.
 *  - Steel -> S-L; S-M/H only when engineered AND under about 25 years.
 *  - Wood -> T1.
 *  - Structure unknown -> the regional stock prior (region x settlement x
 *    storey band).
 */

export const METHOD = "auto-v0";

/** Share of M7 vs unconfined block/brick when belts are "I don't know". */
export const BELTS_DONT_KNOW_CONFINED = 0.5;
/** Share of concrete slab (M6) vs lighter floors (M5) when the roof is unknown. */
export const ROOF_DONT_KNOW_SLAB = 0.8;
/** Chance a building of unknown design was engineered (Erbil survey: ~45 % are not). */
export const ENGINEERED_DONT_KNOW = 0.55;
/** Chance a building of unknown age is under about 25 years old. */
export const NEW_DONT_KNOW = 0.5;
/** RC1-M share for an engineered building under about 25 years old. */
export const RC1_ENGINEERED_NEW_MODERATE = 0.6;
/** M4 share when it is not certain whether an engineer built dressed stone. */
export const STONE_UNSURE_M4 = 0.3;
/** Settlements within this distance of a gazetteer city are "urban". */
export const URBAN_RADIUS_KM = 10;
/** The VC range covers at least this much probability. */
export const VC_RANGE_COVERAGE = 0.8;
/** At most this many "more vulnerable" shifts are applied. */
export const MAX_VULNERABLE_SHIFTS = 2;

export interface AssessmentContext {
  region: StockRegion;
  settlement: StockSettlement;
}

export interface Hazard {
  /** ISC-2025 design PGA (g, 2475-year), null outside the mapped area. */
  pga_g: number | null;
  /** ISC-2025 zone band label. */
  zone: string | null;
  /** Vs30 in m/s from the bundled grid. */
  vs30: number | null;
  /** Eurocode 8 ground type derived from Vs30. */
  site_class: string | null;
  source: string;
}

export interface Assessment {
  method: typeof METHOD;
  ims_type_probs: ImsTypeProbs;
  vc_probs: VcProbs;
  vc_most_likely: VulnerabilityClass;
  /** "C" or "B-D": the smallest contiguous span covering at least 80 %. */
  vc_range: string;
  /** Answered structural questions over all structural questions, 0 to 1. */
  confidence: number;
  hazard: Hazard;
}

// ---------------------------------------------------------------------------
// Place
// ---------------------------------------------------------------------------

/** Region and settlement of a point, from the bundled gazetteer: the nearest
 * city decides Kurdistan Region vs the rest of Iraq, and being within 10 km
 * of one decides urban vs rural. */
export function contextForLocation(lat: number, lon: number): AssessmentContext {
  const nearest = nearestCities(lat, lon, 1)[0];
  if (!nearest) {
    return { region: "iraq", settlement: "rural" };
  }
  return {
    region: nearest.city.inKurdistanRegion ? "kurdistan" : "iraq",
    settlement: nearest.distanceKm <= URBAN_RADIUS_KM ? "urban" : "rural",
  };
}

export function storeyBand(floors: string | undefined): StoreyBand {
  switch (floors) {
    case "f1":
      return "1";
    case "f2":
      return "2";
    case "f3":
      return "3";
    case "f4_5":
      return "4-5";
    case "f6_10":
    case "f11p":
      return "6+";
    default:
      return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Type distribution
// ---------------------------------------------------------------------------

/** 1 / 0 when the builder answer says an engineer did / did not design it,
 * null when unknown. */
function engineeredKnown(answers: Answers): 1 | 0 | null {
  switch (answers.builder) {
    case "eng_full":
    case "eng_plans":
      return 1;
    case "builder":
    case "self":
      return 0;
    default:
      return null;
  }
}

function engineeredShare(answers: Answers): number {
  return engineeredKnown(answers) ?? ENGINEERED_DONT_KNOW;
}

function newShare(answers: Answers): number {
  switch (answers.age) {
    case "under10":
    case "a10_25":
      return 1;
    case "a25_50":
    case "over50":
      return 0;
    default:
      return NEW_DONT_KNOW;
  }
}

function normalize(probs: Record<string, number>): Record<string, number> {
  let total = 0;
  for (const value of Object.values(probs)) {
    total += value;
  }
  const result: Record<string, number> = {};
  if (total <= 0) {
    return result;
  }
  for (const [key, value] of Object.entries(probs)) {
    if (value > 0) {
      result[key] = value / total;
    }
  }
  return result;
}

function wallTypes(answers: Answers): Record<string, number> {
  const confined =
    answers.belts === "yes" ? 1 : answers.belts === "no" ? 0 : BELTS_DONT_KNOW_CONFINED;
  const slab =
    answers.roof === "slab"
      ? 1
      : answers.roof === "jack_arch" ||
          answers.roof === "wood" ||
          answers.roof === "metal"
        ? 0
        : ROOF_DONT_KNOW_SLAB;
  return {
    M7: confined,
    M6: (1 - confined) * slab,
    M5: (1 - confined) * (1 - slab),
  };
}

function stoneTypes(answers: Answers): Record<string, number> {
  const dressed = answers.stone === "dressed" ? 1 : answers.stone === "rough" ? 0 : null;
  const engineered = engineeredKnown(answers);
  let m4: number;
  if (dressed === 0 || engineered === 0) {
    m4 = 0;
  } else if (dressed === 1 && engineered === 1) {
    m4 = 1;
  } else {
    m4 = STONE_UNSURE_M4;
  }
  return { M3: 1 - m4, M4: m4 };
}

function frameTypes(answers: Answers): Record<string, number> {
  const moderate =
    RC1_ENGINEERED_NEW_MODERATE * engineeredShare(answers) * newShare(answers);
  return { "RC1-M": moderate, "RC1-L": 1 - moderate };
}

function steelTypes(answers: Answers): Record<string, number> {
  const midHigh = engineeredShare(answers) * newShare(answers);
  return { "S-M/H": midHigh, "S-L": 1 - midHigh };
}

function priorTypes(
  answers: Answers,
  context: AssessmentContext,
): Record<string, number> {
  const bands = TYPE_PRIORS[context.region][context.settlement];
  const prior = bands[storeyBand(answers.floors)] ?? bands.unknown;
  return normalize({ ...prior });
}

/** P(IMS-25 type) for the answers at a place; sums to 1. */
export function typeDistribution(
  answers: Answers,
  context: AssessmentContext,
): ImsTypeProbs {
  switch (answers.structure) {
    case "frame":
      return normalize(frameTypes(answers));
    case "block":
    case "brick":
      return normalize(wallTypes(answers));
    case "stone":
      return normalize(stoneTypes(answers));
    case "mud":
      return { M2: 1 };
    case "steel":
      return normalize(steelTypes(answers));
    case "wood":
      return { T1: 1 };
    default:
      return priorTypes(answers, context);
  }
}

// ---------------------------------------------------------------------------
// Vulnerability class
// ---------------------------------------------------------------------------

/** VC distribution as the type-weighted sum of the IMS-25 type priors. */
export function vcDistribution(typeProbs: ImsTypeProbs): VcProbs {
  const result: VcProbs = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
  for (const [type, probability] of Object.entries(typeProbs)) {
    const entry = imsType(type);
    if (!entry) {
      continue;
    }
    for (const vc of VULNERABILITY_CLASSES) {
      result[vc] += probability * entry.vc_prior[vc];
    }
  }
  return normalizeVc(result);
}

function normalizeVc(probs: VcProbs): VcProbs {
  const total = VULNERABILITY_CLASSES.reduce((sum, vc) => sum + probs[vc], 0);
  if (total <= 0) {
    return probs;
  }
  const result = { ...probs };
  for (const vc of VULNERABILITY_CLASSES) {
    result[vc] = probs[vc] / total;
  }
  return result;
}

/** Moves all probability mass `|steps|` classes along the A..F scale:
 * positive steps toward more vulnerable (A), negative toward less (F). The
 * end classes absorb what would fall off the scale. */
export function shiftVc(probs: VcProbs, steps: number): VcProbs {
  let current = { ...probs };
  const direction = steps > 0 ? -1 : 1;
  for (let i = 0; i < Math.abs(steps); i += 1) {
    const next: VcProbs = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
    VULNERABILITY_CLASSES.forEach((vc, index) => {
      const target = Math.min(5, Math.max(0, index + direction));
      const targetVc = VULNERABILITY_CLASSES[target] as VulnerabilityClass;
      next[targetVc] += current[vc];
    });
    current = next;
  }
  return current;
}

/** How many of the five "weaker building" signs the answers show. */
export function vulnerableSigns(answers: Answers): number {
  let count = 0;
  if (answers.added === "yes") count += 1;
  if (answers.openGround === "yes") count += 1;
  if (answers.shape === "irregular" || answers.shape === "overhang") count += 1;
  if (answers.cracks === "large") count += 1;
  if (answers.pastDamage === "heavy") count += 1;
  return count;
}

/** An engineer designed AND supervised it, or strengthened it. One shift at
 * most, never two. */
export function hasEngineerBenefit(answers: Answers): boolean {
  return answers.builder === "eng_full" || answers.strengthened === "strengthening";
}

/** Net class shift: +1 per sign (at most 2) toward more vulnerable, minus 1
 * for the engineer benefit. */
export function netShift(answers: Answers): number {
  const up = Math.min(vulnerableSigns(answers), MAX_VULNERABLE_SHIFTS);
  return up - (hasEngineerBenefit(answers) ? 1 : 0);
}

export function mostLikelyVc(probs: VcProbs): VulnerabilityClass {
  let best: VulnerabilityClass = "A";
  for (const vc of VULNERABILITY_CLASSES) {
    // Strictly greater: a tie keeps the more vulnerable class.
    if (probs[vc] > probs[best] + 1e-12) {
      best = vc;
    }
  }
  return best;
}

/** Smallest contiguous class span covering at least 80 %; among equally
 * short spans the one with the most probability. */
export function vcRange(probs: VcProbs): {
  from: VulnerabilityClass;
  to: VulnerabilityClass;
} {
  let best = { from: 0, to: 5, mass: -1 };
  let bestLength = 7;
  for (let from = 0; from < 6; from += 1) {
    let mass = 0;
    for (let to = from; to < 6; to += 1) {
      mass += probs[VULNERABILITY_CLASSES[to] as VulnerabilityClass];
      if (mass >= VC_RANGE_COVERAGE - 1e-9) {
        const length = to - from + 1;
        if (length < bestLength || (length === bestLength && mass > best.mass)) {
          best = { from, to, mass };
          bestLength = length;
        }
        break;
      }
    }
  }
  return {
    from: VULNERABILITY_CLASSES[best.from] as VulnerabilityClass,
    to: VULNERABILITY_CLASSES[best.to] as VulnerabilityClass,
  };
}

export function formatVcRange(range: {
  from: VulnerabilityClass;
  to: VulnerabilityClass;
}): string {
  return range.from === range.to ? range.from : `${range.from}-${range.to}`;
}

/** The two ends of a stored range string ("C", "B-D"). */
export function parseVcRange(
  value: string | null | undefined,
): { from: VulnerabilityClass; to: VulnerabilityClass } | null {
  if (!value) {
    return null;
  }
  const match = /^([A-F])(?:-([A-F]))?$/.exec(value);
  if (!match) {
    return null;
  }
  const from = match[1] as VulnerabilityClass;
  const to = (match[2] ?? match[1]) as VulnerabilityClass;
  return { from, to };
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/** Answered structural questions over all structural questions that apply to
 * these answers. */
export function confidence(answers: Answers): number {
  const structural = visibleQuestions(answers).filter((question) => question.structural);
  if (structural.length === 0) {
    return 0;
  }
  const answered = structural.filter((question) =>
    isAnswered(answers, question.id),
  ).length;
  return answered / structural.length;
}

// ---------------------------------------------------------------------------
// Hazard
// ---------------------------------------------------------------------------

export const HAZARD_SOURCE_LABEL = "ISC-2025";

/** Design PGA, zone, Vs30 and site class at a point, from the engineering
 * handbook's bundled data. Null fields outside the mapped area. */
export function siteHazard(lat: number, lon: number): Hazard {
  const reading = readHazard("isc2025", lat, lon);
  const vs30 = sampleVs30(VS30_GRID, lat, lon);
  return {
    pga_g: reading.values ? reading.values.pga2475 : null,
    zone: reading.zoneLabel,
    vs30: vs30 === null ? null : Math.round(vs30),
    site_class: vs30 === null ? null : siteClassFromVs30(vs30).ec8,
    source: HAZARD_SOURCE_LABEL,
  };
}

// ---------------------------------------------------------------------------
// Whole assessment
// ---------------------------------------------------------------------------

function roundProbs<T extends Record<string, number>>(probs: T, keepZeros: boolean): T {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(probs)) {
    const rounded = Math.round(value * 10_000) / 10_000;
    if (rounded > 0 || keepZeros) {
      result[key] = rounded;
    }
  }
  return result as T;
}

/** Everything except the hazard: the part that depends only on the answers
 * and on region/settlement. */
export function assessAnswers(
  answers: Answers,
  context: AssessmentContext,
): Omit<Assessment, "hazard"> {
  const types = typeDistribution(answers, context);
  const shift = netShift(answers);
  const vc = normalizeVc(shiftVc(vcDistribution(types), shift));
  return {
    method: METHOD,
    ims_type_probs: roundProbs(types, false),
    vc_probs: roundProbs(vc, true),
    vc_most_likely: mostLikelyVc(vc),
    vc_range: formatVcRange(vcRange(vc)),
    confidence: Math.round(confidence(answers) * 1000) / 1000,
  };
}

/** The full automatic assessment of a home at (lat, lon). */
export function assessBuilding(answers: Answers, lat: number, lon: number): Assessment {
  return {
    ...assessAnswers(answers, contextForLocation(lat, lon)),
    hazard: siteHazard(lat, lon),
  };
}

// ---------------------------------------------------------------------------
// Expected damage
// ---------------------------------------------------------------------------

export interface ExpectedDamage {
  grade: DamageGrade;
  quantity: DamageQuantity;
}

function isQuantity(value: string | undefined): value is DamageQuantity {
  return value === "few" || value === "many" || value === "most";
}

/** IMS-25 damage logic for one class at one intensity: which damage grades
 * to expect and in how many buildings. Empty when none is expected. */
export function expectedDamage(
  vc: VulnerabilityClass,
  intensity: IntensityLevel,
): ExpectedDamage[] {
  const row = DAMAGE_LOGIC[intensity]?.[vc];
  if (!row) {
    return [];
  }
  const result: ExpectedDamage[] = [];
  for (const grade of [1, 2, 3, 4, 5] as const) {
    const quantity = row[`DG${grade}`];
    if (isQuantity(quantity)) {
      result.push({ grade, quantity });
    }
  }
  return result;
}

export function expectedDamageTable(
  vc: VulnerabilityClass,
): { intensity: IntensityLevel; damage: ExpectedDamage[] }[] {
  return DAMAGE_INTENSITIES.map((intensity) => ({
    intensity,
    damage: expectedDamage(vc, intensity),
  }));
}

// ---------------------------------------------------------------------------
// Plain words for types, and improvement tips
// ---------------------------------------------------------------------------

export type TypeFamily = "masonry" | "rc" | "other";

export function typeFamily(type: string): TypeFamily {
  if (type.startsWith("M")) return "masonry";
  if (type.startsWith("RC")) return "rc";
  return "other";
}

/** Key (under `building.types`) of the plain-language description of a type. */
export function plainTypeKey(type: string): string {
  if (type === "M1" || type === "M2" || type === "M3" || type === "M4") return type;
  if (type === "M5" || type === "M6" || type === "M7") return type;
  if (type === "RC4") return "RC4";
  if (type.startsWith("RC5") || type.startsWith("RC6")) return "RCprecast";
  if (type.startsWith("RC")) return "RCframe";
  if (type.startsWith("S")) return "steel";
  if (type.startsWith("T")) return "timber";
  return "other";
}

/** Types by probability, highest first; ties keep the more vulnerable (the
 * type table order). */
export function rankedTypes(
  typeProbs: ImsTypeProbs,
): { type: string; probability: number }[] {
  const order = new Map(IMS_TYPES.map((entry, index) => [entry.type, index]));
  return Object.entries(typeProbs)
    .filter(([, probability]) => probability > 0)
    .map(([type, probability]) => ({ type, probability }))
    .sort(
      (a, b) =>
        b.probability - a.probability ||
        (order.get(a.type) ?? 99) - (order.get(b.type) ?? 99),
    );
}

export function dominantFamily(typeProbs: ImsTypeProbs): TypeFamily {
  const totals: Record<TypeFamily, number> = { masonry: 0, rc: 0, other: 0 };
  for (const [type, probability] of Object.entries(typeProbs)) {
    totals[typeFamily(type)] += probability;
  }
  let best: TypeFamily = "masonry";
  for (const family of ["masonry", "rc", "other"] as const) {
    if (totals[family] > totals[best] + 1e-12) {
      best = family;
    }
  }
  return best;
}

/** Three short, generic, safe improvement tips for the dominant family, as
 * locale keys. */
export function improvementTips(typeProbs: ImsTypeProbs): string[] {
  const family = dominantFamily(typeProbs);
  return [1, 2, 3].map((n) => `building.tips.${family}.${n}`);
}
