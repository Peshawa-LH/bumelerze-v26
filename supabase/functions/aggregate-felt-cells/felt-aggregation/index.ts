// VENDORED — hand-synced copy of `src/lib/felt-aggregation/index.ts` (public
// barrel). See `answer-types.ts` in this folder for the vendoring
// rationale/sync story.

export { encodeGeohash } from "./geohash.ts";

export { scoreTier2Report, CARTOON_TO_INTENSITY, type IndexScores } from "./cdi-scoring.ts";

export {
  aggregateCell,
  applyCorroborationGate,
  cdiFromCWS,
  computeCWS,
  computeIndexMeans,
  trimmedMeanIntensity,
  CDI_WEIGHTS,
} from "./cell-aggregation.ts";

export type {
  AggregateCellOutcome,
  AggregationInputReport,
  FeltCellAggregate,
  IndexMeans,
  Tier1InputReport,
  Tier2InputReport,
} from "./types.ts";
