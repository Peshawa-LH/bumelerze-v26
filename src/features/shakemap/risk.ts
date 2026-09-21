import { z } from "zod";

import { ATLAS_BASE_URL } from "./config";
import { damageValueToLevel } from "./damage-ramp";
import { extractContourLevels } from "./contours";
import type {
  DamageContourLevel,
  DamageContourSet,
  RiskArea,
  RiskAreaLevel,
  RiskAreas,
  RiskBuildingTypeDamage,
  RiskDistrict,
  RiskDistricts,
  RiskProduct,
  RiskPopulationByIntensity,
  RiskSummary,
  RiskTimeOfDay,
  RiskTypeCatalog,
} from "./types";

/**
 * Tolerant zod parsers for the risk-chain artifacts (D46, `risk-dashboard`
 * wave; `areas.json` added in the `risk-areas` wave) a `shakemap_products`
 * version can optionally carry alongside its intensity `contours`:
 * `risk_summary.json`, `districts.json`, `cont_damage.json`, `areas.json`.
 * Same "never trust blindly, parse
 * once at the resolve boundary" discipline `contours.ts` already
 * establishes for the always-present intensity product — every parser
 * here returns `null` (never throws) for a missing/malformed payload,
 * because a risk product is always an ENHANCEMENT on top of the
 * always-present intensity map, never allowed to break or block it
 * (`resolver.ts`/`live-transport.ts` both rely on this).
 *
 * Deliberately does not model any fatality/injury field (D45: "casualty
 * estimates are computed but not published") — even if a future product
 * version added one, there is no slot in `RiskSummary` for it to land in,
 * so it would simply be dropped by zod's default "strip unknown keys"
 * behavior, never surfaced.
 */

const timeOfDaySchema = z.enum(["day", "night", "transit"]);

const triple = z.tuple([z.number(), z.number(), z.number()]);

// ---------------------------------------------------------------------------
// Product schema 2 (2026-09-21): the damage dashboard's own data
// ---------------------------------------------------------------------------
//
// Every one of these is optional and parses to `null` when absent, because
// every version published before the Atlas is recomputed lacks them and
// must keep rendering exactly as it does today.

const typeDamagePayloadSchema = z.object({
  code: z.string(),
  buildings: z.number(),
  buildings_heavy: z.number(),
  share_heavy: z.number(),
  buildings_by_grade: z.array(z.number()).optional(),
});

const typeCatalogPayloadSchema = z.record(
  z.string(),
  z.object({
    group: z.string(),
    description: z.string(),
    vulnerability_class: z.string(),
  }),
);

/** Intensity degrees arrive as object KEYS, so they are strings in JSON
 * and numbers everywhere in the app. Anything that is not a whole degree
 * in 1..12 is dropped rather than shown in a band the legend has no
 * colour for. */
const populationByIntensityPayloadSchema = z.record(z.string(), z.number());

function parseTypeDamage(
  rows: readonly z.infer<typeof typeDamagePayloadSchema>[] | undefined,
): RiskBuildingTypeDamage[] | null {
  if (!rows || rows.length === 0) {
    return null;
  }
  return rows.map((r) => ({
    code: r.code,
    buildings: r.buildings,
    buildingsHeavy: r.buildings_heavy,
    shareHeavy: r.share_heavy,
    buildingsByGrade: r.buildings_by_grade ?? null,
  }));
}

function parseTypeCatalog(
  raw: z.infer<typeof typeCatalogPayloadSchema> | undefined,
): RiskTypeCatalog | null {
  if (!raw) {
    return null;
  }
  const out: Record<string, { group: string; description: string; vulnerabilityClass: string }> = {};
  for (const [code, v] of Object.entries(raw)) {
    out[code] = {
      group: v.group,
      description: v.description,
      vulnerabilityClass: v.vulnerability_class,
    };
  }
  return out;
}

function parsePopulationByIntensity(
  raw: Record<string, number> | undefined,
): RiskPopulationByIntensity | null {
  if (!raw) {
    return null;
  }
  const out: Record<number, number> = {};
  for (const [degree, people] of Object.entries(raw)) {
    const d = Number(degree);
    if (Number.isInteger(d) && d >= 1 && d <= 12 && people > 0) {
      out[d] = people;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ---------------------------------------------------------------------------
// risk_summary.json
// ---------------------------------------------------------------------------

const riskSummaryPayloadSchema = z.object({
  generated_at: z.string(),
  stage: z.string(),
  time_of_day: timeOfDaySchema,
  n_draws: z.number(),
  hazard_version: z
    .object({
      conditioning: z.string().nullable().optional(),
    })
    .partial()
    .optional(),
  exposure: z.object({
    buildings_in_grid: z.number(),
    countries: z.array(z.string()).optional(),
  }),
  buildings_heavy: z.number(),
  buildings_heavy_p05_p50_p95: triple,
  exposed_population: z.number(),
  casualties_published: z.boolean().optional(),
  buildings_by_grade: z.array(z.number()).optional(),
  buildings_by_type: z.array(typeDamagePayloadSchema).optional(),
  type_catalog: typeCatalogPayloadSchema.optional(),
  population_by_intensity_band: populationByIntensityPayloadSchema.optional(),
});

/** Parses `risk_summary.json` (already fetched) into `RiskSummary`, or
 * `null` for a missing/malformed payload. */
export function parseRiskSummary(payload: unknown): RiskSummary | null {
  const parsed = riskSummaryPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  const d = parsed.data;
  return {
    generatedAt: d.generated_at,
    stage: d.stage,
    timeOfDay: d.time_of_day as RiskTimeOfDay,
    nDraws: d.n_draws,
    hazardVersionConditioning: d.hazard_version?.conditioning ?? null,
    exposure: {
      buildingsInGrid: d.exposure.buildings_in_grid,
      countries: d.exposure.countries ?? [],
    },
    buildingsHeavy: d.buildings_heavy,
    buildingsHeavyP05P50P95: d.buildings_heavy_p05_p50_p95,
    exposedPopulation: d.exposed_population,
    casualtiesPublished: d.casualties_published ?? false,
    buildingsByGrade: d.buildings_by_grade ?? null,
    buildingsByType: parseTypeDamage(d.buildings_by_type),
    typeCatalog: parseTypeCatalog(d.type_catalog),
    populationByIntensity: parsePopulationByIntensity(d.population_by_intensity_band),
  };
}

// ---------------------------------------------------------------------------
// districts.json
// ---------------------------------------------------------------------------

const riskDistrictPayloadSchema = z.object({
  adm1_id: z.string(),
  adm1_name: z.string(),
  country: z.string(),
  coverage: z.number(),
  buildings_in_grid: z.number(),
  buildings_heavy: z.number(),
  buildings_dg4plus: z.number(),
  buildings_heavy_p05_p50_p95: triple,
  buildings_dg4plus_p05_p50_p95: triple,
  exposed_population: z.number(),
});

const riskDistrictsPayloadSchema = z.object({
  stage: z.string(),
  time_of_day: timeOfDaySchema,
  n_draws: z.number(),
  districts: z.array(z.unknown()),
});

/**
 * Parses `districts.json` (already fetched) into `RiskDistricts`, or
 * `null` for a top-level shape that isn't even the expected object.
 * Individual malformed district rows are tolerated (skipped and counted),
 * same per-item convention `contours.ts` uses for individual malformed
 * contour features — one bad row must never discard the other 29.
 * Producer order (worst-first) is preserved, never re-sorted.
 */
export function parseRiskDistricts(payload: unknown): RiskDistricts | null {
  const parsed = riskDistrictsPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }

  const districts: RiskDistrict[] = [];
  let skippedCount = 0;
  for (const raw of parsed.data.districts) {
    const item = riskDistrictPayloadSchema.safeParse(raw);
    if (!item.success) {
      skippedCount += 1;
      continue;
    }
    const d = item.data;
    districts.push({
      adm1Id: d.adm1_id,
      adm1Name: d.adm1_name,
      country: d.country,
      coverage: d.coverage,
      buildingsInGrid: d.buildings_in_grid,
      buildingsHeavy: d.buildings_heavy,
      buildingsDg4Plus: d.buildings_dg4plus,
      buildingsHeavyP05P50P95: d.buildings_heavy_p05_p50_p95,
      buildingsDg4PlusP05P50P95: d.buildings_dg4plus_p05_p50_p95,
      exposedPopulation: d.exposed_population,
    });
  }

  return {
    stage: parsed.data.stage,
    timeOfDay: parsed.data.time_of_day as RiskTimeOfDay,
    nDraws: parsed.data.n_draws,
    districts,
    skippedCount,
  };
}

// ---------------------------------------------------------------------------
// areas.json
// ---------------------------------------------------------------------------

const riskAreaLevelSchema = z.enum(["governorate", "district", "subdistrict", "city"]);

/** Fixed level order — the single place every parser/component that needs
 * to iterate all four levels gets it from, so it can never re-diverge
 * between `parseRiskAreas` and, say, `RiskAreaList`'s own level switch. */
export const RISK_AREA_LEVELS: readonly RiskAreaLevel[] = [
  "governorate",
  "district",
  "subdistrict",
  "city",
];

const riskAreaPayloadSchema = z.object({
  id: z.string(),
  name: z.string(),
  level: riskAreaLevelSchema,
  parent_id: z.string().nullable(),
  coverage: z.number(),
  buildings_in_grid: z.number(),
  buildings_heavy: z.number(),
  buildings_dg4plus: z.number(),
  // Absent when the product's own `n_draws` is 0 (`types.ts`'s
  // `RiskArea.buildingsHeavyP05P50P95` doc comment) — optional, never
  // defaulted to a fabricated triple.
  buildings_heavy_p05_p50_p95: triple.optional(),
  buildings_dg4plus_p05_p50_p95: triple.optional(),
  exposed_population: z.number(),
  names: z.record(z.string(), z.string()).optional(),
  name_verified: z.boolean().optional(),
  buildings_by_grade: z.array(z.number()).optional(),
  // Governorate rows carry the full 26-type matrix under
  // `buildings_by_type`; everything below carries its three most damaged
  // types under `top_damaged_types`. One field here, either source.
  buildings_by_type: z.array(typeDamagePayloadSchema).optional(),
  top_damaged_types: z.array(typeDamagePayloadSchema).optional(),
  population_by_intensity_band: populationByIntensityPayloadSchema.optional(),
});

const riskAreasLevelsPayloadSchema = z.object({
  governorate: z.array(z.unknown()).optional(),
  district: z.array(z.unknown()).optional(),
  subdistrict: z.array(z.unknown()).optional(),
  city: z.array(z.unknown()).optional(),
});

const riskAreasPayloadSchema = z.object({
  damage_model: z.string(),
  time_of_day: timeOfDaySchema,
  n_draws: z.number(),
  levels: riskAreasLevelsPayloadSchema,
  type_catalog: typeCatalogPayloadSchema.optional(),
});

/**
 * Parses `areas.json` (already fetched) into `RiskAreas`, or `null` for a
 * top-level shape that isn't even the expected object — same tolerant,
 * per-row-skipping discipline `parseRiskDistricts` already establishes,
 * extended across four independent level buckets instead of one flat
 * array. A level key missing from the payload entirely is treated as an
 * empty list for that level (never a reason to reject the whole product);
 * `skippedCount` is summed across all four levels. Producer order
 * (worst-first, per level) is preserved, never re-sorted.
 */
export function parseRiskAreas(payload: unknown): RiskAreas | null {
  const parsed = riskAreasPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }

  const levels: Record<RiskAreaLevel, RiskArea[]> = {
    governorate: [],
    district: [],
    subdistrict: [],
    city: [],
  };
  let skippedCount = 0;

  for (const level of RISK_AREA_LEVELS) {
    const rawRows = parsed.data.levels[level] ?? [];
    for (const raw of rawRows) {
      const item = riskAreaPayloadSchema.safeParse(raw);
      if (!item.success) {
        skippedCount += 1;
        continue;
      }
      const d = item.data;
      levels[level].push({
        id: d.id,
        name: d.name,
        level: d.level,
        parentId: d.parent_id,
        coverage: d.coverage,
        buildingsInGrid: d.buildings_in_grid,
        buildingsHeavy: d.buildings_heavy,
        buildingsDg4Plus: d.buildings_dg4plus,
        buildingsHeavyP05P50P95: d.buildings_heavy_p05_p50_p95 ?? null,
        buildingsDg4PlusP05P50P95: d.buildings_dg4plus_p05_p50_p95 ?? null,
        exposedPopulation: d.exposed_population,
        names: d.names ?? null,
        nameVerified: d.name_verified ?? null,
        buildingsByGrade: d.buildings_by_grade ?? null,
        damagedTypes: parseTypeDamage(d.buildings_by_type ?? d.top_damaged_types),
        populationByIntensity: parsePopulationByIntensity(d.population_by_intensity_band),
      });
    }
  }

  return {
    typeCatalog: parseTypeCatalog(parsed.data.type_catalog),
    damageModel: parsed.data.damage_model,
    timeOfDay: parsed.data.time_of_day as RiskTimeOfDay,
    nDraws: parsed.data.n_draws,
    levels,
    skippedCount,
  };
}

// ---------------------------------------------------------------------------
// cont_damage.json
// ---------------------------------------------------------------------------

/**
 * Parses `cont_damage.json` (already fetched) into a `DamageContourSet` —
 * same GeoJSON ring-extraction path `parseIntensityContours` uses
 * (`contours.ts`'s shared `extractContourLevels`), mapped through the DG
 * ramp (`damageValueToLevel`) instead of the MMI ramp. Unlike
 * `parseIntensityContours` (an always-present product that is allowed to
 * throw on a genuinely malformed top-level shape), this parser is
 * tolerant end to end and returns `null` instead — `cont_damage.json` is
 * itself optional within an optional risk product, so there is nothing to
 * "fail loudly" about here; the map simply keeps its Intensity layer only.
 */
export function parseDamageContours(payload: unknown): DamageContourSet | null {
  try {
    const { levels, skippedCount } = extractContourLevels(payload);
    const mapped: DamageContourLevel[] = levels.map(({ value, rings }) => ({
      value,
      level: damageValueToLevel(value),
      rings,
    }));
    return { levels: mapped, skippedCount };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The combined product
// ---------------------------------------------------------------------------

/** Raw shape both the bundled Atlas (`AtlasBundleEntry.risk`) and the live
 * transport (`LiveShakeMapProduct.risk`) hand to this parser — one nested
 * wrapper either producer's `risk` field carries, so `parseRiskProduct` is
 * the single "one parser, two producers" seam for risk data (D9's own
 * "one renderer, either producer" rule extended to the risk chain). */
export interface RawRiskProductPayload {
  summary?: unknown;
  districts?: unknown;
  damageContours?: unknown;
  /** Optional `areas.json` payload (`risk-areas` wave) — same "present but
   * malformed/missing degrades gracefully" treatment `damageContours`
   * already gets, never required for the product to parse. */
  areas?: unknown;
  /** Already-resolved absolute URL (or `undefined`/`null`) — unlike the
   * fields above, this is never raw JSON to parse further; the live
   * transport resolves it (`resolveArtifactUrl`) before ever handing it
   * here, and `buildBundledReportUrl` below derives the bundled-path
   * equivalent. */
  reportUrl?: unknown;
}

function asRiskPayload(raw: unknown): RawRiskProductPayload | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as RawRiskProductPayload;
}

/**
 * Parses one event version's full risk bundle. `summary` and `districts`
 * are both required — a risk product with only one of the two is treated
 * as entirely absent (`RiskSection` has nothing coherent to show with just
 * one), never a half-populated dashboard. `damageContours` is optional:
 * present but malformed/missing degrades to "Intensity-only" rather than
 * dropping the whole risk product.
 */
export function parseRiskProduct(raw: unknown): RiskProduct | null {
  const payload = asRiskPayload(raw);
  if (!payload) {
    return null;
  }

  const summary = parseRiskSummary(payload.summary);
  const districts = parseRiskDistricts(payload.districts);
  if (!summary || !districts) {
    return null;
  }

  const damageContours =
    payload.damageContours !== undefined ? parseDamageContours(payload.damageContours) : null;
  const areas = payload.areas !== undefined ? parseRiskAreas(payload.areas) : null;
  const reportUrl =
    typeof payload.reportUrl === "string" && payload.reportUrl.length > 0
      ? payload.reportUrl
      : null;

  return { summary, districts, damageContours, areas, reportUrl };
}

/**
 * Derives the downloadable-report URL for a BUNDLED event (`queries.ts`'s
 * `useShakeMap`) — the eleven curated Historical events publish no live
 * `report` `shakemap_products` row of their own, but the engine publishes
 * a `report.pdf` at this same deterministic path for every version of
 * every event it computes (bundled or not), so the URL can be derived
 * from the two values a bundled `AtlasBundleEntry` already carries
 * (`eventId`, `version`) rather than needing a third bundled field. Only
 * ever used as a FALLBACK when the parsed product's own `reportUrl` is
 * `null` (`queries.ts`) — a bundled `risk` blob that DID carry a real
 * `reportUrl` (a future bundling wave might start doing this) always wins.
 */
export function buildBundledReportUrl(eventId: string, version: number): string {
  return `${ATLAS_BASE_URL}/events/${eventId}/v${version}/report.pdf`;
}
