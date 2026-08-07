# Fixtures: `*_rupture.trimmed.json`

Real USGS ShakeMap `rupture.json` finite-fault products (D22 "use ALL
available USGS data" — the finite-fault upgrade of the D9/D20 ps2ff-based
point-source distance ladder, `shake_service/rupture_model.py`) for the
three Bumelerze Atlas events that publish one. Used by
`tests/test_rupture_model.py` to test `rupture_model.parse_rupture_json`
against real (not synthetic) USGS output.

## Provenance (fetched 2026-08-07)

- `us2000bmcg_rupture.trimmed.json` — 2017 M7.3 Halabja/Sarpol-e Zahab,
  `https://earthquake.usgs.gov/product/shakemap/us2000bmcg/atlas/1594400092790/download/rupture.json`
  (the "atlas" shakemap product). A single quad (1 polygon, 5-point closed
  ring — the simplest case: 2 top vertices + 2 bottom vertices).
- `us6000jllz_rupture.trimmed.json` — 2023-02-06 M7.8 Pazarcık,
  `https://earthquake.usgs.gov/product/shakemap/us6000jllz/us/1756921940993/download/rupture.json`
  (the "us" shakemap product — no "atlas" shakemap exists for this event).
  A 15-segment multi-quad surface trace (1 polygon, 33-point closed ring:
  16 top vertices at 1 km depth + 16 bottom vertices at 16 km depth, in
  the "top trace forward, bottom trace reversed" ring convention — see
  `rupture_model.py`'s module docstring for how this is split back into
  quads).
- `us6000jlqa_rupture.trimmed.json` — 2023-02-06 M7.5 Elbistan,
  `https://earthquake.usgs.gov/product/shakemap/us6000jlqa/us/1756575631263/download/rupture.json`
  (the "us" shakemap product). A 9-segment multi-quad surface trace
  (1 polygon, 21-point closed ring).

Not trimmed further — each real file is already small (a rupture-extent
polygon, not a station/DYFI observation list), so the fixture is the
complete real product, pretty-printed (`json.dumps(..., indent=2)`), byte-
for-byte the same numeric values USGS serves.

## Format notes (confirmed against these three real files, not assumed)

- Top-level object: `{"metadata": {...}, "features": [...], "type":
  "FeatureCollection"}` — NOT a bare `FeatureCollection` with metadata
  folded into a feature's properties.
- `metadata` carries `rake`, `mech` (all three of these real files carry
  `"mech": "ALL"` — USGS's own "unconstrained/generic" sentinel, NOT a real
  mechanism determination; `rupture_model.py`'s metadata-rake override
  policy treats this specific sentinel as "not present" — see that
  module's docstring), plus `mag`/`depth`/`lat`/`lon`/`reference`/etc.
  echoing the point-source event params.
- One `Feature` per rupture (all three real files: exactly one), geometry
  `type: "MultiPolygon"`, `coordinates` a list of polygons (all three: one
  polygon), each polygon a list of rings (all three: one ring, no holes),
  each ring a list of `[lon, lat, depth_km]` triples, CLOSED (first point
  repeats as the last).
