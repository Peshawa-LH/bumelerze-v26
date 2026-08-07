"""export — `forward.ForwardMap` -> USGS-compatible product bundle (D9's
"product-shaped contract": MMI-contour GeoJSON + metadata + a compact
raster-ready grid), wave C.

Three products, one `write_products` call:

  (a) `cont_mi.json` — a `cont_mi.json`-SHAPED GeoJSON `FeatureCollection`
      (the exact schema `src/features/shakemap/contours.ts` parses: a
      `Feature` per intensity level, `properties.value` a number,
      `geometry` a `MultiLineString`) built by marching squares
      (`skimage.measure.find_contours`) at half-intensity levels (1.0, 1.5,
      2.0, ... — the USGS convention). **Scale note, deliberate:** the task
      brief calls for contouring "the EMS intensity grid" — i.e. the VALUES
      in this file are our own EMS-98 scale (D7: "own macroseismic data
      ONLY"; IMS-25-ready per the D7 2026-08-04 amendment), not USGS MMI,
      even though the file keeps the `cont_mi.json` NAME/SHAPE for
      drop-in compatibility with the app's existing producer-agnostic
      renderer (D9, `contours.ts`'s doc comment: "a future
      `bumelerze-shake-service` output ... could ship filled polygons
      directly" — same spirit, applied to the value's scale instead). The
      scale actually used is recorded honestly in every feature's
      `properties.units` AND in `info.json`'s `intensity.scale` field, so
      no downstream consumer is misled. `build_cont_mi_product(..., channel=)`
      also accepts `channel="mmi"` to export the Worden validation channel
      instead, for anyone who wants a literal MMI product.
  (b) `info.json` — event params, engine chain (gmpe_forward branches +
      weights, GMICE channels, conditioning if any), data-used list,
      version/timestamps, extrapolation/depth tags, producer identity. Not
      yet parsed by the app (`usgs-products.ts`'s own doc comment) — this
      module's shape is a clean, documented design, not a USGS-info.json
      clone (the toolkit's/USGS's `info.json` "input"/"output"/"processing"
      sections are not reproduced verbatim; nothing here needs to match
      them).
  (c) `grid.json` — a compact row-major raster (lon/lat/EMS/MMI/PGA/PGV +
      each channel's sigma), for a future raster overlay renderer.

Round-trip guarantee (tested in `tests/test_export.py`): a contour at level
`v`, re-parsed, separates grid cells with `mean < v` from cells with
`mean > v` — the ring's polygon interior corresponds to "at or above `v`"
the same way USGS's own filled/isoline convention does.
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import asdict
from pathlib import Path
from typing import Any, Literal

import numpy as np
from skimage import measure

from shake_service import config
from shake_service.forward import ForwardMap, IntensityGrid

PRODUCER = "bumelerze-shake-service"
PRODUCT_SCHEMA_VERSION = 1

# USGS ShakeMap convention: half-intensity contour levels (1.0, 1.5, 2.0, ...).
CONTOUR_STEP = 0.5

IntensityChannelName = Literal["ems", "mmi"]


# ---------------------------------------------------------------------------
# (a) cont_mi.json-shaped contours
# ---------------------------------------------------------------------------


def default_contour_levels(mean_grid: np.ndarray, *, step: float = CONTOUR_STEP) -> list[float]:
    """Half-intensity levels spanning the grid's value range, USGS-style
    (1.0, 1.5, 2.0, ...) — the two extreme levels bounding
    `[mean_grid.min(), mean_grid.max()]` are included even though a level
    exactly at the data min/max produces an empty contour (skimage's
    `find_contours` handles this silently, see module test); harmless to
    request, keeps the level list a clean arithmetic sequence rather than
    one with an off-by-one trimmed edge.
    """
    finite = mean_grid[np.isfinite(mean_grid)]
    if finite.size == 0:
        return []
    lo = np.floor(finite.min() / step) * step
    hi = np.ceil(finite.max() / step) * step
    n = int(round((hi - lo) / step)) + 1
    # round() guards float accumulation (e.g. 0.1 + 0.1 + 0.1 != 0.3) from
    # ever leaking a level like 4.499999999999 into product output.
    return [round(lo + i * step, 10) for i in range(n)]


def _ring_from_rowcol(
    path_rc: np.ndarray, lon_axis: np.ndarray, lat_axis: np.ndarray
) -> list[list[float]]:
    """One `find_contours` path (fractional (row, col) pairs) -> a list of
    `[lon, lat]` pairs via linear interpolation along each regular axis
    (row -> lat index, col -> lon index — `forward.py`'s `np.meshgrid(...,
    indexing="ij")` convention: axis 0 is lat, axis 1 is lon)."""
    rows = path_rc[:, 0]
    cols = path_rc[:, 1]
    row_idx = np.arange(lat_axis.size, dtype=float)
    col_idx = np.arange(lon_axis.size, dtype=float)
    lats = np.interp(rows, row_idx, lat_axis)
    lons = np.interp(cols, col_idx, lon_axis)
    return [[float(lo), float(la)] for lo, la in zip(lons, lats)]


def contour_geojson(
    mean_grid: np.ndarray,
    lon_axis: np.ndarray,
    lat_axis: np.ndarray,
    *,
    levels: list[float] | None = None,
    min_ring_points: int = 3,
    units: str = "ems",
) -> dict[str, Any]:
    """Marching-squares contours of a 2-D `(ny, nx)` grid at `levels`
    (default: `default_contour_levels`) -> a `FeatureCollection` in the
    exact shape `src/features/shakemap/contours.ts` parses: one `Feature`
    per level, `geometry.type == "MultiLineString"`, `coordinates` = every
    ring found at that level (closed rings repeat their first point as
    their last, matching real USGS output — see module docstring/tests).

    `lon_axis`/`lat_axis` are the grid's own regular 1-D axes (length
    `nx`/`ny`) — `mean_grid[i, j]` sits at `(lat_axis[i], lon_axis[j])`.
    Rings shorter than `min_ring_points` points are dropped (mirrors the
    app's own `SHAKEMAP_MIN_RING_POINTS` filter — see `contours.ts` and
    `config.ts`; keeping degenerate slivers out of the product is strictly
    better than shipping them and relying on the client to filter).
    """
    mean_grid = np.asarray(mean_grid, dtype=float)
    if mean_grid.ndim != 2:
        raise ValueError(f"contour_geojson: mean_grid must be 2-D, got shape {mean_grid.shape}")
    if mean_grid.shape != (lat_axis.size, lon_axis.size):
        raise ValueError(
            f"contour_geojson: mean_grid shape {mean_grid.shape} does not match "
            f"(len(lat_axis), len(lon_axis)) = ({lat_axis.size}, {lon_axis.size})"
        )
    resolved_levels = levels if levels is not None else default_contour_levels(mean_grid)

    features: list[dict[str, Any]] = []
    for value in resolved_levels:
        paths = measure.find_contours(mean_grid, float(value))
        rings = [
            _ring_from_rowcol(path, lon_axis, lat_axis)
            for path in paths
            if path.shape[0] >= min_ring_points
        ]
        if not rings:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {"value": float(value), "units": units},
                "geometry": {"type": "MultiLineString", "coordinates": rings},
            }
        )

    return {"type": "FeatureCollection", "features": features}


def build_cont_mi_product(
    forward_map: ForwardMap, *, channel: IntensityChannelName = "ems"
) -> dict[str, Any]:
    """`cont_mi.json`-shaped contours from one of `forward_map`'s two
    intensity channels — `"ems"` (default, per task scope: our native
    scale, D7) or `"mmi"` (the Worden validation channel)."""
    grid = _intensity_channel(forward_map, channel)
    lon_axis = forward_map.lon2d[0, :]
    lat_axis = forward_map.lat2d[:, 0]
    return contour_geojson(grid.mean, lon_axis, lat_axis, units=channel)


def _intensity_channel(forward_map: ForwardMap, channel: IntensityChannelName) -> IntensityGrid:
    if channel == "ems":
        return forward_map.ems
    if channel == "mmi":
        return forward_map.mmi
    raise ValueError(f"_intensity_channel: unknown channel {channel!r} (want 'ems' or 'mmi')")


# ---------------------------------------------------------------------------
# (b) info.json — product metadata
# ---------------------------------------------------------------------------


DEFAULT_REVIEW_STATUS = "automatic"  # D21: "every product carries review_status (automatic | reviewed)"


def build_info_product(
    forward_map: ForwardMap,
    *,
    contour_channel: IntensityChannelName = "ems",
    product_version: int = 1,
    generated_at: _dt.datetime | None = None,
    review_status: str = DEFAULT_REVIEW_STATUS,
    reviewed_by: str | None = None,
    reviewed_at: str | None = None,
) -> dict[str, Any]:
    """Event params, engine chain, data-used list, version/timestamps,
    extrapolation/depth tags, producer identity, and D21's scientist-review
    status — everything a consumer (or a human reviewing a product bundle)
    needs to know how this map was made, without needing to re-derive it
    from `ForwardMap` internals.

    `review_status` (D21, `docs/decisions.md`: "every product carries
    review_status (automatic | reviewed); the app displays it
    (provenance-as-UI)"): defaults to `"automatic"` — every product this
    module writes is machine-generated until a human explicitly flips it,
    the v1 review channel being `scripts/review_product.py`
    (`shake_service.review.mark_reviewed`), which re-writes an ALREADY
    EXPORTED `info.json` with `review_status="reviewed"` plus
    `reviewed_by`/`reviewed_at` — this function's own `reviewed_by`/
    `reviewed_at` parameters exist only so that round trip is a straight
    "read the dict, overwrite these three keys, write it back", never a
    hand-rolled partial-JSON edit."""
    if review_status not in ("automatic", "reviewed"):
        raise ValueError(f"build_info_product: review_status must be 'automatic' or 'reviewed', got {review_status!r}")
    ts = (generated_at or _dt.datetime.now(_dt.timezone.utc)).isoformat()

    branches = [
        {"key": b.key, "weight": forward_map.weights.get(b.key), "citation": b.citation}
        for b in config.GSIM_BRANCHES
    ]

    extrapolation_flags = asdict(forward_map.extrapolation)
    # tuples -> lists for clean JSON serialization.
    extrapolation_flags["magnitude_extrapolated_branches"] = list(
        extrapolation_flags["magnitude_extrapolated_branches"]
    )
    extrapolation_flags["distance_extrapolated_branches"] = list(
        extrapolation_flags["distance_extrapolated_branches"]
    )

    return {
        "product_schema_version": PRODUCT_SCHEMA_VERSION,
        "producer": PRODUCER,
        "product_version": product_version,
        "generated_at": ts,
        "event": dict(forward_map.event),
        "band": forward_map.band,
        # D22 "IMS-25 as the app's public scale": EMS-98 and IMS-25 are
        # treated as ONE scale (IMS-25 extends EMS-98; this service's own
        # `intensity.py` chain already implements the IMS-25/Zanini tables,
        # unchanged by this rename — see that module + README.md's own
        # D22 note). This is the public-facing metadata label; `intensity.
        # scale` below is untouched, internal-facing (D22 task wording:
        # "internal code names stay as-is; this is display language only").
        "intensity_scale": "IMS-25 (EMS-98)" if contour_channel == "ems" else "MMI",
        "intensity": {
            "contour_channel": contour_channel,
            "scale": "EMS-98" if contour_channel == "ems" else "MMI",
        },
        "engine": {
            "chain": ["gmpe_forward"],
            "gmpe_forward": {
                "mixture": "Option-C (law-of-total-variance)",
                "logic_tree": branches,
            },
            "gmice": {
                "ems_model": forward_map.version.get("ems_model"),
                "mmi_model": forward_map.version.get("mmi_model"),
            },
            "conditioning": None,
        },
        "data_used": dict(forward_map.data_used),
        "vs30": dict(forward_map.vs30_meta),
        "grid": dict(forward_map.grid_meta),
        "flags": {
            "in_zagros_polygon": forward_map.in_zagros_polygon,
            "depth_extrapolated": forward_map.depth_extrapolated,
            "extrapolation": extrapolation_flags,
        },
        "version": dict(forward_map.version),
        "review_status": review_status,
        "reviewed_by": reviewed_by,
        "reviewed_at": reviewed_at,
    }


# ---------------------------------------------------------------------------
# (c) grid.json — compact raster
# ---------------------------------------------------------------------------


def build_grid_product(forward_map: ForwardMap) -> dict[str, Any]:
    """Compact row-major raster: `lon`/`lat`/`ems`/`mmi`/`pga`/`pgv` means
    plus each channel's total sigma, flattened C-order (matching
    `ForwardMap`'s own `(ny, nx)` row-major layout — `shape` is included so
    a consumer can `np.reshape` back to 2-D). PGA is `g`, PGV is `cm/s`,
    EMS/MMI are their native intensity units; sigma fields are ln-space for
    PGA/PGV and intensity-units for EMS/MMI (same convention as
    `ForwardMap`'s own dataclasses — documented once, here, rather than
    repeated per key)."""
    shape = forward_map.grid_meta["shape"]
    return {
        "product_schema_version": PRODUCT_SCHEMA_VERSION,
        "producer": PRODUCER,
        "shape": list(shape),
        "lon": forward_map.lon2d.ravel().tolist(),
        "lat": forward_map.lat2d.ravel().tolist(),
        "ems": forward_map.ems.mean.ravel().tolist(),
        "ems_sigma": forward_map.ems.sigma.ravel().tolist(),
        "mmi": forward_map.mmi.mean.ravel().tolist(),
        "mmi_sigma": forward_map.mmi.sigma.ravel().tolist(),
        "pga_g": forward_map.pga.mean.ravel().tolist(),
        "pga_sigma_ln": forward_map.pga.sigma_ln.ravel().tolist(),
        "pgv_cms": forward_map.pgv.mean.ravel().tolist(),
        "pgv_sigma_ln": forward_map.pgv.sigma_ln.ravel().tolist(),
    }


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def write_products(
    forward_map: ForwardMap,
    out_dir: str | Path,
    *,
    contour_channel: IntensityChannelName = "ems",
    product_version: int = 1,
    generated_at: _dt.datetime | None = None,
    review_status: str = DEFAULT_REVIEW_STATUS,
    reviewed_by: str | None = None,
    reviewed_at: str | None = None,
) -> dict[str, Path]:
    """Write `cont_mi.json` + `info.json` + `grid.json` into `out_dir`
    (created if missing). Returns the three paths written, keyed
    `"cont_mi" | "info" | "grid"`. `review_status`/`reviewed_by`/
    `reviewed_at` pass straight through to `build_info_product` (D21) —
    every freshly (re)computed version starts `"automatic"`;
    `scripts/review_product.py` is the only thing that ever writes
    `"reviewed"`, and it does so by re-writing an already-exported
    `info.json`, not by calling this function again."""
    import json

    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    products = {
        "cont_mi": build_cont_mi_product(forward_map, channel=contour_channel),
        "info": build_info_product(
            forward_map,
            contour_channel=contour_channel,
            product_version=product_version,
            generated_at=generated_at,
            review_status=review_status,
            reviewed_by=reviewed_by,
            reviewed_at=reviewed_at,
        ),
        "grid": build_grid_product(forward_map),
    }

    paths: dict[str, Path] = {}
    for name, payload in products.items():
        path = out_path / f"{'cont_mi' if name == 'cont_mi' else name}.json"
        path.write_text(json.dumps(payload))
        paths[name] = path
    return paths
