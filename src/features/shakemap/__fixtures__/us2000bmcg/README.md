# Fixture: 2017 M7.3 Halabja/Sarpol-e Zahab (USGS `us2000bmcg`)

Real USGS ShakeMap products, trimmed for test-fixture size. Chosen per the
wave brief (spec-v1.md §4.7 already cites this event for Historical View
seeding) and because it's the largest, most complete Kurdistan-region
ShakeMap in USGS ComCat — a realistic "real product" case, not a synthetic
one.

## Provenance (exact URLs, fetched 2026-08-06)

1. Event detail (geojson `detail` format):
   `https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=us2000bmcg&format=geojson`
2. From that response's `properties.products.shakemap[]`, the preferred
   product (`preferredWeight` 321, `source: "atlas"`) contents map pointed
   at:
   - `https://earthquake.usgs.gov/product/shakemap/us2000bmcg/atlas/1594400092790/download/cont_mi.json`
   - `https://earthquake.usgs.gov/product/shakemap/us2000bmcg/atlas/1594400092790/download/info.json`
     (URL captured by `usgs-products.ts` as `infoUrl`; contents not parsed
     this wave — see module doc comment).

The event carries a SECOND shakemap product (`source: "us"`,
`preferredWeight` 233, version 12) — a real case of "more than one producer
submitted a ShakeMap for this event", deliberately kept in
`detail-fragment.json` so the preferred-product-selection test has a real
non-preferred candidate to reject, not a fabricated one.

## Files

- `detail-fragment.json` — the event's `type`/`id`/`properties.title`/
  `properties.mag`/`properties.place` plus the FULL (untrimmed field set,
  trimmed content-list) `properties.products.shakemap` array (both
  products). Each product's `contents` map is trimmed from its real 58–73
  keys down to 3: `download/cont_mi.json`, `download/info.json` (the two
  this feature reads), plus one arbitrary third real key left in place
  (`download/coverage_psa3p0_high_res.covjson` / `download/psa10.ps.zip`)
  to prove the schema tolerates and ignores content types it doesn't know
  about. All key VALUES (url, sha256, length, lastModified) are the real
  ones from the live response — nothing fabricated, only pruned.
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
values, multiple rings per level, the two-shakemap-products-per-event
preferred/non-preferred case, unknown `contents` keys.

Dropped: the other 7 MMI levels (3.0–7.5 minus 4.5), the other
rings/points per kept level, all non-`cont_mi`/`info` content types except
one placeholder key, `strec`/`multigmpe`/full `output` blocks from
`info.json` (not fetched this wave at all — see `usgs-products.ts`).
