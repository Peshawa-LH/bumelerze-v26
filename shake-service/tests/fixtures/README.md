# Fixture: `us2000bmcg_grid.trimmed.xml`

A real USGS ShakeMap `grid.xml` fragment (2017 M7.3 Halabja/Sarpol-e Zahab,
`us2000bmcg`, the same event as `src/features/shakemap/__fixtures__/
us2000bmcg/`), trimmed for test-fixture size — used by
`tests/test_comparison.py` to test `comparison.parse_shakemap_grid_xml`
against real (not synthetic) USGS output.

## Provenance (fetched 2026-08-07)

`https://earthquake.usgs.gov/product/shakemap/us2000bmcg/atlas/1594400092790/download/grid.xml`
(the same "atlas" product, `preferredWeight` 321, as the `cont_mi.json`/
`info.json` fixture — see `src/features/shakemap/__fixtures__/us2000bmcg/
README.md`). The real file is 754×618 = 465,972 grid points (~26.6 MB);
this fixture keeps a 4×2 corner (the first two latitude rows, first four
longitude steps: `lon` 40.0500–40.1000, `lat` 39.8500–39.8667 — the
grid's own NW corner, near lon_min/lat_max).

## What the trim preserves vs. drops

Preserved (load-bearing for the parser test): the exact header tag shapes
(`<event/>`, `<grid_specification/>`, nine `<grid_field/>` tags exactly as
the real file orders them), the real numeric values for all 9 columns
(LON/LAT/MMI/PGA/PGV/PSA03/PSA10/PSA30/SVEL) for the 8 rows kept, and the
real row order (latitude descending, longitude ascending within a row —
this fixture's rows are the file's actual first 8 rows in original order,
not reordered). `grid_specification`'s `lon_min/lat_min/lon_max/lat_max/
nlon/nlat` are recomputed to describe THIS 4×2 sub-rectangle exactly (so
`nlon * nlat == 8` holds, the same invariant `parse_shakemap_grid_xml`
checks against the real 754×618 file) — everything else in that tag
(`nominal_lon_spacing`/`nominal_lat_spacing`) is unchanged from the real
file, since the sub-rectangle uses the same spacing.

Dropped: all rows beyond the 8 kept (465,964 of them), including every
`PSA*`/`SVEL` value beyond this corner — those columns are still present
per-row (not deleted from the schema) since a partial-column trim isn't
needed for this fixture's purpose (proving the parser reads the real
column layout and row-major data correctly).
