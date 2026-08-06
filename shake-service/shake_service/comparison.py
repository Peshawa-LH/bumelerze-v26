"""comparison — grid-vs-grid validation tooling: parse a USGS ShakeMap
`grid.xml`, resample our `forward.ForwardMap` onto it, and compute the D20
smoke-test statistics (`docs/decisions.md` D20;
`docs/research/gmpe-set-proposal-v2.md` §7).

**Interpretation caveat (repeated here deliberately, not just in the
report):** USGS's Atlas grid for a real event is a station+DYFI-conditioned,
often finite-fault, NGA-West2-quartet product; our forward map here is the
BARE, UNCONDITIONED point-source prior. Residuals mix genuine model
difference with this conditioning-vs-no-conditioning asymmetry — this module
computes a sanity-anchor comparison, not a fit metric, and this file never
adjusts D20 weights based on its own output (`run_halabja.py`'s framing;
enforced by process, not code).

Resampling choice (documented per task instruction): our regular
lat/lon-degree mesh (`forward.ForwardMap.lon2d`/`.lat2d`, built by
`vs30.build_grid_km_spacing`'s `indexing="ij"` meshgrid — lon spacing is
constant per row, lat spacing constant per column, i.e. a TRUE rectangular
grid in degree-space, not just an approximately-regular one) is bilinearly
resampled onto USGS's grid CELL CENTERS via
`scipy.interpolate.RegularGridInterpolator`, restricted to the region where
our (smaller, magnitude-scaled) grid actually has data — USGS cells outside
our grid's bounding box come back `NaN` and are dropped before any
statistic. This is the opposite direction from "resample USGS onto ours"
because USGS's grid is coarser in area but the SAME nominal resolution
(~0.0167 deg either way for Atlas products) — resampling our (also regular)
grid onto USGS's cell centers avoids a second interpolation step for the
distance-binning (USGS cell centers are also where distance-from-epicenter
is most naturally defined per the grid's own catalog).
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from scipy.interpolate import RegularGridInterpolator

from shake_service.forward import ForwardMap

EARTH_RADIUS_KM = 6371.0088  # matches shake_service.distances.py's convention.

DISTANCE_BINS_KM: tuple[tuple[float, float], ...] = (
    (0.0, 25.0),
    (25.0, 50.0),
    (50.0, 100.0),
    (100.0, 200.0),
    (200.0, 300.0),
)

# grid.xml PGA/PSA are published in "%g" (percent of g); PGV is already cm/s.
_PCT_G_TO_G = 1.0 / 100.0


# ---------------------------------------------------------------------------
# grid.xml parsing
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GridXML:
    """A parsed USGS ShakeMap `grid.xml`: event/grid-specification metadata
    plus one flat 1-D array per `<grid_field>` column (keyed by its `name`
    attribute, upper-cased — `"LON"`, `"LAT"`, `"MMI"`, `"PGA"`, `"PGV"`,
    ...), each length `nlon * nlat`, in the file's own row-major order
    (lat descending, lon ascending within each lat row — real USGS Atlas
    convention, not assumed/enforced by this parser)."""

    event: dict[str, Any]
    grid_specification: dict[str, float]
    nlon: int
    nlat: int
    fields: dict[str, np.ndarray]

    def field(self, name: str) -> np.ndarray:
        key = name.upper()
        if key not in self.fields:
            raise KeyError(f"GridXML.field: {name!r} not found (have: {sorted(self.fields)})")
        return self.fields[key]

    @property
    def lon(self) -> np.ndarray:
        return self.field("LON")

    @property
    def lat(self) -> np.ndarray:
        return self.field("LAT")


_ATTR_RE = re.compile(r'(\w+)="([^"]*)"')
_NUMERIC_KEYS = {
    "magnitude", "depth", "lat", "lon",
    "lon_min", "lat_min", "lon_max", "lat_max",
    "nominal_lon_spacing", "nominal_lat_spacing", "nlon", "nlat",
    "intensity_observations", "seismic_stations",
}


def _parse_attrs(tag_text: str) -> dict[str, Any]:
    """`<tag a="1" b="x" />` -> `{"a": "1", "b": "x"}`, numeric-coercing the
    keys `grid.xml` is known to use numerically (`_NUMERIC_KEYS`) — an
    attribute-name allowlist rather than a blanket "try float()" so a
    genuinely textual attribute (`event_id`, `shakemap_originator`, ...)
    never silently becomes `nan`/throws."""
    out: dict[str, Any] = {}
    for key, value in _ATTR_RE.findall(tag_text):
        if key in ("nlon", "nlat"):
            out[key] = int(value)
        elif key in _NUMERIC_KEYS:
            out[key] = float(value)
        else:
            out[key] = value
    return out


def parse_shakemap_grid_xml(text: str) -> GridXML:
    """Parse a `grid.xml` document already read into memory. Deliberately
    NOT a full XML DOM parse (`xml.etree`) — `grid.xml` for a regional/major
    event is tens of MB of `<grid_data>` rows and a hand-rolled
    header-regex + `numpy` text parse is both faster and simpler than
    building a DOM only to throw it away; the header (event/spec/field
    tags) is small and genuinely benefits from a light structural parse.
    """
    event_match = re.search(r"<event\b[^>]*/>", text)
    if not event_match:
        raise ValueError("parse_shakemap_grid_xml: no <event/> tag found")
    event = _parse_attrs(event_match.group(0))

    spec_match = re.search(r"<grid_specification\b[^>]*/>", text)
    if not spec_match:
        raise ValueError("parse_shakemap_grid_xml: no <grid_specification/> tag found")
    spec_raw = _parse_attrs(spec_match.group(0))
    grid_specification = {
        k: float(v) for k, v in spec_raw.items()
        if k in ("lon_min", "lat_min", "lon_max", "lat_max", "nominal_lon_spacing", "nominal_lat_spacing")
    }
    nlon = int(spec_raw["nlon"])
    nlat = int(spec_raw["nlat"])

    field_names = [m.group(1) for m in re.finditer(r'<grid_field\s+index="\d+"\s+name="(\w+)"', text)]
    if not field_names:
        raise ValueError("parse_shakemap_grid_xml: no <grid_field> tags found")

    data_match = re.search(r"<grid_data>(.*)</grid_data>", text, flags=re.DOTALL)
    if not data_match:
        raise ValueError("parse_shakemap_grid_xml: no <grid_data> block found")
    body = data_match.group(1).strip()
    if not body:
        raise ValueError("parse_shakemap_grid_xml: <grid_data> block is empty")

    values = np.loadtxt(io.StringIO(body), dtype=float)
    if values.ndim == 1:  # a single-row grid.xml (degenerate, but valid)
        values = values.reshape(1, -1)
    if values.shape[1] != len(field_names):
        raise ValueError(
            f"parse_shakemap_grid_xml: {values.shape[1]} data columns but "
            f"{len(field_names)} <grid_field> tags"
        )
    if values.shape[0] != nlon * nlat:
        raise ValueError(
            f"parse_shakemap_grid_xml: {values.shape[0]} data rows but "
            f"grid_specification declares nlon*nlat = {nlon}*{nlat} = {nlon * nlat}"
        )

    fields = {name.upper(): values[:, i] for i, name in enumerate(field_names)}
    return GridXML(event=event, grid_specification=grid_specification, nlon=nlon, nlat=nlat, fields=fields)


def load_shakemap_grid_xml(path: str | Path) -> GridXML:
    """Read and parse a `grid.xml` file from disk."""
    text = Path(path).read_text()
    return parse_shakemap_grid_xml(text)


# ---------------------------------------------------------------------------
# Resampling our ForwardMap onto arbitrary (lon, lat) query points
# ---------------------------------------------------------------------------


def resample_grid_to_points(
    lon_axis: np.ndarray, lat_axis: np.ndarray, values_2d: np.ndarray,
    query_lon: np.ndarray, query_lat: np.ndarray,
) -> np.ndarray:
    """Bilinear-resample a regular `(ny, nx)` grid (axes `lat_axis`/
    `lon_axis`, ascending) onto arbitrary points; points outside the grid's
    bounding box come back `NaN` (never extrapolated)."""
    interpolator = RegularGridInterpolator(
        (lat_axis, lon_axis), values_2d, method="linear", bounds_error=False, fill_value=np.nan,
    )
    points = np.stack([np.asarray(query_lat, dtype=float), np.asarray(query_lon, dtype=float)], axis=-1)
    return interpolator(points)


def resample_forward_map_to_points(
    forward_map: ForwardMap, query_lon: np.ndarray, query_lat: np.ndarray,
) -> dict[str, np.ndarray]:
    """Resample every `ForwardMap` channel this module compares onto
    `(query_lon, query_lat)`: `pga_g`/`pga_sigma_ln`, `pgv_cms`/
    `pgv_sigma_ln`, `mmi`/`mmi_sigma` (linear mean, ln-space sigma for
    PGA/PGV per the package-wide numeric contract)."""
    lon_axis = forward_map.lon2d[0, :]
    lat_axis = forward_map.lat2d[:, 0]

    def _resample(values_2d: np.ndarray) -> np.ndarray:
        return resample_grid_to_points(lon_axis, lat_axis, values_2d, query_lon, query_lat)

    return {
        "pga_g": _resample(forward_map.pga.mean),
        "pga_sigma_ln": _resample(forward_map.pga.sigma_ln),
        "pgv_cms": _resample(forward_map.pgv.mean),
        "pgv_sigma_ln": _resample(forward_map.pgv.sigma_ln),
        "mmi": _resample(forward_map.mmi.mean),
        "mmi_sigma": _resample(forward_map.mmi.sigma),
    }


# ---------------------------------------------------------------------------
# Core residual statistics (pure math, unit-tested on synthetic arrays)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ResidualStats:
    bias: float
    rmse: float
    mae: float
    n: int

    def to_dict(self) -> dict[str, float | int]:
        return {"bias": self.bias, "rmse": self.rmse, "mae": self.mae, "n": self.n}


def residual_stats(residual: np.ndarray) -> ResidualStats:
    """Bias (mean), RMSE, MAE of a residual array — `NaN`s excluded (never
    silently counted as zero)."""
    residual = np.asarray(residual, dtype=float)
    finite = residual[np.isfinite(residual)]
    if finite.size == 0:
        return ResidualStats(bias=float("nan"), rmse=float("nan"), mae=float("nan"), n=0)
    return ResidualStats(
        bias=float(np.mean(finite)),
        rmse=float(np.sqrt(np.mean(finite**2))),
        mae=float(np.mean(np.abs(finite))),
        n=int(finite.size),
    )


def fraction_within_sigma(residual: np.ndarray, sigma: np.ndarray, *, k: float = 1.0) -> float:
    """Fraction of (finite) `residual`/`sigma` pairs with `|residual| <=
    k * sigma` — the D20 "≥60% of USGS cells inside our ±1σ" criterion,
    generalized over `k`."""
    residual = np.asarray(residual, dtype=float)
    sigma = np.asarray(sigma, dtype=float)
    mask = np.isfinite(residual) & np.isfinite(sigma)
    if not np.any(mask):
        return float("nan")
    within = np.abs(residual[mask]) <= k * sigma[mask]
    return float(np.mean(within))


def distance_binned_bias(
    residual: np.ndarray, distance_km: np.ndarray, *, bins: tuple[tuple[float, float], ...] = DISTANCE_BINS_KM,
) -> list[dict[str, Any]]:
    """Per-distance-bin bias/RMSE/MAE/n, `bins` = `(lo, hi]`-style ranges in
    km (lo inclusive, hi exclusive except the last bin, which is
    inclusive at both ends — matches `np.histogram`-style binning intent
    without pulling in `np.histogram` for a 5-bin table)."""
    residual = np.asarray(residual, dtype=float)
    distance_km = np.asarray(distance_km, dtype=float)
    table: list[dict[str, Any]] = []
    for i, (lo, hi) in enumerate(bins):
        is_last = i == len(bins) - 1
        in_bin = (distance_km >= lo) & (distance_km <= hi if is_last else distance_km < hi)
        stats = residual_stats(residual[in_bin])
        table.append({"distance_km_min": lo, "distance_km_max": hi, **stats.to_dict()})
    return table


def epicentral_distance_km(event_lon: float, event_lat: float, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Haversine epicentral distance (km, spherical Earth) — matches
    `shake_service.distances.py`'s `EARTH_RADIUS_KM` convention (this
    module's own comparison distances, not conditioning-covariance
    distances, so no need to match `mvn.py`'s separate 6371.0 constant)."""
    lon = np.radians(np.asarray(lon, dtype=float))
    lat = np.radians(np.asarray(lat, dtype=float))
    lon0 = np.radians(event_lon)
    lat0 = np.radians(event_lat)
    dlat = lat - lat0
    dlon = lon - lon0
    a = np.sin(dlat / 2.0) ** 2 + np.cos(lat0) * np.cos(lat) * np.sin(dlon / 2.0) ** 2
    c = 2.0 * np.arctan2(np.sqrt(a), np.sqrt(np.clip(1.0 - a, 0.0, None)))
    return EARTH_RADIUS_KM * c


# ---------------------------------------------------------------------------
# Orchestrator: ForwardMap vs. a parsed USGS grid.xml
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ComparisonResult:
    n_usgs_cells: int
    n_compared: int  # cells inside our grid's bounding box
    pga_ln: ResidualStats
    pgv_ln: ResidualStats
    mmi: ResidualStats
    pga_frac_within_1sigma: float
    pgv_frac_within_1sigma: float
    distance_bins_km: tuple[tuple[float, float], ...]
    pga_ln_by_distance: list[dict[str, Any]]
    pgv_ln_by_distance: list[dict[str, Any]]

    def to_dict(self) -> dict[str, Any]:
        return {
            "n_usgs_cells": self.n_usgs_cells,
            "n_compared": self.n_compared,
            "pga_ln": self.pga_ln.to_dict(),
            "pgv_ln": self.pgv_ln.to_dict(),
            "mmi": self.mmi.to_dict(),
            "pga_frac_within_1sigma": self.pga_frac_within_1sigma,
            "pgv_frac_within_1sigma": self.pgv_frac_within_1sigma,
            "distance_bins_km": [list(b) for b in self.distance_bins_km],
            "pga_ln_by_distance": self.pga_ln_by_distance,
            "pgv_ln_by_distance": self.pgv_ln_by_distance,
        }


def compare_forward_map_to_grid(
    forward_map: ForwardMap, grid_xml: GridXML, *,
    event_lon: float | None = None, event_lat: float | None = None,
    bins: tuple[tuple[float, float], ...] = DISTANCE_BINS_KM,
) -> ComparisonResult:
    """The full D20 smoke-test comparison: resample `forward_map` onto
    every `grid_xml` cell center, compute ln-space PGA/PGV residuals
    (ours - USGS) + intensity-unit MMI residuals, bias/RMSE/MAE, ±1σ
    coverage, and a distance-binned PGA/PGV bias table. USGS cells outside
    `forward_map`'s (magnitude-scaled, smaller) grid extent are excluded
    from every statistic (`n_compared` records how many remained)."""
    usgs_lon = grid_xml.lon
    usgs_lat = grid_xml.lat
    usgs_pga_g = grid_xml.field("PGA") * _PCT_G_TO_G
    usgs_pgv_cms = grid_xml.field("PGV")
    usgs_mmi = grid_xml.field("MMI")

    resampled = resample_forward_map_to_points(forward_map, usgs_lon, usgs_lat)
    in_domain = np.isfinite(resampled["pga_g"])

    our_pga_ln = np.log(resampled["pga_g"][in_domain])
    usgs_pga_ln = np.log(usgs_pga_g[in_domain])
    pga_residual_ln = our_pga_ln - usgs_pga_ln
    pga_sigma = resampled["pga_sigma_ln"][in_domain]

    our_pgv_ln = np.log(resampled["pgv_cms"][in_domain])
    usgs_pgv_ln = np.log(usgs_pgv_cms[in_domain])
    pgv_residual_ln = our_pgv_ln - usgs_pgv_ln
    pgv_sigma = resampled["pgv_sigma_ln"][in_domain]

    mmi_residual = resampled["mmi"][in_domain] - usgs_mmi[in_domain]

    ev_lon = event_lon if event_lon is not None else forward_map.event["lon"]
    ev_lat = event_lat if event_lat is not None else forward_map.event["lat"]
    distance_km = epicentral_distance_km(ev_lon, ev_lat, usgs_lon[in_domain], usgs_lat[in_domain])

    return ComparisonResult(
        n_usgs_cells=int(usgs_lon.size),
        n_compared=int(np.count_nonzero(in_domain)),
        pga_ln=residual_stats(pga_residual_ln),
        pgv_ln=residual_stats(pgv_residual_ln),
        mmi=residual_stats(mmi_residual),
        pga_frac_within_1sigma=fraction_within_sigma(pga_residual_ln, pga_sigma, k=1.0),
        pgv_frac_within_1sigma=fraction_within_sigma(pgv_residual_ln, pgv_sigma, k=1.0),
        distance_bins_km=bins,
        pga_ln_by_distance=distance_binned_bias(pga_residual_ln, distance_km, bins=bins),
        pgv_ln_by_distance=distance_binned_bias(pgv_residual_ln, distance_km, bins=bins),
    )
