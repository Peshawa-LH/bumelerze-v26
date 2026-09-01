# Fixture: 2023 M7.8 Kahramanmaraş/Pazarcık risk product (`us6000jllz`)

Real `bumelerze-engine` risk-chain output (D46, `risk-dashboard` wave),
trimmed for test-fixture size — same "keep real values, drop bulk" spirit
`us2000bmcg/cont_mi.trimmed.json`'s own README documents for the intensity
fixture. Source: `src/features/shakemap/atlas/data/us6000jllz.json`'s
`risk` field (product version 5, generated 2026-09-01), itself produced by
`bumelerze-engine/scripts/bundle_atlas_for_app.py` from the engine's real
`risk_summary.json` / `districts.json` / `cont_damage.json`.

## Files

- `risk_summary.json` — the real national-totals product, trimmed of the
  large per-province `exposure.coverage` map and the full `mc_settings`
  block (neither is parsed by `risk.ts`'s `parseRiskSummary`); every field
  that survives is a real, unmodified value from the source product
  (`buildings_heavy_p05_p50_p95: [116423, 158965, 209051]`,
  `exposed_population: 17079988`, etc.).
- `districts.json` — the real per-province product, trimmed from 30 rows
  to the first 10 (already producer-sorted worst-first; the first 10 stay
  worst-first too), enough to exercise both the "show first 8" and the
  "10 > 8, Show all appears" cases in `RiskSection` without shipping all
  30 real rows.
- `cont_damage.trimmed.json` — real `cont_damage.json` GeoJSON
  `FeatureCollection` (6 expected-damage-grade levels: 0.5, 1.0, 1.5, 2.0,
  2.5, 3.0), trimmed to the 2 largest rings per level and each ring's
  point list downsampled (evenly-spaced indices, first/last point always
  kept) to ≤8 points — same trimming method
  `us2000bmcg/cont_mi.trimmed.json` uses for the intensity contours. Every
  coordinate pair that remains is a REAL point from the source ring, never
  interpolated or invented.

## What the trim preserves vs. drops

Preserved (load-bearing for the tests in `__tests__/`): every field
`risk.ts`'s parsers actually read, real numeric values throughout
(headline/range numbers, district names/values, damage-grade contour
values and real ring geometry), the worst-first district ordering.

Dropped: `exposure.coverage`, `mc_settings`, districts 11-30, damage-
contour rings beyond the 2 largest per level, and points beyond the
downsampled cap.
