"""rupture_model — USGS `rupture.json` ingestion + finite-fault Rjb/Rrup
(D22 "use ALL available USGS data": the finite-fault upgrade of the D9/D20
ps2ff point-source distance ladder — `distances.py`'s own docstring: "We
have no finite-fault geometry at baseline" no longer holds once an event
publishes a rupture model; per-event, this module's output REPLACES
`distances.expected_rjb_rrup`, `rupture_params.py`'s coarse polygon-derived
dip stays the fallback for every event that doesn't).

`rupture.json` format (confirmed against three real fetched fixtures this
wave, `tests/fixtures/README_rupture.md` — NOT assumed from a spec):
a `{"metadata": {...}, "features": [...], "type": "FeatureCollection"}`
document, one (or more) `Feature`s each with a `MultiPolygon` (or bare
`Polygon`) geometry. Every ring is a list of `[lon, lat, depth_km]`
triples, CLOSED (first point repeats as the last), and encodes a strip of
quadrilateral rupture patches as ONE ring in a "top edge forward, bottom
edge reversed" walk: `N` top-edge vertices (shallow) followed by the SAME
`N` bottom-edge vertices (deep) in reverse along-strike order, then the
closing point. The simplest real case (Halabja, `us2000bmcg`) is `N=2` —
a single quad; the two 2023 Kahramanmaraş events are multi-segment surface
traces with `N=16`/`N=10`. `_ring_to_quads` recovers the `N-1` individual
quads from this one-ring encoding by splitting the ring in half and
re-pairing `top[i]` with `bottom[i]` (spatially "across" the strip, not
along the ring's own point order) — this pairing is DERIVED, not
documented anywhere in the USGS product itself, so it is the one piece of
this parser's format understanding most worth distrusting if a future
event's rupture.json ever looks structurally different (e.g. an explicit
`EdgeRupture`-style `top`/`bottom` key pair instead of one merged ring —
not seen in any of the three real fixtures this wave, so not handled).

Distance math (Rjb/Rrup, "planar patches" approximation, honestly stated)
----------------------------------------------------------------------------
Every quad is treated as an exactly planar quadrilateral in a LOCAL
flat-Earth Cartesian frame centered on the event epicenter (`x` = east-km
via `lon` scaled by `cos(event_lat)`, `y` = north-km via `lat`, `z` =
depth-km — the same flat-Earth convention `vs30.py`'s site-grid builder and
`distances.rhyp_km`'s docstring already use, valid at the site-grid scales
this service operates at, a few hundred km at most). A REAL rupture surface
from a finite-fault inversion is not exactly planar patch-to-patch (fault
geometry curves, patches are typically non-planar in these products), so
"planar quad" is itself already an approximation on top of the flat-Earth
one — stated once here, not re-derived per function.

- **Rjb** (horizontal distance to the surface projection of the rupture):
  each quad's 4 corners, projected to `(x, y)` (depth dropped), form a
  polygon; a site's Rjb contribution from that quad is 0 if the site falls
  inside it (ray-casting point-in-polygon, `rupture_params.point_in_polygon`'s
  same even-odd rule, vectorized here), else the minimum distance to the
  polygon's 4 edges (point-to-segment, vectorized). The overall Rjb is the
  minimum over every quad, of every feature/polygon — mathematically exact
  for a union of possibly-overlapping polygons (a site inside any one quad's
  footprint always gets 0 from that quad, so the elementwise minimum across
  quads always equals the true distance to the union).
- **Rrup** (closest 3-D distance to the rupture surface): each quad is
  split into 2 triangles (`top_left, top_right, bottom_right` and
  `top_left, bottom_right, bottom_left`) and the closest point on each
  triangle (including its interior) to each site is found via the
  standard region-based algorithm (Ericson, *Real-Time Collision
  Detection* §5.1.5), vectorized over all sites for one fixed triangle at
  a time. The overall Rrup is the minimum 3-D distance over every
  triangle, of every quad, of every feature/polygon.
- **Variance**: `distances.DistanceEstimate.rjb_var`/`.rrup_var` are ZERO
  arrays for a finite-fault estimate — unlike ps2ff's expected-value/
  variance pair (`distances.py`'s own docstring: "expected value + variance
  of the ratio between point distance and finite-rupture distance"), Rjb/
  Rrup computed straight from real rupture geometry are not a point-source
  RATIO estimate with its own sampling uncertainty; there is nothing here
  for that variance channel to represent (D22 task wording: "the ps2ff
  variance channel drops to zero for finite-fault"). Nothing downstream
  currently consumes `rjb_var`/`rrup_var` numerically (`distances.py`'s own
  module — see its test suite) — this field exists for provenance/future
  use, same as the ps2ff path.

Mechanism/dip/ztor overrides (`override_rupture_params`)
----------------------------------------------------------------------------
`rupture_params.derive_rupture_params`'s Zagros-polygon-default dip/rake/
ztor are a coarse, region-only placeholder for a point-source event; a
rupture model directly measures the actual fault, so its geometry
overrides that placeholder:
- **dip**: `dip_from_geometry` — per-quad dip (angle between the top-edge
  midpoint -> bottom-edge midpoint vector and the horizontal), averaged
  across quads WEIGHTED by each quad's own top-edge along-strike length
  (a longer segment's dip should count for more than a short one at the
  strip's ragged ends). [REVIEW]: a straightforward geometric mean, not a
  moment-weighted or slip-weighted average (no slip-distribution field
  exists in `rupture.json` to weight by even if wanted).
- **ztor** (top-of-rupture depth): the shallowest vertex depth across every
  quad — directly measured, replacing `rupture_params.py`'s
  `ASSUMED_HALF_WIDTH_KM` back-out-from-hypocentral-depth guess entirely.
- **rake**: `metadata.rake` OVERRIDES the polygon default only when
  `metadata.mech` is a real, specific mechanism classification — NOT
  USGS's own `"ALL"` sentinel (`README_rupture.md`: all three real
  fixtures this wave carry `mech="ALL"`, `rake=0.0` — a generic/
  unconstrained placeholder pair, not a scientific determination; applying
  it as a real reverse-vs-strike-slip rake override would be WORSE than
  keeping `rupture_params.py`'s own Zagros-belt reverse-mechanism default
  for an event like Halabja that sits inside the belt). Concretely: the
  override never fires for any of this wave's three reseeded events (every
  one of them carries `mech="ALL"`); the code path exists, and is tested,
  for the day a rupture model DOES carry a real mechanism tag.
`in_zagros_polygon` (the location-only GSIM-branch-selection heuristic) is
left untouched by this module — it is a mixture-weighting concern, not a
per-event rupture-shape concern.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, replace
from typing import Any, Sequence

import numpy as np

from shake_service import distances, rupture_params

# Flat-Earth local-frame convention — matches vs30.py's site-grid builder
# and distances.py's rhyp_km docstring (both: depth/local extents are
# small enough relative to Earth's radius that a flat projection centered
# on the event is an accepted ShakeMap-style approximation).
_KM_PER_DEG_LAT: float = 111.32

# USGS mechanism sentinel meaning "unconstrained/generic default", not a
# real determination — see module docstring "Mechanism/dip/ztor overrides".
_GENERIC_MECH_SENTINELS: frozenset[str] = frozenset({"ALL", ""})


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RuptureMetadata:
    """The subset of `rupture.json`'s `metadata` object this service uses."""

    event_id: str
    mag: float | None
    depth_km: float | None
    rake_deg: float | None
    mech: str | None
    reference: str


@dataclass(frozen=True)
class Quad:
    """One planar rupture patch: 4 corners `(lon, lat, depth_km)`, in
    order top-left, top-right, bottom-right, bottom-left (a closed
    quadrilateral loop) — module docstring "rupture.json format" for how
    these are recovered from one closed ring."""

    top_left: tuple[float, float, float]
    top_right: tuple[float, float, float]
    bottom_right: tuple[float, float, float]
    bottom_left: tuple[float, float, float]

    def corners(self) -> tuple[tuple[float, float, float], ...]:
        return (self.top_left, self.top_right, self.bottom_right, self.bottom_left)


@dataclass(frozen=True)
class RuptureModel:
    """A parsed `rupture.json`: metadata + every quad recovered from every
    feature/polygon/ring in the document. `n_quads == 0` (e.g. every ring
    was malformed) is a valid, tolerated state — callers treat it exactly
    like "no rupture model" (see `gmm.py`'s wiring)."""

    metadata: RuptureMetadata
    quads: tuple[Quad, ...]

    @property
    def n_quads(self) -> int:
        return len(self.quads)

    @property
    def top_depth_km(self) -> float | None:
        """Shallowest vertex depth across every quad — the rupture's own
        measured top-of-rupture depth (ztor). `None` when there are no
        quads to measure."""
        if not self.quads:
            return None
        return min(c[2] for q in self.quads for c in q.corners())


def _same_point(a: Sequence[float], b: Sequence[float], *, tol: float = 1e-6) -> bool:
    return len(a) >= 2 and len(b) >= 2 and all(math.isclose(a[i], b[i], abs_tol=tol) for i in range(min(len(a), len(b), 3)))


def _ring_to_quads(ring: Sequence[Sequence[float]]) -> list[Quad]:
    """One closed `[lon, lat, depth_km]` ring -> its `N-1` quads (module
    docstring). Tolerant: a ring that doesn't fit the "closed, even vertex
    count after dropping the closing point, >= 2 per half" shape returns an
    empty list rather than raising — one malformed ring must never abort
    parsing every other ring/feature in the document (same tolerant-parsing
    convention as `station_observations.parse_stationlist_json`)."""
    pts = [tuple(float(v) for v in p[:3]) for p in ring if len(p) >= 3]
    if len(pts) >= 2 and _same_point(pts[0], pts[-1]):
        pts = pts[:-1]  # drop the repeated closing point
    n = len(pts) // 2
    if n < 2 or len(pts) % 2 != 0:
        return []
    top = pts[:n]
    bottom = list(reversed(pts[n:]))  # re-orient to the SAME along-strike order as `top`
    return [
        Quad(top_left=top[i], top_right=top[i + 1], bottom_right=bottom[i + 1], bottom_left=bottom[i])
        for i in range(n - 1)
    ]


def _polygon_rings(geometry: dict[str, Any]) -> list[list[list[float]]]:
    """Every EXTERIOR ring (index 0 of each polygon; holes, if any, are not
    rupture-relevant and are ignored) from a `Polygon` or `MultiPolygon`
    geometry — tolerant of an unrecognized geometry type (returns `[]`)."""
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates")
    if not isinstance(coords, list):
        return []
    if geom_type == "MultiPolygon":
        return [polygon[0] for polygon in coords if polygon]
    if geom_type == "Polygon":
        return [coords[0]] if coords else []
    return []


def parse_rupture_json(text: str) -> RuptureModel:
    """Parse a `rupture.json` document already read into memory. Raises
    `ValueError` on a document that isn't the expected top-level shape (no
    `features` list at all); an individual malformed feature/ring is
    skipped, not raised (module docstring's tolerant-parsing convention,
    same as every other USGS product parser in this package)."""
    doc = json.loads(text)
    features = doc.get("features")
    if not isinstance(features, list):
        raise ValueError("parse_rupture_json: no 'features' list found")

    meta_raw = doc.get("metadata") or {}
    metadata = RuptureMetadata(
        event_id=str(meta_raw.get("id", "")),
        mag=_finite_or_none(meta_raw.get("mag")),
        depth_km=_finite_or_none(meta_raw.get("depth")),
        rake_deg=_finite_or_none(meta_raw.get("rake")),
        mech=(str(meta_raw["mech"]).strip().upper() if meta_raw.get("mech") is not None else None),
        reference=str(meta_raw.get("reference", "")),
    )

    quads: list[Quad] = []
    for feature in features:
        geometry = feature.get("geometry") or {}
        for ring in _polygon_rings(geometry):
            quads.extend(_ring_to_quads(ring))

    return RuptureModel(metadata=metadata, quads=tuple(quads))


def load_rupture_json(path: str) -> RuptureModel:
    """Read and parse a `rupture.json` file from disk."""
    with open(path, encoding="utf-8") as f:
        return parse_rupture_json(f.read())


def _finite_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


# ---------------------------------------------------------------------------
# Local flat-Earth projection (module docstring)
# ---------------------------------------------------------------------------


def _project_km(lon: np.ndarray, lat: np.ndarray, *, ref_lon: float, ref_lat: float) -> tuple[np.ndarray, np.ndarray]:
    """`(lon, lat)` degrees -> local `(x_east_km, y_north_km)`, flat-Earth,
    centered on `(ref_lon, ref_lat)` — module docstring."""
    km_per_deg_lon = _KM_PER_DEG_LAT * max(math.cos(math.radians(ref_lat)), 1e-6)
    x = (np.asarray(lon, dtype=float) - ref_lon) * km_per_deg_lon
    y = (np.asarray(lat, dtype=float) - ref_lat) * _KM_PER_DEG_LAT
    return x, y


def _project_point_km(lon: float, lat: float, depth_km: float, *, ref_lon: float, ref_lat: float) -> np.ndarray:
    x, y = _project_km(np.array([lon]), np.array([lat]), ref_lon=ref_lon, ref_lat=ref_lat)
    return np.array([x[0], y[0], depth_km], dtype=float)


# ---------------------------------------------------------------------------
# Rjb — horizontal distance to the surface projection (module docstring)
# ---------------------------------------------------------------------------


def _points_in_polygon_2d(px: np.ndarray, py: np.ndarray, poly_x: np.ndarray, poly_y: np.ndarray) -> np.ndarray:
    """Vectorized even-odd ray-casting point-in-polygon test (same rule as
    `rupture_params.point_in_polygon`, reimplemented here vectorized over
    `px`/`py` for a small fixed polygon)."""
    n = len(poly_x)
    inside = np.zeros(px.shape, dtype=bool)
    j = n - 1
    for i in range(n):
        xi, yi = poly_x[i], poly_y[i]
        xj, yj = poly_x[j], poly_y[j]
        cond = (yi > py) != (yj > py)
        with np.errstate(divide="ignore", invalid="ignore"):
            x_intersect = xi + (py - yi) * (xj - xi) / (yj - yi)
        inside ^= cond & (px < x_intersect)
        j = i
    return inside


def _point_to_segment_dist_2d(
    px: np.ndarray, py: np.ndarray, ax: float, ay: float, bx: float, by: float
) -> np.ndarray:
    abx, aby = bx - ax, by - ay
    ab_len2 = abx * abx + aby * aby
    if ab_len2 < 1e-12:
        return np.hypot(px - ax, py - ay)
    t = np.clip(((px - ax) * abx + (py - ay) * aby) / ab_len2, 0.0, 1.0)
    cx = ax + t * abx
    cy = ay + t * aby
    return np.hypot(px - cx, py - cy)


def _quad_rjb_km(quad: Quad, site_x: np.ndarray, site_y: np.ndarray, *, ref_lon: float, ref_lat: float) -> np.ndarray:
    corners = quad.corners()
    poly_x, poly_y = _project_km(
        np.array([c[0] for c in corners]), np.array([c[1] for c in corners]), ref_lon=ref_lon, ref_lat=ref_lat
    )
    inside = _points_in_polygon_2d(site_x, site_y, poly_x, poly_y)
    edge_dists = np.full((4, site_x.size), np.inf)
    for i in range(4):
        j = (i + 1) % 4
        edge_dists[i] = _point_to_segment_dist_2d(site_x, site_y, poly_x[i], poly_y[i], poly_x[j], poly_y[j])
    boundary_dist = edge_dists.min(axis=0)
    return np.where(inside, 0.0, boundary_dist)


# ---------------------------------------------------------------------------
# Rrup — closest 3-D distance to the rupture surface (module docstring)
# ---------------------------------------------------------------------------


def _closest_point_on_triangle(p: np.ndarray, a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    """Ericson, *Real-Time Collision Detection* §5.1.5 — closest point on
    triangle `(a, b, c)` (each a length-3 vector) to every row of `p`
    (shape `(n, 3)`), region-based (vertex / edge / face), fully
    vectorized over `p` for this ONE fixed triangle. Returns shape
    `(n, 3)`."""
    ab = b - a
    ac = c - a
    ap = p - a

    d1 = ap @ ab
    d2 = ap @ ac
    region_a = (d1 <= 0) & (d2 <= 0)

    bp = p - b
    d3 = bp @ ab
    d4 = bp @ ac
    region_b = (d3 >= 0) & (d4 <= d3)

    vc = d1 * d4 - d3 * d2
    region_ab = (vc <= 0) & (d1 >= 0) & (d3 <= 0) & ~region_a & ~region_b
    denom_ab = d1 - d3
    v_ab = np.divide(d1, denom_ab, out=np.zeros_like(d1), where=denom_ab != 0)
    v_ab = np.clip(v_ab, 0.0, 1.0)

    cp = p - c
    d5 = cp @ ab
    d6 = cp @ ac
    region_c = (d6 >= 0) & (d5 <= d6)

    vb = d5 * d2 - d1 * d6
    region_ac = (vb <= 0) & (d2 >= 0) & (d6 <= 0) & ~region_a & ~region_c
    denom_ac = d2 - d6
    w_ac = np.divide(d2, denom_ac, out=np.zeros_like(d2), where=denom_ac != 0)
    w_ac = np.clip(w_ac, 0.0, 1.0)

    va = d3 * d6 - d5 * d4
    num_bc = d4 - d3
    den_bc = (d4 - d3) + (d5 - d6)
    region_bc = (va <= 0) & (num_bc >= 0) & ((d5 - d6) >= 0) & ~region_b & ~region_c
    w_bc = np.divide(num_bc, den_bc, out=np.zeros_like(num_bc), where=den_bc != 0)
    w_bc = np.clip(w_bc, 0.0, 1.0)

    region_known = region_a | region_b | region_c | region_ab | region_ac | region_bc
    region_face = ~region_known

    denom_face = va + vb + vc
    denom_face_safe = np.where(denom_face == 0, 1.0, denom_face)
    v_face = vb / denom_face_safe
    w_face = vc / denom_face_safe

    out = np.empty_like(p)
    out[region_a] = a
    out[region_b] = b
    out[region_c] = c
    out[region_ab] = a + v_ab[region_ab, None] * ab
    out[region_ac] = a + w_ac[region_ac, None] * ac
    out[region_bc] = b + w_bc[region_bc, None] * (c - b)
    out[region_face] = a + v_face[region_face, None] * ab + w_face[region_face, None] * ac
    return out


def _quad_rrup_km(
    quad: Quad, site_xyz: np.ndarray, *, ref_lon: float, ref_lat: float
) -> np.ndarray:
    def _p(corner: tuple[float, float, float]) -> np.ndarray:
        return _project_point_km(corner[0], corner[1], corner[2], ref_lon=ref_lon, ref_lat=ref_lat)

    tl, tr, br, bl = (_p(c) for c in quad.corners())
    tri1 = _closest_point_on_triangle(site_xyz, tl, tr, br)
    tri2 = _closest_point_on_triangle(site_xyz, tl, br, bl)
    d1 = np.linalg.norm(site_xyz - tri1, axis=1)
    d2 = np.linalg.norm(site_xyz - tri2, axis=1)
    return np.minimum(d1, d2)


# ---------------------------------------------------------------------------
# Public: finite-fault DistanceEstimate + rupture-param overrides
# ---------------------------------------------------------------------------


def finite_fault_distances(
    model: RuptureModel, *, site_lons: np.ndarray, site_lats: np.ndarray, ref_lon: float, ref_lat: float,
) -> distances.DistanceEstimate:
    """Rjb/Rrup (+ zero variance, module docstring) for every site in
    `(site_lons, site_lats)`, from `model`'s quads. Callers must check
    `model.n_quads > 0` first — an empty model has nothing to compute
    against (raises `ValueError`, never silently returns garbage)."""
    if model.n_quads == 0:
        raise ValueError("finite_fault_distances: rupture model has zero quads")

    site_lons_arr = np.asarray(site_lons, dtype=float)
    site_lats_arr = np.asarray(site_lats, dtype=float)
    site_x, site_y = _project_km(site_lons_arr, site_lats_arr, ref_lon=ref_lon, ref_lat=ref_lat)
    site_xyz = np.stack([site_x, site_y, np.zeros_like(site_x)], axis=1)

    rjb = np.full(site_x.shape, np.inf)
    rrup = np.full(site_x.shape, np.inf)
    for quad in model.quads:
        rjb = np.minimum(rjb, _quad_rjb_km(quad, site_x, site_y, ref_lon=ref_lon, ref_lat=ref_lat))
        rrup = np.minimum(rrup, _quad_rrup_km(quad, site_xyz, ref_lon=ref_lon, ref_lat=ref_lat))

    return distances.DistanceEstimate(
        rjb_km=rjb, rjb_var=np.zeros_like(rjb), rrup_km=rrup, rrup_var=np.zeros_like(rrup),
    )


def dip_from_geometry(model: RuptureModel) -> float | None:
    """Along-strike-length-weighted mean dip (degrees, module docstring)
    across every quad. `None` for an empty model."""
    if model.n_quads == 0:
        return None
    # An arbitrary but fixed local origin (the first quad's top-left
    # corner) -- only RELATIVE geometry within/between quads matters here,
    # any fixed reference point gives the same dip angles.
    ref_lon, ref_lat = model.quads[0].top_left[0], model.quads[0].top_left[1]

    weighted_sum = 0.0
    weight_total = 0.0
    for quad in model.quads:
        tl = _project_point_km(*quad.top_left, ref_lon=ref_lon, ref_lat=ref_lat)
        tr = _project_point_km(*quad.top_right, ref_lon=ref_lon, ref_lat=ref_lat)
        br = _project_point_km(*quad.bottom_right, ref_lon=ref_lon, ref_lat=ref_lat)
        bl = _project_point_km(*quad.bottom_left, ref_lon=ref_lon, ref_lat=ref_lat)

        top_mid = (tl + tr) / 2.0
        bottom_mid = (bl + br) / 2.0
        horiz = math.hypot(bottom_mid[0] - top_mid[0], bottom_mid[1] - top_mid[1])
        vert = abs(bottom_mid[2] - top_mid[2])
        dip_deg = math.degrees(math.atan2(vert, horiz)) if (horiz > 1e-9 or vert > 1e-9) else 90.0
        dip_deg = min(max(dip_deg, 0.0), 90.0)

        weight = math.hypot(tr[0] - tl[0], tr[1] - tl[1])  # along-strike top-edge length
        weight = weight if weight > 1e-9 else 1e-9
        weighted_sum += dip_deg * weight
        weight_total += weight

    return weighted_sum / weight_total if weight_total > 0 else None


def rake_from_metadata(model: RuptureModel) -> float | None:
    """`metadata.rake_deg`, but only when `metadata.mech` is a real,
    specific mechanism tag — module docstring "Mechanism/dip/ztor
    overrides". `None` whenever `mech` is missing or one of USGS's generic
    sentinels (`"ALL"`/empty), even if a numeric `rake` is present."""
    mech = model.metadata.mech
    if mech is None or mech in _GENERIC_MECH_SENTINELS:
        return None
    return model.metadata.rake_deg


def override_rupture_params(base: rupture_params.RuptureParams, model: RuptureModel) -> rupture_params.RuptureParams:
    """`base` (the point-source polygon-derived default) with dip/ztor
    (always, when geometry exists) and rake (only when metadata carries a
    real mechanism, `rake_from_metadata`) replaced by rupture-model-derived
    values — module docstring "Mechanism/dip/ztor overrides". Returns
    `base` UNCHANGED when the model has zero quads (nothing to override
    with)."""
    dip = dip_from_geometry(model)
    if dip is None:
        return base

    flags = base.review_flags + ("finite_fault_geometry_dip_ztor",)
    rake = base.rake_deg
    meta_rake = rake_from_metadata(model)
    if meta_rake is not None:
        rake = meta_rake
        flags = flags + ("finite_fault_metadata_rake",)

    ztor = model.top_depth_km
    return replace(base, dip_deg=dip, rake_deg=rake, ztor_km=ztor if ztor is not None else base.ztor_km, review_flags=flags)
