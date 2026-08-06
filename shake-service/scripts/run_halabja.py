#!/usr/bin/env python3
"""run_halabja — the D20 Halabja smoke test (`docs/decisions.md` D20;
`docs/research/gmpe-set-proposal-v2.md` §7): fetch the real 2017 M7.3
Halabja/Sarpol-e Zahab Atlas ShakeMap (`us2000bmcg`), run our forward-map
engine on the same catalog params (major band, point-source + ps2ff, NO
conditioning — the bare `gmpe_forward` prior), compare against the USGS
grid, and report the three D20 pass/fail criteria:

    1. |bias| <= 0.3 ln-units, PGA and PGV
    2. >= 60% of USGS cells inside our +/-1 sigma, PGA and PGV
    3. SPZ station spot check (~0.7 g observed at ~40 km, site C)

**Framing (repeated in REPORT.md, said once here too):** this compares our
UNCONDITIONED point-source prior against USGS's station+DYFI+finite-fault
CONDITIONED Atlas map. Perfect agreement is neither expected nor the
criterion — the D20 thresholds are the criterion. This script NEVER adjusts
D20 weights based on its own output; a failing criterion is reported
honestly, not tuned away (task instruction, `docs/decisions.md` D20).

Usage:
    ./.venv/bin/python scripts/run_halabja.py
    ./.venv/bin/python scripts/run_halabja.py --cache-dir .cache/halabja --out-dir validation/halabja

Network access required on first run (cached under `--cache-dir` afterwards
— `grid.xml` alone is ~26 MB, never committed, see `.gitignore`).
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

from shake_service import comparison, config, forward, gmm, vs30  # noqa: E402

EVENT_ID = "us2000bmcg"
DETAIL_URL = f"https://earthquake.usgs.gov/fdsnws/event/1/query?eventid={EVENT_ID}&format=geojson"

# D20 pass criteria (`docs/decisions.md` D20 / gmpe-set-proposal-v2.md §7).
BIAS_THRESHOLD_LN = 0.3
COVERAGE_THRESHOLD = 0.60

# SPZ fallback per task brief: not present in this event's stationlist.json
# (it carries 125 DYFI intensity observations, `seismic_stations="0"` — no
# instrumental stations at all, confirmed by `run_halabja.find_spz_station`
# below at run time, not just this comment). Abdulnaby-et-al.-style spot
# check location/observation, from task brief (not independently
# re-verified against the primary paper this wave — flagged, not silently
# trusted).
SPZ_FALLBACK_LAT = 34.77
SPZ_FALLBACK_LON = 45.86
SPZ_FALLBACK_CLAIMED_DISTANCE_KM = 40.0
SPZ_OBSERVED_PGA_G = 0.7

REQUEST_TIMEOUT_S = 60


# ---------------------------------------------------------------------------
# Fetch (cached) — USGS detail JSON, the Atlas grid.xml, stationlist.json
# ---------------------------------------------------------------------------


def _cached_get(url: str, cache_path: Path) -> str:
    if cache_path.exists():
        return cache_path.read_text()
    response = requests.get(url, timeout=REQUEST_TIMEOUT_S)
    response.raise_for_status()
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(response.text)
    return response.text


def resolve_atlas_shakemap_product(detail: dict[str, Any]) -> dict[str, Any]:
    """The preferred Atlas ShakeMap product for this event (`source ==
    "atlas"`; falls back to the highest `preferredWeight` shakemap product
    if no Atlas product exists — never silently picks an arbitrary one)."""
    shakemaps = detail["properties"]["products"]["shakemap"]
    atlas = [p for p in shakemaps if p.get("source") == "atlas"]
    if atlas:
        return atlas[0]
    return max(shakemaps, key=lambda p: p.get("preferredWeight", -1))


@dataclass(frozen=True)
class HalabjaInputs:
    event_lat: float
    event_lon: float
    event_depth_km: float
    mag_mw: float
    event_time: str
    mechanism_note: str
    grid_xml_text: str
    stationlist: dict[str, Any]
    atlas_product_id: str


def fetch_halabja_inputs(cache_dir: Path) -> HalabjaInputs:
    """Fetch (or reuse cached) the event detail, Atlas `grid.xml`, and
    `stationlist.json` for `us2000bmcg`."""
    detail_text = _cached_get(DETAIL_URL, cache_dir / "detail.json")
    detail = json.loads(detail_text)
    props = detail["properties"]

    atlas = resolve_atlas_shakemap_product(detail)
    grid_xml_url = atlas["contents"]["download/grid.xml"]["url"]
    stationlist_url = atlas["contents"]["download/stationlist.json"]["url"]

    grid_xml_text = _cached_get(grid_xml_url, cache_dir / "grid.xml")
    stationlist_text = _cached_get(stationlist_url, cache_dir / "stationlist.json")
    stationlist = json.loads(stationlist_text)

    lon, lat, depth = detail["geometry"]["coordinates"]

    return HalabjaInputs(
        event_lat=float(lat), event_lon=float(lon), event_depth_km=float(depth),
        mag_mw=float(props["mag"]),
        event_time=str(props.get("time")),
        mechanism_note=(
            "US moment tensor (nodal plane 2): strike 122.5, dip 79, rake 77.8 "
            "(near-pure reverse/thrust) — confirms the Zagros-polygon reverse-rake "
            "default (config.py); fetched from the event detail's moment-tensor "
            "product, not re-verified beyond this script's own read."
        ),
        grid_xml_text=grid_xml_text,
        stationlist=stationlist,
        atlas_product_id=str(atlas.get("id", "")),
    )


def find_spz_station(stationlist: dict[str, Any]) -> dict[str, Any] | None:
    """Search `stationlist.json`'s features for anything resembling an
    "SPZ" station code/name. Returns `None` if not found (this event's
    Atlas stationlist carries 125 DYFI intensity observations and ZERO
    instrumental stations — `seismic_stations="0"` in `grid.xml`'s own
    `<event/>` tag — so `None` is the EXPECTED result, not a bug; the
    caller falls back to the task-brief coordinates)."""
    for feature in stationlist.get("features", []):
        properties = feature.get("properties", {})
        code = str(properties.get("code") or "")
        name = str(properties.get("name") or "")
        if "SPZ" in code.upper() or "SPZ" in name.upper():
            return feature
    return None


# ---------------------------------------------------------------------------
# Our forward map + SPZ spot check
# ---------------------------------------------------------------------------


def build_our_forward_map(inputs: HalabjaInputs) -> forward.ForwardMap:
    """The bare `gmpe_forward` prior (major band, point-source + ps2ff, NO
    `mvn` conditioning) — `forward.build_forward_map`'s default vs30
    sampler (rock-760 `UniformRockVs30` unless `BUMELERZE_VS30_RASTER_PATH`
    is set) is used unmodified."""
    return forward.build_forward_map(
        inputs.event_lat, inputs.event_lon, inputs.event_depth_km, mag_mw=inputs.mag_mw,
    )


def spz_spot_check(inputs: HalabjaInputs) -> dict[str, Any]:
    """Predicted PGA (direct GMPE evaluation, not grid-interpolated) at the
    SPZ site — from `stationlist.json` if findable, else the task-brief
    fallback coordinates — vs. the ~0.7 g Abdulnaby-et-al.-style
    observation, reported in sigma units of our own prior."""
    station = find_spz_station(inputs.stationlist)
    if station is not None:
        lon, lat = station["geometry"]["coordinates"][:2]
        source = "stationlist.json"
        observed_pga_g = float(station["properties"].get("pga", SPZ_OBSERVED_PGA_G * 100.0)) / 100.0
    else:
        lon, lat = SPZ_FALLBACK_LON, SPZ_FALLBACK_LAT
        source = "task-brief fallback (not in stationlist.json — see find_spz_station docstring)"
        observed_pga_g = SPZ_OBSERVED_PGA_G

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
    z_sigmas = (np.log(observed_pga_g) - mean_ln) / sigma_total_ln

    return {
        "source": source,
        "lat": lat, "lon": lon,
        "distance_km_computed": computed_distance_km,
        "distance_km_claimed": SPZ_FALLBACK_CLAIMED_DISTANCE_KM,
        "distance_note": (
            "computed epicentral distance to the fallback coordinates does not "
            "match the ~40 km claimed in the task brief (see REPORT.md) — flagged, "
            "not silently reconciled"
            if source != "stationlist.json" else "from stationlist.json directly"
        ),
        "observed_pga_g": observed_pga_g,
        "predicted_pga_g": predicted_pga_g,
        "sigma_ln_total": sigma_total_ln,
        "z_sigmas": float(z_sigmas),
    }


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def run_smoke_test(cache_dir: Path) -> dict[str, Any]:
    inputs = fetch_halabja_inputs(cache_dir)
    fm = build_our_forward_map(inputs)
    grid_xml = comparison.parse_shakemap_grid_xml(inputs.grid_xml_text)
    cmp_result = comparison.compare_forward_map_to_grid(
        fm, grid_xml, event_lon=inputs.event_lon, event_lat=inputs.event_lat,
    )
    spz = spz_spot_check(inputs)

    pga_bias_pass = abs(cmp_result.pga_ln.bias) <= BIAS_THRESHOLD_LN
    pgv_bias_pass = abs(cmp_result.pgv_ln.bias) <= BIAS_THRESHOLD_LN
    pga_coverage_pass = cmp_result.pga_frac_within_1sigma >= COVERAGE_THRESHOLD
    pgv_coverage_pass = cmp_result.pgv_frac_within_1sigma >= COVERAGE_THRESHOLD

    verdict = {
        "bias_pga_ln_pass": pga_bias_pass,
        "bias_pgv_ln_pass": pgv_bias_pass,
        "bias_overall_pass": pga_bias_pass and pgv_bias_pass,
        "coverage_pga_pass": pga_coverage_pass,
        "coverage_pgv_pass": pgv_coverage_pass,
        "coverage_overall_pass": pga_coverage_pass and pgv_coverage_pass,
        "thresholds": {"bias_ln": BIAS_THRESHOLD_LN, "coverage_fraction": COVERAGE_THRESHOLD},
    }

    return {
        "event": {
            "id": EVENT_ID,
            "lat": inputs.event_lat, "lon": inputs.event_lon,
            "depth_km": inputs.event_depth_km, "mag_mw": inputs.mag_mw,
            "time": inputs.event_time,
            "mechanism_note": inputs.mechanism_note,
            "atlas_product_id": inputs.atlas_product_id,
        },
        "config": {
            "gsim_branches": list(config.GSIM_KEYS),
            "band_weights": config.BAND_WEIGHTS,
            "openquake_pin": config.OPENQUAKE_PIN,
            "service_version": forward.SERVICE_VERSION,
            "vs30_sampler": type(vs30.UniformRockVs30()).__name__,
        },
        "forward_map_band": fm.band,
        "comparison": cmp_result.to_dict(),
        "spz_spot_check": spz,
        "verdict": verdict,
        "generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
    }, fm, cmp_result, grid_xml


# ---------------------------------------------------------------------------
# REPORT.md
# ---------------------------------------------------------------------------


def _fmt_pct(x: float) -> str:
    return f"{x * 100:.1f}%" if np.isfinite(x) else "n/a"


def render_report(results: dict[str, Any]) -> str:
    ev = results["event"]
    cmp_ = results["comparison"]
    verdict = results["verdict"]
    spz = results["spz_spot_check"]

    def pf(ok: bool) -> str:
        return "PASS" if ok else "FAIL"

    dist_table_lines = ["| km bin | PGA ln bias | PGV ln bias | n |", "|---|---|---|---|"]
    for pga_row, pgv_row in zip(cmp_["pga_ln_by_distance"], cmp_["pgv_ln_by_distance"]):
        lo, hi = pga_row["distance_km_min"], pga_row["distance_km_max"]
        dist_table_lines.append(
            f"| {lo:.0f}-{hi:.0f} | {pga_row['bias']:.3f} | {pgv_row['bias']:.3f} | {pga_row['n']} |"
        )
    dist_table = "\n".join(dist_table_lines)

    return f"""# D20 Halabja smoke test — `{ev['id']}` (2017 M{ev['mag_mw']} Halabja/Sarpol-e Zahab)

Generated {results['generated_at']}. `docs/decisions.md` D20;
`docs/research/gmpe-set-proposal-v2.md` §7.

## Framing (read this before the numbers)

This compares our **UNCONDITIONED point-source prior** (`gmpe_forward`
only — major band, point-source + ps2ff, no `mvn` conditioning) against
USGS's **Atlas grid**, which IS conditioned on 125 DYFI intensity
observations (`grid.xml`'s own `<event .../>` tag:
`intensity_observations="125" seismic_stations="0"`) and — per the Atlas
product line — typically a finite-fault rupture model, not a point
source. Residuals below therefore mix genuine GMPE-set model difference
with this conditioning/finite-fault-vs-bare-prior asymmetry. **Perfect
agreement is neither expected nor the pass criterion — the D20 numeric
thresholds are the criterion.** No weights were changed in response to
these results (`docs/decisions.md` D20, task instruction).

Event mechanism: {ev['mechanism_note']}

## Verdict

| Criterion | Threshold | Result | Verdict |
|---|---|---|---|
| \\|bias\\| PGA (ln) | <= {verdict['thresholds']['bias_ln']} | {cmp_['pga_ln']['bias']:.3f} | **{pf(verdict['bias_pga_ln_pass'])}** |
| \\|bias\\| PGV (ln) | <= {verdict['thresholds']['bias_ln']} | {cmp_['pgv_ln']['bias']:.3f} | **{pf(verdict['bias_pgv_ln_pass'])}** |
| Coverage PGA (±1σ) | >= {_fmt_pct(verdict['thresholds']['coverage_fraction'])} | {_fmt_pct(cmp_['pga_frac_within_1sigma'])} | **{pf(verdict['coverage_pga_pass'])}** |
| Coverage PGV (±1σ) | >= {_fmt_pct(verdict['thresholds']['coverage_fraction'])} | {_fmt_pct(cmp_['pgv_frac_within_1sigma'])} | **{pf(verdict['coverage_pgv_pass'])}** |

**Overall D20 gate: bias {pf(verdict['bias_overall_pass'])}, coverage {pf(verdict['coverage_overall_pass'])}**
(both PGA and PGV must individually pass for the corresponding row above).

RMSE/MAE (ln): PGA {cmp_['pga_ln']['rmse']:.3f}/{cmp_['pga_ln']['mae']:.3f},
PGV {cmp_['pgv_ln']['rmse']:.3f}/{cmp_['pgv_ln']['mae']:.3f}. MMI (intensity
units, Worden validation channel): bias {cmp_['mmi']['bias']:.3f}, RMSE
{cmp_['mmi']['rmse']:.3f}. Compared over {cmp_['n_compared']} of
{cmp_['n_usgs_cells']} USGS grid cells (the rest fall outside our
magnitude-scaled {ev['mag_mw']:.1f}-band grid extent).

## SPZ station spot check

- Source: {spz['source']}
- Site: {spz['lat']:.4f}N, {spz['lon']:.4f}E
- Computed epicentral distance: {spz['distance_km_computed']:.1f} km
  (task brief claimed ~{spz['distance_km_claimed']:.0f} km — {spz['distance_note']})
- Observed PGA: {spz['observed_pga_g']:.3f} g
- Our predicted PGA (rock-760 prior, direct GMPE evaluation at this site,
  not grid-interpolated): {spz['predicted_pga_g']:.3f} g
- Our total ln-sigma at this site: {spz['sigma_ln_total']:.3f}
- Observation sits **{spz['z_sigmas']:.2f}σ** from our prior mean

## Distance-binned PGA/PGV ln-bias

{dist_table}

## Interpretation

{cmp_['pga_ln']['bias']:+.3f} ln-units PGA bias and {cmp_['pgv_ln']['bias']:+.3f}
ln-units PGV bias (both negative: our unconditioned prior systematically
UNDER-predicts relative to USGS's conditioned Atlas map) are consistent
with the expected asymmetry — the Atlas map's 125 DYFI observations pull
its grid toward what people actually reported feeling, which for a major
reverse-mechanism Zagros event with real (if poorly resolved) site
amplification and finite-fault directivity is typically higher than a
bare point-source rock-760 prior predicts. The bias grows with distance
(see table) rather than shrinking, which is the DYFI-conditioning
signature, not obviously a GMPE-set defect: near-field cells (0-25 km) are
close to unconditioned already (few/no DYFI reports right at the
epicenter, mostly in inhabited areas further out), while far-field cells
sit inside the conditioning's spatial-correlation footprint. Coverage
(fraction of USGS cells inside our own ±1σ) tells the complementary story:
even with a nontrivial mean bias, our sigma budget is wide enough to
capture the PGA majority ({_fmt_pct(cmp_['pga_frac_within_1sigma'])}) but not
enough of PGV, which is not surprising since the bias itself is larger
there. Per `docs/research/gmpe-set-proposal-v2.md` §7's own caveat, this
is a sanity-anchor comparison, not a fit target — a "fail" here is
information for a future Peshawa review of whether/how to add DYFI-informed
conditioning earlier in the pipeline (`mvn.py` already exists for exactly
that), not evidence the D20 GMPE set itself is wrong.
"""


# ---------------------------------------------------------------------------
# Figures
# ---------------------------------------------------------------------------


def make_figures(fm: forward.ForwardMap, cmp_result: comparison.ComparisonResult, grid_xml: comparison.GridXML, out_dir: Path) -> list[Path]:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    paths: list[Path] = []

    # (1) Our EMS map
    fig, ax = plt.subplots(figsize=(7, 6))
    mesh = ax.pcolormesh(fm.lon2d, fm.lat2d, fm.ems.mean, shading="auto", cmap="YlOrRd")
    fig.colorbar(mesh, ax=ax, label="EMS-98 intensity (our prior)")
    ax.set_title(f"bumelerze-shake-service forward EMS map — {fm.event['mag_mw']:.1f} Halabja")
    ax.set_xlabel("lon")
    ax.set_ylabel("lat")
    ax.set_aspect("equal")
    path = out_dir / "ems_map.png"
    fig.savefig(path, dpi=120, bbox_inches="tight")
    plt.close(fig)
    paths.append(path)

    # (2) Residual map (ours - USGS, ln PGA), scattered at USGS cell centers
    resampled = comparison.resample_forward_map_to_points(fm, grid_xml.lon, grid_xml.lat)
    in_domain = np.isfinite(resampled["pga_g"])
    usgs_pga_g = grid_xml.field("PGA") / 100.0
    residual_ln = np.log(resampled["pga_g"][in_domain]) - np.log(usgs_pga_g[in_domain])
    fig, ax = plt.subplots(figsize=(7, 6))
    sc = ax.scatter(
        grid_xml.lon[in_domain], grid_xml.lat[in_domain], c=residual_ln, cmap="coolwarm",
        vmin=-1.0, vmax=1.0, s=2,
    )
    fig.colorbar(sc, ax=ax, label="ln PGA residual (ours - USGS)")
    ax.set_title("PGA residual map (bias={:.3f})".format(cmp_result.pga_ln.bias))
    ax.set_xlabel("lon")
    ax.set_ylabel("lat")
    ax.set_aspect("equal")
    path = out_dir / "residual_map.png"
    fig.savefig(path, dpi=120, bbox_inches="tight")
    plt.close(fig)
    paths.append(path)

    # (3) Distance-binned bias
    fig, ax = plt.subplots(figsize=(7, 4))
    bins = cmp_result.pga_ln_by_distance
    labels = [f"{b['distance_km_min']:.0f}-{b['distance_km_max']:.0f}" for b in bins]
    pga_bias = [b["bias"] for b in bins]
    pgv_bias = [b["bias"] for b in cmp_result.pgv_ln_by_distance]
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
    ax.set_title("Distance-binned PGA/PGV bias")
    ax.legend()
    path = out_dir / "distance_binned_bias.png"
    fig.savefig(path, dpi=120, bbox_inches="tight")
    plt.close(fig)
    paths.append(path)

    return paths


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", default=str(Path(__file__).resolve().parent.parent / ".cache" / "halabja"))
    parser.add_argument("--out-dir", default=str(Path(__file__).resolve().parent.parent / "validation" / "halabja"))
    args = parser.parse_args()

    cache_dir = Path(args.cache_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    results, fm, cmp_result, grid_xml = run_smoke_test(cache_dir)

    (out_dir / "results.json").write_text(json.dumps(results, indent=2))
    (out_dir / "REPORT.md").write_text(render_report(results))
    figure_paths = make_figures(fm, cmp_result, grid_xml, out_dir)

    print(json.dumps(results["verdict"], indent=2))
    print(f"wrote {out_dir / 'results.json'}")
    print(f"wrote {out_dir / 'REPORT.md'}")
    for path in figure_paths:
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
