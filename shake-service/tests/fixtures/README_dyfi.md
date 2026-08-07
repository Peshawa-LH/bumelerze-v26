# Fixture: `dyfi_geo_10km.trimmed.geojson`

A real USGS DYFI "geocoded, 10km" product fragment (2017 M7.3
Halabja/Sarpol-e Zahab, `us2000bmcg`), trimmed for test-fixture size — used
by `tests/test_dyfi_observations.py` to test `dyfi_observations.parse_dyfi_geo_geojson`
against real (not synthetic) USGS output.

## Provenance (fetched 2026-08-07, wave D)

`https://earthquake.usgs.gov/product/dyfi/us2000bmcg/us/1722464762515/dyfi_geo_10km.geojson`
(the event's `dyfi` product, `source="us"`). The real file has 397 features
(one per populated 10km UTM box with >=1 felt response, worldwide — this
event was widely felt); this fixture keeps 10 of them, hand-picked to span
the `nresp` range actually present near the epicentre after nresp>=3
filtering: `nresp` = 1, 2, 3 (x2), 4, 5, 11, 23, 49, at epicentral distances
36-152 km (Halabjah/Pol-e-Zahab/Sulaymaniyah/Kirkuk/Sannandaj boxes) — real
`cdi` values 5.3-8.5, real polygon corners, real `stddev`/`dist` fields
unchanged.

## What the trim preserves vs. drops

Preserved (load-bearing for the parser + conversion tests): the exact
GeoJSON `Feature` shape (`geometry.type="Polygon"`, 4 real UTM-box corner
coordinates per feature, not closed/repeated), every `properties` key
(`stddev`, `nresp`, `name`, `cdi`, `dist`) with real values, real HTML
entities in `name` (e.g. `HalubÄ?ah` — the product's own mis-encoded
"Halabjah", not fixed here; parsing never depends on `name`).

Dropped: all 387 other features (mostly nresp=1 boxes scattered globally —
Europe, Egypt, etc., far outside anything a Halabja conditioning run would
plausibly use).
