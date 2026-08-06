# felt-aggregation

Pure TypeScript implementation of the felt-report CDI science
(`docs/research/felt-report-science-v1.md`, CONFIRMED 2026-08-04, D18).
Zero React/React Native/Expo imports, zero new npm dependencies.

**Portability constraint:** this folder must run unchanged inside a
Supabase Edge Function (Deno) once the server-side aggregation job is
built (Phase 2 backend wave, not this wave). Concretely that means:

- No RN/Expo module imports anywhere in `geohash.ts`, `cdi-scoring.ts`,
  `cell-aggregation.ts`, `types.ts`, `index.ts`.
- Only `import type` from `@/features/felt/types` (the answer-enum unions)
  — those erase at compile time, so there is zero runtime coupling to the
  RN app even though the source tree lives inside it today.
- No new npm packages. The geohash encoder is hand-rolled specifically to
  avoid adding one.
- When the Edge Function is built, this folder can be copied/symlinked in
  as-is (or published as a tiny internal package) and pointed at Deno's
  `npm:` specifier for `@/features/felt/types` if that type import is kept,
  or the type import can be inlined at that point — no logic changes
  required either way.

## What implements what (section map to felt-report-science-v1.md)

| File | Science pack section(s) | What it does |
|---|---|---|
| `geohash.ts` | §3.1 (D18 R12) | Base32 geohash encoder, any precision; app uses p4/p5/p6. |
| `cdi-scoring.ts` | PART 2 (Q1-Q11 answer→index tables), §3.3 cartoon table | Per-report index extraction: `scoreTier2Report` (the 8 CWS indices, with the Q3 `getFeltFromOther` modifier chain and the R17 vehicle exclusion), `CARTOON_TO_INTENSITY` (tier-1 cartoon → CDI-path intensity, identity + 9.0 cap). |
| `cell-aggregation.ts` | §3.2 (CDI algorithm), §3.3 (tier-1-only path + combination), §1.2/R14 (corroboration gate) | `computeIndexMeans`/`computeCWS`/`cdiFromCWS` (the §3.2 pipeline), `trimmedMeanIntensity` (§3.3), `applyCorroborationGate` (R14), `aggregateCell` (the end-to-end entry point: dedup → means → CWS → CDI → tier combination → floor/cap/round → display thresholds). |
| `types.ts` | §3.5 storage shape | Input report shapes (`AggregationInputReport`, composed from `@/features/felt/types` answer enums) and `FeltCellAggregate` (mirrors `felt_cells` columns this module is responsible for: `cdi`, `cws`, `index_means`/`IndexMeans`, `n_reports`, `n_tier2`). |
| `index.ts` | — | Public barrel. |

## What is deliberately NOT here

- **EMS-98/IMS-25 assignment (§3.4).** The parallel diagnostic intensity
  path (`ems_int`, `ems_range`, `ems_method`, the toolkit's IMS-25
  vulnerability-class/quantity-bar tables per D18 R5/R7/R13) is
  Phase-2 server work, once the `SHAKEmaps-Toolkit-v26` YAML tables are
  wired in. This module only computes the CDI path.
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
  caller per the wave brief; `FeltCellAggregate` only carries the fields
  this module actually computes.

## Edge Function deployment note

The intended shape of the eventual server job: a Supabase Edge Function
(Deno), triggered on new `felt_reports`/`felt_report_details` rows (or on a
debounce timer per §3.2 step 5), that:

1. Resolves the report to an (event, geohash) cell — not this module's job.
2. Loads all reports for that cell, maps them to `AggregationInputReport[]`.
3. Calls `aggregateCell(...)` from this folder, unchanged.
4. Writes the result into a new `felt_cells` row (service-role key, bumps
   `version`) alongside the EMS/IMS fields computed by the (separate,
   Phase-2) IMS-25 diagnostic path.

Because this folder has no RN/Expo/npm-package dependency, step 3 is a
straight import with no adaptation layer.

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
`__tests__/cell-aggregation.test.ts`) because the science pack asks for it
explicitly and the same evidence-counting logic is almost certainly what
the future `ems_int` (§3.4, uncapped, integer I-XII) path will need. See
the full reasoning in `cell-aggregation.ts`'s doc comment on
`applyCorroborationGate`, and the wave's final report for the exact science
pack quote this reads against.
