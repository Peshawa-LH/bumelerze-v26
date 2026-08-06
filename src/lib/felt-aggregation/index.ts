/**
 * felt-aggregation — public barrel.
 *
 * Portability: this whole folder is pure TypeScript (no React/RN/Expo
 * imports, zero new npm deps) so it can run unchanged in a Supabase Edge
 * Function (Deno) — see README.md "Edge Function deployment note".
 */

export { encodeGeohash } from "./geohash";

export { scoreTier2Report, CARTOON_TO_INTENSITY, type IndexScores } from "./cdi-scoring";

export {
  aggregateCell,
  applyCorroborationGate,
  cdiFromCWS,
  computeCWS,
  computeIndexMeans,
  trimmedMeanIntensity,
  CDI_WEIGHTS,
} from "./cell-aggregation";

export type {
  AggregateCellOutcome,
  AggregationInputReport,
  FeltCellAggregate,
  IndexMeans,
  Tier1InputReport,
  Tier2InputReport,
} from "./types";
