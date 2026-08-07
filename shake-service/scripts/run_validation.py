#!/usr/bin/env python3
"""run_validation — the generalized D20 validation harness
(`docs/decisions.md` "D20 smoke-test checkpoint outcome", condition 3):
fetch a real USGS event's Atlas ShakeMap (+ DYFI product, if it has one),
run our forward-map engine on the same catalog params (band auto-selected
from magnitude per `config.magnitude_band`), compare our BARE prior against
the Atlas grid (wave-C-style), then — if a DYFI product exists — condition
our prior on the SAME DYFI observations via `mvn.py` and re-judge the D20
thresholds on the conditioned map (wave-D-style), computing the same
GMICE/nresp/domain sensitivity grid every time.

This supersedes `scripts/run_halabja.py` + `scripts/run_halabja_conditioned.py`
(both event-hardcoded, two separate scripts/reports) with one parameterized
tool, one unified per-event report. See this repo's `validation/` README
and `validation/SUMMARY.md` for what stays where and why.

Usage:
    ./.venv/bin/python scripts/run_validation.py --event us2000bmcg
    ./.venv/bin/python scripts/run_validation.py --event us1000hwdw \\
        --cache-dir .cache/validation/us1000hwdw --out-dir validation/us1000hwdw

Network access required on first run per event (grid.xml for a major event
is ~26 MB; cached under `--cache-dir` afterwards — never committed, see
`.gitignore`).
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # allow running as a plain script

from shake_service import comparison, conditioned_forward, config, dyfi_observations as dyfi, forward, gmm, vs30  # noqa: E402

# D20 pass criteria (`docs/decisions.md` D20 / gmpe-set-proposal-v2.md §7;
# carried over unchanged for every band this wave — no band-specific
# threshold was specified by D20 or the checkpoint-outcome condition-3 text,
# only the WEIGHTS row changes by band. If a future review wants
# band-specific thresholds, that is a new decision, not silently introduced
# here).
BIAS_THRESHOLD_LN: float = 0.3
COVERAGE_THRESHOLD: float = 0.60

REQUEST_TIMEOUT_S = 60

# Primary-vs-sensitivity conditioning choices, same as wave D
# (`run_halabja_conditioned.py`'s module docstring, points 1-2) — carried
# over verbatim, applied to any event: Worden/MMI GMICE + nresp>=3 +
# observations restricted to our own grid's magnitude-scaled domain are
# PRIMARY; Zanini/EMS, nresp>=2, and the unrestricted-domain variant are all
# computed as sensitivity checks, every run, never cherry-picked.
PRIMARY_MODEL = dyfi.DEFAULT_MODEL
SENSITIVITY_MODEL = dyfi.SENSITIVITY_MODEL
PRIMARY_MIN_NRESP = dyfi.DEFAULT_MIN_NRESP
SENSITIVITY_MIN_NRESP = dyfi.SENSITIVITY_MIN_NRESP

# Up to this many nearest non-DYFI (real instrumental) stations get a direct
# GMPE spot check (generalizes the Halabja script's single hardcoded "SPZ"
# check to whatever a given event's stationlist.json actually carries — most
# Zagros-region events, like Halabja, have ZERO instrumental stations and
# ONLY DYFI-derived macroseismic entries; that is reported plainly, not
# treated as a bug).
MAX_SPOT_CHECK_STATIONS = 3


# ---------------------------------------------------------------------------
# Distance bins, scaled to the event's own magnitude band
# ---------------------------------------------------------------------------

# The original Halabja (major band, 300 km half-extent) script used
# (0-25, 25-50, 50-100, 100-200, 200-300). That table makes little sense
# unmodified for a moderate-band event (200 km half-extent) or small-band
# event (100 km half-extent) — most/all mass would land in the first 1-2
# bins and the rest would report n=0. Bins below keep the same "finer near,
# coarser far" shape, each scaled to the band's own grid half-extent so
# every band gets 5 informative bins spanning its own domain.
DISTANCE_BINS_BY_BAND: dict[str, tuple[tuple[float, float], ...]] = {
    "major": ((0.0, 25.0), (25.0, 50.0), (50.0, 100.0), (100.0, 200.0), (200.0, 300.0)),
    "moderate": ((0.0, 15.0), (15.0, 35.0), (35.0, 70.0), (70.0, 130.0), (130.0, 200.0)),
    "small": ((0.0, 10.0), (10.0, 20.0), (20.0, 40.0), (40.0, 70.0), (70.0, 100.0)),
}


def distance_bins_for_band(band: str) -> tuple[tuple[float, float], ...]:
    return DISTANCE_BINS_BY_BAND[band]


# ---------------------------------------------------------------------------
# Fetch (cached) — event detail, product discovery
# ---------------------------------------------------------------------------


def detail_url(event_id: str) -> str:
    return f"https://earthquake.usgs.gov/fdsnws/event/1/query?eventid={event_id}&format=geojson"


def _cached_get(url: str, cache_path: Path) -> str:
    if cache_path.exists():
        return cache_path.read_text()
    response = requests.get(url, timeout=REQUEST_TIMEOUT_S)
    response.raise_for_status()
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(response.text)
    return response.text


def fetch_event_detail(event_id: str, cache_dir: Path) -> dict[str, Any]:
    text = _cached_get(detail_url(event_id), cache_dir / "detail.json")
    return json.loads(text)


def resolve_product(
    detail: dict[str, Any], product_type: str, *, preferred_source: str,
) -> dict[str, Any] | None:
    """The preferred product of `product_type` (e.g. `"shakemap"`,
    `"dyfi"`) — `source == preferred_source` (`"atlas"` for shakemap,
    `"us"` for dyfi) if present, else the highest-`preferredWeight` product
    of that type, else `None` if the event has no product of this type at
    all (never raises on a missing product — availability is reported, not
    an error; `run_validation` decides what to skip downstream)."""
    products = detail["properties"].get("products", {})
    candidates = products.get(product_type)
    if not candidates:
        return None
    preferred = [p for p in candidates if p.get("source") == preferred_source]
    if preferred:
        return preferred[0]
    return max(candidates, key=lambda p: p.get("preferredWeight", -1))


def resolve_moment_tensor_note(detail: dict[str, Any]) -> str:
    """A human-readable one-line mechanism note from the highest-weight
    `moment-tensor` product's nodal-plane-2 (the toolkit-consistent
    convention `run_halabja.py` used), or an honest "none available" string
    if the event carries no moment-tensor product. NOTE (unlike Halabja's
    hardcoded note): the mechanism reported here is NOT fed into the engine
    — `rupture_params.py` always uses the Zagros-polygon reverse/neutral
    default regardless of the real MT solution (wave A policy, unchanged
    this wave) — this is informational context only, and a caller should
    flag when the real mechanism looks materially different from the
    polygon default (this script's report does)."""
    products = detail["properties"].get("products", {})
    mts = products.get("moment-tensor")
    if not mts:
        return "no moment-tensor product available for this event"
    best = max(mts, key=lambda p: p.get("preferredWeight", -1))
    props = best.get("properties", {})
    try:
        strike = float(props["nodal-plane-2-strike"])
        dip = float(props["nodal-plane-2-dip"])
        rake = float(props["nodal-plane-2-rake"])
    except (KeyError, ValueError, TypeError):
        return "moment-tensor product present but nodal-plane-2 fields unavailable/unparseable"
    mech = _classify_rake(rake)
    return (
        f"{best.get('source', '?')} moment tensor (nodal plane 2): strike {strike:.1f}, "
        f"dip {dip:.1f}, rake {rake:.1f} ({mech}); fetched from the event detail's "
        f"moment-tensor product, not independently re-verified."
    )


def _classify_rake(rake_deg: float) -> str:
    """Coarse rake classification for the report prose only (NOT used by
    the engine — see `resolve_moment_tensor_note`'s docstring). Four 60°-wide
    "core" zones (reverse/normal/strike-slip, strike-slip split across 0 and
    ±180) leave real 30°-wide transition gaps classified "oblique" — unlike
    a naive 3-way partition with no gap, which can never actually report
    "oblique" for any rake value."""
    r = ((rake_deg + 180.0) % 360.0) - 180.0  # normalize to (-180, 180]
    if 60.0 <= r <= 120.0:
        return "near-pure reverse/thrust"
    if -120.0 <= r <= -60.0:
        return "near-pure normal"
    if -30.0 <= r <= 30.0 or r >= 150.0 or r <= -150.0:
        return "predominantly strike-slip"
    return "oblique"


# ---------------------------------------------------------------------------
# Event inputs
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EventInputs:
    event_id: str
    event_lat: float
    event_lon: float
    event_depth_km: float
    mag_mw: float
    event_time: str
    place: str
    mechanism_note: str

    shakemap_available: bool
    shakemap_product_id: str | None
    grid_xml_text: str | None
    stationlist: dict[str, Any] | None

    dyfi_available: bool
    dyfi_product_id: str | None
    dyfi_geo_10km_text: str | None


def fetch_event_inputs(event_id: str, cache_dir: Path) -> EventInputs:
    """Fetch (or reuse cached) the event detail + whatever shakemap/dyfi
    products the event actually has. Never raises on a missing product —
    `shakemap_available`/`dyfi_available` record what was found, so a
    caller can report "compare on what exists" per the task's own framing
    rather than skip an event outright for lacking one product."""
    detail = fetch_event_detail(event_id, cache_dir)
    props = detail["properties"]
    lon, lat, depth = detail["geometry"]["coordinates"]

    shakemap_product = resolve_product(detail, "shakemap", preferred_source="atlas")
    grid_xml_text: str | None = None
    stationlist: dict[str, Any] | None = None
    if shakemap_product is not None:
        contents = shakemap_product.get("contents", {})
        if "download/grid.xml" in contents:
            grid_xml_text = _cached_get(contents["download/grid.xml"]["url"], cache_dir / "grid.xml")
        if "download/stationlist.json" in contents:
            stationlist_text = _cached_get(
                contents["download/stationlist.json"]["url"], cache_dir / "stationlist.json"
            )
            stationlist = json.loads(stationlist_text)

    dyfi_product = resolve_product(detail, "dyfi", preferred_source="us")
    dyfi_geo_10km_text: str | None = None
    if dyfi_product is not None:
        contents = dyfi_product.get("contents", {})
        if "dyfi_geo_10km.geojson" in contents:
            dyfi_geo_10km_text = _cached_get(
                contents["dyfi_geo_10km.geojson"]["url"], cache_dir / "dyfi_geo_10km.geojson"
            )

    return EventInputs(
        event_id=event_id,
        event_lat=float(lat), event_lon=float(lon), event_depth_km=float(depth),
        mag_mw=float(props["mag"]),
        event_time=str(props.get("time")),
        place=str(props.get("place", "")),
        mechanism_note=resolve_moment_tensor_note(detail),
        shakemap_available=grid_xml_text is not None,
        shakemap_product_id=str(shakemap_product.get("id", "")) if shakemap_product else None,
        grid_xml_text=grid_xml_text,
        stationlist=stationlist,
        dyfi_available=dyfi_geo_10km_text is not None,
        dyfi_product_id=str(dyfi_product.get("id", "")) if dyfi_product else None,
        dyfi_geo_10km_text=dyfi_geo_10km_text,
    )


# ---------------------------------------------------------------------------
# Our forward map + generic instrumental-station spot check
# ---------------------------------------------------------------------------


def build_our_forward_map(inputs: EventInputs) -> forward.ForwardMap:
    """The bare `gmpe_forward` prior — band auto-selected from `mag_mw` by
    `forward.build_forward_map` (`config.magnitude_band`), NOT hardcoded per
    event, which is what makes this runner generalize across bands."""
    return forward.build_forward_map(
        inputs.event_lat, inputs.event_lon, inputs.event_depth_km, mag_mw=inputs.mag_mw,
    )


def find_instrumental_stations(stationlist: dict[str, Any] | None, *, max_n: int = MAX_SPOT_CHECK_STATIONS) -> list[dict[str, Any]]:
    """Real instrumental stations (`properties.source != "DYFI"`, i.e. an
    actual seismic network code) with a finite numeric `pga`, nearest first.
    Most Zagros-region events (Halabja included) carry ZERO of these —
    `stationlist.json` is DYFI-macroseismic-only — so an empty list is the
    EXPECTED result for many events, not a bug (mirrors
    `run_halabja.find_spz_station`'s same finding for `us2000bmcg`)."""
    if stationlist is None:
        return []
    candidates = []
    for feature in stationlist.get("features", []):
        props = feature.get("properties", {})
        if str(props.get("source", "")).upper() == "DYFI":
            continue
        pga = props.get("pga")
        if not isinstance(pga, (int, float)):
            continue
        candidates.append(feature)
    candidates.sort(key=lambda f: f["properties"].get("distance", float("inf")))
    return candidates[:max_n]


def spot_check_station(feature: dict[str, Any], inputs: EventInputs) -> dict[str, Any]:
    """Direct GMPE evaluation (rock-760 prior, NOT grid-interpolated) at one
    instrumental station's coordinates vs. its own reported PGA (`%g` in
    `stationlist.json`, converted to g here) — same method as the Halabja
    script's `spz_spot_check`, generalized to any station feature."""
    props = feature["properties"]
    lon, lat = feature["geometry"]["coordinates"][:2]
    observed_pga_g = float(props["pga"]) / 100.0  # stationlist.json pga is %g

    computed_distance_km = float(
        comparison.epicentral_distance_km(
            inputs.event_lon, inputs.event_lat, np.array([lon]), np.array([lat]),
        )[0]
    )

    sampler = vs30.UniformRockVs30()
    site_lat = np.array([lat])
    site_lon = np.array([lon])
    site_vs30 = sampler.sample(site_lat, site_lon)
    site_grid = vs30.SiteGrid(lats=site_lat, lons=site_lon, vs30=site_vs30)
    gm = gmm.compute_mixture(
        inputs.event_lat, inputs.event_lon, inputs.event_depth_km, mag_mw=inputs.mag_mw, site_grid=site_grid,
    )
    i = gm.imt_index("PGA")
    mean_ln = float(gm.mean_ln[i][0])
    tau = float(gm.tau[i][0])
    phi = float(gm.phi[i][0])
    sigma_model = float(gm.sigma_model[i][0])
    sigma_total_ln = float(np.sqrt(tau**2 + phi**2 + sigma_model**2))
    predicted_pga_g = float(np.exp(mean_ln))
    z_sigmas = (np.log(observed_pga_g) - mean_ln) / sigma_total_ln if observed_pga_g > 0 else float("nan")

    return {
        "network": props.get("network", "?"),
        "code": props.get("code", "?"),
        "name": props.get("name") or "",
        "lat": lat, "lon": lon,
        "distance_km_reported": props.get("distance"),
        "distance_km_computed": computed_distance_km,
        "observed_pga_g": observed_pga_g,
        "predicted_pga_g": predicted_pga_g,
        "sigma_ln_total": sigma_total_ln,
        "z_sigmas": float(z_sigmas),
    }


# ---------------------------------------------------------------------------
# Bare-prior comparison (wave-C-style)
# ---------------------------------------------------------------------------


def _judge(cmp_result: comparison.ComparisonResult) -> dict[str, Any]:
    pga_bias_pass = abs(cmp_result.pga_ln.bias) <= BIAS_THRESHOLD_LN
    pgv_bias_pass = abs(cmp_result.pgv_ln.bias) <= BIAS_THRESHOLD_LN
    pga_coverage_pass = cmp_result.pga_frac_within_1sigma >= COVERAGE_THRESHOLD
    pgv_coverage_pass = cmp_result.pgv_frac_within_1sigma >= COVERAGE_THRESHOLD
    return {
        "bias_pga_ln_pass": pga_bias_pass,
        "bias_pgv_ln_pass": pgv_bias_pass,
        "bias_overall_pass": pga_bias_pass and pgv_bias_pass,
        "coverage_pga_pass": pga_coverage_pass,
        "coverage_pgv_pass": pgv_coverage_pass,
        "coverage_overall_pass": pga_coverage_pass and pgv_coverage_pass,
        "thresholds": {"bias_ln": BIAS_THRESHOLD_LN, "coverage_fraction": COVERAGE_THRESHOLD},
    }


def run_bare_comparison(
    fm: forward.ForwardMap, inputs: EventInputs, grid_xml: comparison.GridXML, bins: tuple[tuple[float, float], ...],
) -> dict[str, Any]:
    cmp_result = comparison.compare_forward_map_to_grid(
        fm, grid_xml, event_lon=inputs.event_lon, event_lat=inputs.event_lat, bins=bins,
    )
    return {"comparison": cmp_result.to_dict(), "verdict": _judge(cmp_result), "_cmp_result": cmp_result}


# ---------------------------------------------------------------------------
# Conditioned comparison + sensitivity grid (wave-D-style)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ConditioningVariant:
    key: str
    label: str
    model: str
    min_nresp: int
    restrict_to_grid_domain: bool


def variants_for(primary_restrict: bool = True) -> tuple[ConditioningVariant, ...]:
    return (
        ConditioningVariant(
            key="primary", label="PRIMARY: Worden/MMI, nresp>=3, domain-restricted",
            model=PRIMARY_MODEL, min_nresp=PRIMARY_MIN_NRESP, restrict_to_grid_domain=primary_restrict,
        ),
        ConditioningVariant(
            key="sensitivity_zanini", label="sensitivity: Zanini/EMS model (else primary settings)",
            model=SENSITIVITY_MODEL, min_nresp=PRIMARY_MIN_NRESP, restrict_to_grid_domain=True,
        ),
        ConditioningVariant(
            key="sensitivity_nresp2", label="sensitivity: nresp>=2 (else primary settings)",
            model=PRIMARY_MODEL, min_nresp=SENSITIVITY_MIN_NRESP, restrict_to_grid_domain=True,
        ),
        ConditioningVariant(
            key="sensitivity_unrestricted", label="sensitivity: unrestricted domain -- global DYFI (else primary settings)",
            model=PRIMARY_MODEL, min_nresp=PRIMARY_MIN_NRESP, restrict_to_grid_domain=False,
        ),
    )


def select_observations(
    boxes: list[dyfi.DyfiBox], *, min_nresp: int, half_extent_km: float | None, restrict_to_grid_domain: bool,
) -> list[dyfi.DyfiBox]:
    filtered = dyfi.filter_by_nresp(boxes, min_nresp=min_nresp)
    if restrict_to_grid_domain:
        if half_extent_km is None:
            raise ValueError("select_observations: restrict_to_grid_domain=True requires half_extent_km")
        filtered = [b for b in filtered if b.dist_km <= half_extent_km]
    return filtered


def run_variant(
    variant: ConditioningVariant, *, fm: forward.ForwardMap, inputs: EventInputs, boxes: list[dyfi.DyfiBox],
    grid_xml: comparison.GridXML, bins: tuple[tuple[float, float], ...],
) -> dict[str, Any]:
    selected = select_observations(
        boxes, min_nresp=variant.min_nresp,
        half_extent_km=fm.grid_meta["half_extent_km"] if variant.restrict_to_grid_domain else None,
        restrict_to_grid_domain=variant.restrict_to_grid_domain,
    )
    obs_pga = dyfi.dyfi_boxes_to_station_observations(selected, imt="PGA", model=variant.model)
    obs_pgv = dyfi.dyfi_boxes_to_station_observations(selected, imt="PGV", model=variant.model)

    result = conditioned_forward.condition_forward_map_on_dyfi(
        fm, event_lat=inputs.event_lat, event_lon=inputs.event_lon, event_depth_km=inputs.event_depth_km,
        mag_mw=inputs.mag_mw, observations_pga=obs_pga, observations_pgv=obs_pgv,
    )
    cmp_result = comparison.compare_forward_map_to_grid(
        result.forward_map, grid_xml, event_lon=inputs.event_lon, event_lat=inputs.event_lat, bins=bins,
    )
    verdict = _judge(cmp_result)

    return {
        "variant": variant.key,
        "label": variant.label,
        "model": variant.model,
        "min_nresp": variant.min_nresp,
        "restrict_to_grid_domain": variant.restrict_to_grid_domain,
        "n_boxes_selected": len(selected),
        "n_conditioning_pga": result.pga.n_conditioning,
        "n_conditioning_pgv": result.pgv.n_conditioning,
        "n_colocated_merged_pga": result.pga.n_colocated_merged,
        "n_colocated_merged_pgv": result.pgv.n_colocated_merged,
        "comparison": cmp_result.to_dict(),
        "verdict": verdict,
        "_forward_map": result.forward_map,
        "_cmp_result": cmp_result,
    }


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def run_validation(event_id: str, cache_dir: Path) -> dict[str, Any]:
    inputs = fetch_event_inputs(event_id, cache_dir)
    fm = build_our_forward_map(inputs)
    bins = distance_bins_for_band(fm.band)

    stations = find_instrumental_stations(inputs.stationlist)
    spot_checks = [spot_check_station(f, inputs) for f in stations]

    grid_xml: comparison.GridXML | None = None
    bare: dict[str, Any] | None = None
    if inputs.shakemap_available:
        grid_xml = comparison.parse_shakemap_grid_xml(inputs.grid_xml_text)
        bare = run_bare_comparison(fm, inputs, grid_xml, bins)

    conditioned: dict[str, Any] | None = None
    n_dyfi_boxes_total = 0
    atlas_intensity_observations_declared = None
    if inputs.dyfi_available and grid_xml is not None:
        boxes = dyfi.parse_dyfi_geo_geojson(inputs.dyfi_geo_10km_text)
        n_dyfi_boxes_total = len(boxes)
        atlas_intensity_observations_declared = grid_xml.event.get("intensity_observations")
        variants = {
            v.key: run_variant(v, fm=fm, inputs=inputs, boxes=boxes, grid_xml=grid_xml, bins=bins)
            for v in variants_for()
        }
        conditioned = {"variants": variants}
    elif inputs.dyfi_available and grid_xml is None:
        # A DYFI product exists but no ShakeMap grid to condition/compare
        # against -- nothing to run (conditioning needs a grid to judge
        # against), documented, not silently skipped.
        pass

    return {
        "event": {
            "id": inputs.event_id,
            "lat": inputs.event_lat, "lon": inputs.event_lon,
            "depth_km": inputs.event_depth_km, "mag_mw": inputs.mag_mw,
            "time": inputs.event_time, "place": inputs.place,
            "mechanism_note": inputs.mechanism_note,
        },
        "config": {
            "gsim_branches": list(config.GSIM_KEYS),
            "band_weights": config.BAND_WEIGHTS,
            "openquake_pin": config.OPENQUAKE_PIN,
            "service_version": forward.SERVICE_VERSION,
        },
        "band": fm.band,
        "grid_half_extent_km": fm.grid_meta["half_extent_km"],
        "distance_bins_km": [list(b) for b in bins],
        "product_availability": {
            "shakemap_available": inputs.shakemap_available,
            "shakemap_product_id": inputs.shakemap_product_id,
            "dyfi_available": inputs.dyfi_available,
            "dyfi_product_id": inputs.dyfi_product_id,
        },
        "spot_checks": spot_checks,
        "bare": {k: v for k, v in bare.items() if not k.startswith("_")} if bare else None,
        "n_dyfi_boxes_total": n_dyfi_boxes_total,
        "atlas_intensity_observations_declared": atlas_intensity_observations_declared,
        "conditioned": (
            {"variants": {k: {kk: vv for kk, vv in v.items() if not kk.startswith("_")} for k, v in conditioned["variants"].items()}}
            if conditioned else None
        ),
        "thresholds": {"bias_ln": BIAS_THRESHOLD_LN, "coverage_fraction": COVERAGE_THRESHOLD},
        "generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
    }, fm, grid_xml, bare, conditioned


# ---------------------------------------------------------------------------
# REPORT.md
# ---------------------------------------------------------------------------


def _fmt_pct(x: float) -> str:
    return f"{x * 100:.1f}%" if np.isfinite(x) else "n/a"


def _pf(ok: bool) -> str:
    return "PASS" if ok else "FAIL"


def _dist_table(cmp_: dict[str, Any]) -> str:
    lines = ["| km bin | PGA ln bias | PGV ln bias | n |", "|---|---|---|---|"]
    for pga_row, pgv_row in zip(cmp_["pga_ln_by_distance"], cmp_["pgv_ln_by_distance"]):
        lo, hi = pga_row["distance_km_min"], pga_row["distance_km_max"]
        lines.append(f"| {lo:.0f}-{hi:.0f} | {pga_row['bias']:.3f} | {pgv_row['bias']:.3f} | {pga_row['n']} |")
    return "\n".join(lines)


def render_report(results: dict[str, Any]) -> str:
    ev = results["event"]
    avail = results["product_availability"]
    thresholds = results["thresholds"]

    lines: list[str] = []
    lines.append(
        f"# D20 validation — `{ev['id']}` (Mw {ev['mag_mw']:.1f}, {ev['place']}), "
        f"{results['band']} band"
    )
    lines.append("")
    lines.append(
        f"Generated {results['generated_at']}. `docs/decisions.md` \"D20 smoke-test "
        f"checkpoint outcome\" condition 3; generalized runner: `scripts/run_validation.py`."
    )
    lines.append("")
    lines.append(
        f"Event: lat {ev['lat']:.4f}, lon {ev['lon']:.4f}, depth {ev['depth_km']:.1f} km, "
        f"time {ev['time']}. Mechanism: {ev['mechanism_note']}"
    )
    lines.append(
        f"Grid: {results['band']} band, half-extent {results['grid_half_extent_km']:.0f} km "
        f"(`config.grid_extent_km`, magnitude-scaled, auto-selected from Mw {ev['mag_mw']:.1f})."
    )
    lines.append("")

    shakemap_id_suffix = f" (product id `{avail['shakemap_product_id']}`)" if avail["shakemap_product_id"] else ""
    dyfi_id_suffix = f" (product id `{avail['dyfi_product_id']}`)" if avail["dyfi_product_id"] else ""
    lines.append("## Product availability")
    lines.append("")
    lines.append(
        f"- ShakeMap (Atlas grid.xml + stationlist.json): "
        f"{'available' if avail['shakemap_available'] else 'NOT available'}{shakemap_id_suffix}"
    )
    lines.append(
        f"- DYFI (`dyfi_geo_10km.geojson`): "
        f"{'available' if avail['dyfi_available'] else 'NOT available'}{dyfi_id_suffix}"
    )
    if not avail["shakemap_available"]:
        lines.append(
            "\n**No ShakeMap product for this event — no bare-prior-vs-Atlas or "
            "conditioned comparison is possible.** This is documented, not silently "
            "skipped; nothing below the product-availability section applies."
        )
        return "\n".join(lines) + "\n"

    bare = results["bare"]
    cmp_ = bare["comparison"]
    verdict = bare["verdict"]

    lines.append("")
    lines.append("## Bare-prior vs. USGS Atlas (wave-C-style)")
    lines.append("")
    lines.append(
        "This compares our UNCONDITIONED point-source prior against USGS's Atlas grid, "
        "which is itself typically conditioned on station/DYFI observations and a "
        "finite-fault rupture, not a bare point source — perfect agreement is neither "
        "expected nor the pass criterion; the D20 numeric thresholds are. No weights "
        "were changed in response to these results."
    )
    lines.append("")
    lines.append("| Criterion | Threshold | Result | Verdict |")
    lines.append("|---|---|---|---|")
    lines.append(f"| \\|bias\\| PGA (ln) | <= {thresholds['bias_ln']} | {cmp_['pga_ln']['bias']:.3f} | **{_pf(verdict['bias_pga_ln_pass'])}** |")
    lines.append(f"| \\|bias\\| PGV (ln) | <= {thresholds['bias_ln']} | {cmp_['pgv_ln']['bias']:.3f} | **{_pf(verdict['bias_pgv_ln_pass'])}** |")
    lines.append(f"| Coverage PGA (±1σ) | >= {_fmt_pct(thresholds['coverage_fraction'])} | {_fmt_pct(cmp_['pga_frac_within_1sigma'])} | **{_pf(verdict['coverage_pga_pass'])}** |")
    lines.append(f"| Coverage PGV (±1σ) | >= {_fmt_pct(thresholds['coverage_fraction'])} | {_fmt_pct(cmp_['pgv_frac_within_1sigma'])} | **{_pf(verdict['coverage_pgv_pass'])}** |")
    lines.append("")
    lines.append(f"**Overall bare-prior gate: bias {_pf(verdict['bias_overall_pass'])}, coverage {_pf(verdict['coverage_overall_pass'])}**")
    lines.append("")
    lines.append(
        f"RMSE/MAE (ln): PGA {cmp_['pga_ln']['rmse']:.3f}/{cmp_['pga_ln']['mae']:.3f}, "
        f"PGV {cmp_['pgv_ln']['rmse']:.3f}/{cmp_['pgv_ln']['mae']:.3f}. MMI bias "
        f"{cmp_['mmi']['bias']:.3f}, RMSE {cmp_['mmi']['rmse']:.3f}. Compared over "
        f"{cmp_['n_compared']} of {cmp_['n_usgs_cells']} USGS grid cells."
    )
    lines.append("")
    lines.append("### Distance-binned PGA/PGV ln-bias (bare)")
    lines.append("")
    lines.append(_dist_table(cmp_))

    if results["spot_checks"]:
        lines.append("")
        lines.append("## Instrumental station spot check(s)")
        lines.append("")
        lines.append(
            "Real (non-DYFI) instrumental stations found in `stationlist.json` — direct "
            "GMPE evaluation (rock-760 prior) at each site vs. its own reported PGA:"
        )
        lines.append("")
        lines.append("| network/code | name | dist (km) | observed PGA (g) | predicted PGA (g) | z (σ) |")
        lines.append("|---|---|---|---|---|---|")
        for s in results["spot_checks"]:
            lines.append(
                f"| {s['network']}.{s['code']} | {s['name']} | {s['distance_km_computed']:.1f} | "
                f"{s['observed_pga_g']:.4f} | {s['predicted_pga_g']:.4f} | {s['z_sigmas']:.2f} |"
            )
    else:
        lines.append("")
        lines.append("## Instrumental station spot check")
        lines.append("")
        lines.append(
            "No real instrumental (non-DYFI) stations found in `stationlist.json` for this "
            "event — every entry is DYFI-derived macroseismic, same finding as the Halabja "
            "smoke test (`us2000bmcg`'s `seismic_stations=\"0\"`). Expected for this region, "
            "not a bug; no spot check possible."
        )

    if not avail["dyfi_available"]:
        lines.append("")
        lines.append("## Conditioned comparison")
        lines.append("")
        lines.append(
            "**No DYFI product for this event — no conditioning is possible.** The "
            "bare-prior comparison above is the full comparison available for this event "
            "(a bare-prior-only comparison is still valuable, per task framing — reported "
            "honestly rather than treated as a gap)."
        )
        return "\n".join(lines) + "\n"

    cond = results["conditioned"]
    primary = cond["variants"]["primary"]
    p_cmp = primary["comparison"]
    p_verdict = primary["verdict"]

    lines.append("")
    lines.append("## Conditioned comparison (wave-D-style)")
    lines.append("")
    lines.append(
        f"Our own fetched `dyfi_geo_10km.geojson` totals {results['n_dyfi_boxes_total']} "
        f"10km boxes worldwide before filtering; USGS's own Atlas grid declares "
        f"`intensity_observations=\"{results['atlas_intensity_observations_declared']}\"` "
        f"in its own `<event/>` tag (not expected to match exactly — different filtering "
        f"pipelines, noted not reconciled). This wave conditions our prior on the SAME "
        f"underlying DYFI product via our own `mvn.py` (unmodified, weights untouched) "
        f"and re-judges the same D20 thresholds — conditioned vs. conditioned this time."
    )
    lines.append("")
    lines.append("| Criterion | Threshold | Bare | Conditioned (primary) |")
    lines.append("|---|---|---|---|")
    lines.append(
        f"| \\|bias\\| PGA (ln) | <= {thresholds['bias_ln']} | {cmp_['pga_ln']['bias']:.3f} ({_pf(verdict['bias_pga_ln_pass'])}) "
        f"| {p_cmp['pga_ln']['bias']:.3f} ({_pf(p_verdict['bias_pga_ln_pass'])}) |"
    )
    lines.append(
        f"| \\|bias\\| PGV (ln) | <= {thresholds['bias_ln']} | {cmp_['pgv_ln']['bias']:.3f} ({_pf(verdict['bias_pgv_ln_pass'])}) "
        f"| {p_cmp['pgv_ln']['bias']:.3f} ({_pf(p_verdict['bias_pgv_ln_pass'])}) |"
    )
    lines.append(
        f"| Coverage PGA (±1σ) | >= {_fmt_pct(thresholds['coverage_fraction'])} | {_fmt_pct(cmp_['pga_frac_within_1sigma'])} ({_pf(verdict['coverage_pga_pass'])}) "
        f"| {_fmt_pct(p_cmp['pga_frac_within_1sigma'])} ({_pf(p_verdict['coverage_pga_pass'])}) |"
    )
    lines.append(
        f"| Coverage PGV (±1σ) | >= {_fmt_pct(thresholds['coverage_fraction'])} | {_fmt_pct(cmp_['pgv_frac_within_1sigma'])} ({_pf(verdict['coverage_pgv_pass'])}) "
        f"| {_fmt_pct(p_cmp['pgv_frac_within_1sigma'])} ({_pf(p_verdict['coverage_pgv_pass'])}) |"
    )
    lines.append("")
    lines.append(f"**Overall D20 gate (primary conditioned run): bias {_pf(p_verdict['bias_overall_pass'])}, coverage {_pf(p_verdict['coverage_overall_pass'])}**")
    lines.append("")
    lines.append(
        f"Primary run used {primary['n_boxes_selected']} DYFI boxes (nresp>={primary['min_nresp']}, "
        f"within our grid's own magnitude-scaled domain) — PGA conditioned on "
        f"{primary['n_conditioning_pga']} points ({primary['n_colocated_merged_pga']} co-located "
        f"merges), PGV on {primary['n_conditioning_pgv']} points "
        f"({primary['n_colocated_merged_pgv']} co-located merges). RMSE/MAE (ln): PGA "
        f"{p_cmp['pga_ln']['rmse']:.3f}/{p_cmp['pga_ln']['mae']:.3f}, PGV "
        f"{p_cmp['pgv_ln']['rmse']:.3f}/{p_cmp['pgv_ln']['mae']:.3f}. Compared over "
        f"{p_cmp['n_compared']} of {p_cmp['n_usgs_cells']} USGS grid cells."
    )
    lines.append("")
    lines.append("### Distance-binned PGA/PGV ln-bias (conditioned, primary)")
    lines.append("")
    lines.append(_dist_table(p_cmp))

    lines.append("")
    lines.append("## Sensitivity grid (every variant computed this run, not cherry-picked)")
    lines.append("")
    lines.append("| Variant | model | min nresp | domain | n obs | PGA bias | PGV bias | PGA cov | PGV cov | Verdict |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|")
    for v in cond["variants"].values():
        c = v["comparison"]
        vd = v["verdict"]
        domain = "<=grid extent" if v["restrict_to_grid_domain"] else "unrestricted (global)"
        lines.append(
            f"| {v['label']} | {v['model']} | {v['min_nresp']} | {domain} | {v['n_boxes_selected']} | "
            f"{c['pga_ln']['bias']:.3f} | {c['pgv_ln']['bias']:.3f} | "
            f"{_fmt_pct(c['pga_frac_within_1sigma'])} | {_fmt_pct(c['pgv_frac_within_1sigma'])} | "
            f"bias {_pf(vd['bias_overall_pass'])}, cov {_pf(vd['coverage_overall_pass'])} |"
        )

    lines.append("")
    lines.append("## Circularity caveat")
    lines.append("")
    lines.append(
        "As with the Halabja wave-D re-judgment: if this event's Atlas grid was itself "
        "conditioned on (some of) these same DYFI observations, moving our conditioned "
        "map closer to it is partly true validation and partly true by construction — "
        "both maps pulled toward overlapping data. The underlying GMPE-set prior, "
        "correlation model, and conditioning math remain independently testable "
        "(especially wherever our own DYFI coverage does not reach), but this comparison "
        "is not an independent skill score."
    )

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Figures
# ---------------------------------------------------------------------------


def make_figures(
    fm: forward.ForwardMap,
    bare: dict[str, Any] | None,
    conditioned: dict[str, Any] | None,
    grid_xml: comparison.GridXML | None,
    out_dir: Path,
) -> list[Path]:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    paths: list[Path] = []

    def ems_map(target_fm: forward.ForwardMap, name: str, title: str) -> None:
        fig, ax = plt.subplots(figsize=(7, 6))
        mesh = ax.pcolormesh(target_fm.lon2d, target_fm.lat2d, target_fm.ems.mean, shading="auto", cmap="YlOrRd")
        fig.colorbar(mesh, ax=ax, label="EMS-98 intensity")
        ax.set_title(title)
        ax.set_xlabel("lon")
        ax.set_ylabel("lat")
        ax.set_aspect("equal")
        path = out_dir / name
        fig.savefig(path, dpi=120, bbox_inches="tight")
        plt.close(fig)
        paths.append(path)

    def residual_map(target_fm: forward.ForwardMap, cmp_result: comparison.ComparisonResult, name: str, title: str) -> None:
        resampled = comparison.resample_forward_map_to_points(target_fm, grid_xml.lon, grid_xml.lat)
        in_domain = np.isfinite(resampled["pga_g"])
        usgs_pga_g = grid_xml.field("PGA") / 100.0
        residual_ln = np.log(resampled["pga_g"][in_domain]) - np.log(usgs_pga_g[in_domain])
        fig, ax = plt.subplots(figsize=(7, 6))
        sc = ax.scatter(
            grid_xml.lon[in_domain], grid_xml.lat[in_domain], c=residual_ln, cmap="coolwarm",
            vmin=-1.0, vmax=1.0, s=2,
        )
        fig.colorbar(sc, ax=ax, label="ln PGA residual (ours - USGS)")
        ax.set_title(f"{title} (bias={cmp_result.pga_ln.bias:.3f})")
        ax.set_xlabel("lon")
        ax.set_ylabel("lat")
        ax.set_aspect("equal")
        path = out_dir / name
        fig.savefig(path, dpi=120, bbox_inches="tight")
        plt.close(fig)
        paths.append(path)

    ems_map(fm, "ems_map.png", f"bumelerze-shake-service forward EMS map — Mw{fm.event['mag_mw']:.1f}")

    if bare is not None and grid_xml is not None:
        residual_map(fm, bare["_cmp_result"], "residual_map.png", "PGA residual map (bare)")

        fig, ax = plt.subplots(figsize=(7, 4))
        bins_list = bare["_cmp_result"].pga_ln_by_distance
        labels = [f"{b['distance_km_min']:.0f}-{b['distance_km_max']:.0f}" for b in bins_list]
        pga_bias = [b["bias"] for b in bins_list]
        pgv_bias = [b["bias"] for b in bare["_cmp_result"].pgv_ln_by_distance]
        x = np.arange(len(labels))
        width = 0.35
        ax.bar(x - width / 2, pga_bias, width, label="PGA")
        ax.bar(x + width / 2, pgv_bias, width, label="PGV")
        ax.axhline(0.0, color="black", linewidth=0.8)
        ax.axhline(BIAS_THRESHOLD_LN, color="red", linestyle="--", linewidth=0.8, label="+/-0.3 threshold")
        ax.axhline(-BIAS_THRESHOLD_LN, color="red", linestyle="--", linewidth=0.8)
        ax.set_xticks(x)
        ax.set_xticklabels(labels)
        ax.set_xlabel("distance bin (km)")
        ax.set_ylabel("ln bias (ours - USGS)")
        ax.set_title("Distance-binned PGA/PGV bias (bare)")
        ax.legend()
        path = out_dir / "distance_binned_bias.png"
        fig.savefig(path, dpi=120, bbox_inches="tight")
        plt.close(fig)
        paths.append(path)

    if conditioned is not None and grid_xml is not None:
        primary = conditioned["variants"]["primary"]
        primary_fm = primary["_forward_map"]
        ems_map(primary_fm, "ems_map_conditioned.png", f"CONDITIONED EMS map — Mw{fm.event['mag_mw']:.1f}")
        residual_map(primary_fm, primary["_cmp_result"], "residual_map_conditioned.png", "Conditioned PGA residual map")

        if bare is not None:
            fig, axes = plt.subplots(1, 2, figsize=(12, 4), sharey=True)
            for ax, key, cond_bins, bare_bins in (
                (axes[0], "PGA", primary["_cmp_result"].pga_ln_by_distance, bare["_cmp_result"].pga_ln_by_distance),
                (axes[1], "PGV", primary["_cmp_result"].pgv_ln_by_distance, bare["_cmp_result"].pgv_ln_by_distance),
            ):
                labels = [f"{b['distance_km_min']:.0f}-{b['distance_km_max']:.0f}" for b in cond_bins]
                x = np.arange(len(labels))
                width = 0.35
                ax.bar(x - width / 2, [b["bias"] for b in bare_bins], width, label="bare", color="lightgray")
                ax.bar(x + width / 2, [b["bias"] for b in cond_bins], width, label="conditioned", color="steelblue")
                ax.axhline(0.0, color="black", linewidth=0.8)
                ax.axhline(BIAS_THRESHOLD_LN, color="red", linestyle="--", linewidth=0.8)
                ax.axhline(-BIAS_THRESHOLD_LN, color="red", linestyle="--", linewidth=0.8)
                ax.set_xticks(x)
                ax.set_xticklabels(labels, rotation=45)
                ax.set_xlabel("distance bin (km)")
                ax.set_title(f"{key} ln bias, before/after")
                ax.legend()
            axes[0].set_ylabel("ln bias (ours - USGS)")
            path = out_dir / "distance_binned_bias_before_after.png"
            fig.savefig(path, dpi=120, bbox_inches="tight")
            plt.close(fig)
            paths.append(path)

    return paths


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event", required=True, help="USGS event id, e.g. us2000bmcg")
    parser.add_argument("--cache-dir", default=None)
    parser.add_argument("--out-dir", default=None)
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    cache_dir = Path(args.cache_dir) if args.cache_dir else root / ".cache" / "validation" / args.event
    out_dir = Path(args.out_dir) if args.out_dir else root / "validation" / args.event
    out_dir.mkdir(parents=True, exist_ok=True)

    results, fm, grid_xml, bare, conditioned = run_validation(args.event, cache_dir)

    (out_dir / "results.json").write_text(json.dumps(results, indent=2))
    (out_dir / "REPORT.md").write_text(render_report(results))
    figure_paths = make_figures(fm, bare, conditioned, grid_xml, out_dir)

    print(json.dumps(results.get("bare", {}).get("verdict") if results.get("bare") else {}, indent=2))
    print(f"wrote {out_dir / 'results.json'}")
    print(f"wrote {out_dir / 'REPORT.md'}")
    for path in figure_paths:
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
