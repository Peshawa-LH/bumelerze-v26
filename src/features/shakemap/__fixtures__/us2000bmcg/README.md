# Fixture: 2017 M7.3 Halabja/Sarpol-e Zahab (USGS `us2000bmcg`)

Real USGS ShakeMap contour output, trimmed for test-fixture size. Chosen per
the wave brief (spec-v1.md §4.7 already cites this event for Historical
View seeding) and because it's the largest, most complete Kurdistan-region
ShakeMap in USGS ComCat — a realistic "real product" case, not a synthetic
one.

**D21 update (`docs/decisions.md`):** the live USGS ShakeMap display
path (`usgs-products.ts`, event-detail fetch, `fetchIntensityContours`) was
REMOVED app-side this wave — the app now only ever displays bundled
`bumelerze-shake-service` products (`src/features/shakemap/atlas/`, see its
own generated `index.ts`). `detail-fragment.json` (the USGS event-detail
product-selection fixture) was removed along with `usgs-products.ts`/its
tests. `cont_mi.trimmed.json` below is KEPT — `contours.ts`'s
`parseIntensityContours` is still exactly what both a bundled Atlas entry
and (conceptually) any future live product would be parsed with, and this
fixture is real, non-synthetic MMI-scale contour data worth keeping as a
parser test case regardless of source.

## Provenance (exact URL, fetched 2026-08-06)

`https://earthquake.usgs.gov/product/shakemap/us2000bmcg/atlas/1594400092790/download/cont_mi.json`
(from that event's preferred `atlas`-source shakemap product,
`preferredWeight` 321).

## Files

- `cont_mi.trimmed.json` — real `cont_mi.json` GeoJSON `FeatureCollection`
  (104 KB / 11 MMI levels / up to 239 points per ring in the original),
  trimmed to 4 MMI levels (8.0, 6.0, 4.5, 4.0 — chosen to cover a
  fractional value for rounding tests and a wide value spread) with at
  most 2 rings kept per level (one closed ring, one open ring, where both
  existed — real closed/open ring cases from the source data) and each
  ring's point list downsampled (every Nth point, first/last point always
  kept) to ≤8 points. Every coordinate pair that remains is a REAL point
  from the source ring, not interpolated or invented. The fixture also
  deliberately stores its 4 features in DESCENDING value order (8.0 → 4.0)
  even though USGS's real feed is ascending — `contours.ts` must sort
  ascending itself; this fixture exists specifically so a test can catch a
  parser that trusts input order instead.

## What the trim preserves vs. drops

Preserved (load-bearing for the tests in `__tests__/`): real coordinate
values and precision, the closed-vs-open ring distinction, fractional MMI
values, multiple rings per level.

Dropped: the other 7 MMI levels (3.0–7.5 minus 4.5), the other
rings/points per kept level.
