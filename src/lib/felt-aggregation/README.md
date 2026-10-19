# felt-aggregation

Pure TypeScript implementation of the felt-report CDI science (the
felt-report method, confirmed 2026-08-04, D18). Zero React/React
Native/Expo imports, zero new npm dependencies.

**Portability constraint:** this folder also runs inside a Supabase Edge
Function (Deno): the server-side aggregation job,
`supabase/functions/aggregate-felt-cells/`, carries a verbatim copy in its
own `felt-aggregation/` folder. Concretely that means:

- No RN/Expo module imports anywhere in `geohash.ts`, `cdi-scoring.ts`,
  `cell-aggregation.ts`, `types.ts`, `index.ts`.
- Only `import type` from `@/features/felt/types` (the answer-enum unions)
  — those erase at compile time, so there is zero runtime coupling to the
  RN app even though the source tree lives inside it today.
- No new npm packages. The geohash encoder is hand-rolled specifically to
  avoid adding one.
- The Edge Function's copy differs only mechanically: the
  `@/features/felt/types` import is replaced by its own `answer-types.ts`,
  and relative imports carry Deno's `.ts` extensions. `__tests__/
  vendored-sync.test.ts` feeds the same fixtures through both copies and
  fails if their output differs.

## What implements what (section map to the felt-report method)

| File | Method section(s) | What it does |
|---|---|---|
| `geohash.ts` | §3.1 (D18 R12) | Base32 geohash encoder, any precision; app uses p4/p5/p6. |
| `cdi-scoring.ts` | PART 2 (Q1-Q11 answer→index tables), §3.3 cartoon table | Per-report index extraction: `scoreTier2Report` (the 8 CWS indices, with the Q3 `getFeltFromOther` modifier chain and the R17 vehicle exclusion), `CARTOON_TO_INTENSITY` (tier-1 cartoon → CDI-path intensity, identity + 9.0 cap). |
| `cell-aggregation.ts` | §3.2 (CDI algorithm), §3.3 (tier-1-only path + combination), §1.2/R14 (corroboration gate) | `computeIndexMeans`/`computeCWS`/`cdiFromCWS` (the §3.2 pipeline), `trimmedMeanIntensity` (§3.3), `applyCorroborationGate` (R14), `aggregateCell` (the end-to-end entry point: dedup → means → CWS → CDI → tier combination → floor/cap/round → display thresholds). |
| `types.ts` | §3.5 storage shape | Input report shapes (`AggregationInputReport`, composed from `@/features/felt/types` answer enums) and `FeltCellAggregate` (mirrors `felt_cells` columns this module is responsible for: `cdi`, `cws`, `index_means`/`IndexMeans`, `n_reports`, `n_tier2`). |
| `index.ts` | — | Public barrel. |

## What is deliberately NOT here

- **IMS-25 assignment (§3.4).** The parallel diagnostic intensity path
  (`ems_int`, `ems_range`, `ems_method`, the IMS-25 vulnerability-class and
  quantity-bar tables per D18 R5/R7/R13) is not built yet; it waits on the
  IMS-25 tables from `bumelerze-engine`. This module only computes the CDI
  path, and the server job writes those columns as null.
- **Bumelerze-specific cartoon→intensity correction (§3.3, D18 R9).** Tier-1
  cartoon picks map through the identity table (1-9, then 9/9/9 for
  10-12) — no EMSC-style `iraw→icorr` bias correction. Fitting our own
  correction from paired tier-1/tier-2 data is real-data Phase-2 work, not
  something that can be built against fixtures.
- **Ground-effects layer (Q11, §2 Q11, R8).** Confirmed excluded from both
  CDI and EMS/IMS intensity; not modeled here at all (it's a separate
  `ground_effects` JSONB column the caller populates directly from raw
  `roadDamageLevel` answers, no scoring involved).
- **Spatial cell assignment** (which geohash a report's lat/lon falls into,
  which event it's associated with, the "compute p6 only when a p5 cell
  has >=20 reports" rule of §3.1). This module aggregates a report list
  the caller has already resolved to one (event, cell) — it has no opinion
  on how that resolution happens.
- **Storage/versioning** (`event_id`, `geohash`, `precision`, `version`,
  `computed_at`, the >=60s recompute debounce of §3.2 step 5). Left to the
  caller; `FeltCellAggregate` only carries the fields this module actually
  computes.

## The server job

`supabase/functions/aggregate-felt-cells/` (its own README) runs every 5
minutes (`pg_cron`, migration 0017). For each event with new reports it:

1. Resolves the reports to (event, geohash) cells — not this module's job.
2. Loads all reports for each cell, maps them to `AggregationInputReport[]`.
3. Calls `aggregateCell(...)` from its copy of this folder.
4. Writes the result into a new `felt_cells` row (service-role key, bumps
   `version`) only when it differs from the stored one; the IMS-25
   diagnostic columns stay null (see above).

## A documented ambiguity worth flagging up front

The R14 corroboration gate ("a cell never displays an intensity >= 10
unless the >=3-report threshold is met by reports >= 8") is implemented in
`cell-aggregation.ts`'s `applyCorroborationGate`, but under the formulas
this module implements, the final `cdi`/`intensity` value is *always*
capped at 9.0 (§3.2 step 3's R11 cap, and independently by the §3.3
cartoon table capping levels 10-12 at 9.0 before the trimmed mean even
runs) — so the gate's `intensity >= 10` trigger condition is currently
unreachable from real `aggregateCell` output. It is implemented and
exercised directly against synthetic inputs (see
`__tests__/cell-aggregation.test.ts`) because the felt-report method asks for it
explicitly and the same evidence-counting logic is almost certainly what
the future `ems_int` (§3.4, uncapped, integer I-XII) path will need. See
the full reasoning in `cell-aggregation.ts`'s doc comment on
`applyCorroborationGate`.
