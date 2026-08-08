# Basemap fixture — provenance

`basemap.trimmed.json` is a small, offline, statically-bundled context layer
for `ShakeMapView` (map-presentation wave, 2026-08-08 — owner feedback: "the
basemap is not there, it's just the radial maps"). It supplies country
border lines + coastline under the intensity contours, matching what the
SHAKEmaps Toolkit's own `SHAKEmapper.create_basemap()` draws (Cartopy
`coastlines()` + `cfeature.BORDERS`) — see
`SHAKEmaps-Toolkit-v26/modules/viz/SHAKEmapper.py`.

## Source

[Natural Earth](https://www.naturalearthdata.com/) — public domain
("No permission is needed to use Natural Earth."), 1:50m cultural/physical
vectors, fetched 2026-08-08 from the `nvkelso/natural-earth-vector` GitHub
mirror's `geojson/` exports:

- `ne_50m_admin_0_boundary_lines_land.geojson` (country border lines, land
  only — not coastal double-lines)
- `ne_50m_coastline.geojson`

## Processing

Trimmed and simplified by a one-off Node script (not shipped — build-time
data prep only, same spirit as `bumelerze-shake-service`'s `seed_atlas.py`
for the historical atlas bundle):

1. **Clip** every line to a padded bbox around Kurdistan and its neighbors —
   `{ minLon: 35, maxLon: 55, minLat: 25, maxLat: 45 }` (covers Iraq, Iran,
   Turkey, Syria, and enough of Jordan/Saudi Arabia/Kuwait/the Gulf/the
   Mediterranean/Caspian/Red Sea coastlines for context at any plausible
   ShakeMap contour extent), padded by 2° on each side so lines don't
   visibly truncate right at the fixture's own edge. Liang-Barsky segment
   clipping — a polyline that exits and re-enters the box becomes multiple
   sub-lines, never mis-joined across the gap.
2. **Simplify** with Douglas-Peucker, tolerance 0.02° (~2km at this
   latitude) — this is a phone-width map, not a survey product; a few
   hundred points across the whole fixture is already more detail than a
   ~350dp-wide SVG can resolve.
3. Coordinates rounded to 3 decimal places (~110m) — free size reduction,
   irrelevant precision loss at this render scale.

Result: 49 border-line pieces (534 points) + 25 coastline pieces (687
points), **19.4 KB** total — comfortably under the ~150KB budget.

## Format

```jsonc
{
  "bbox": { "minLon": 35, "maxLon": 55, "minLat": 25, "maxLat": 45 },
  "borders": [[[lon, lat], [lon, lat], ...], ...],
  "coastline": [[[lon, lat], [lon, lat], ...], ...]
}
```

Plain nested-array polylines, not full GeoJSON — every byte here ships in
the app bundle, and the only consumer (`basemap.ts`) needs coordinates, not
GeoJSON's `Feature`/`geometry` envelope or per-feature properties (country
names etc. aren't used — the map draws lines, not labels, for this layer).

## Regenerating

Not currently scripted as a repo command (one-off, like the Atlas bundler is
a separate Python tool in `shake-service/`) — re-run the same fetch +
clip + simplify steps above against a fresh Natural Earth release if the
bbox or tolerance ever needs to change.
