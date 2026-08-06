"""comparison.py: residual-statistics math on synthetic (known-answer)
arrays/grids, `grid.xml` parsing (real trimmed fragment), and the full
`ForwardMap`-vs-`GridXML` comparison pipeline on a synthetic ForwardMap with
an injected, exactly-known bias."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from shake_service import comparison, gmm
from shake_service.forward import ForwardMap, GroundMotionChannel, IntensityGrid

FIXTURES_DIR = Path(__file__).parent / "fixtures"


# ---------------------------------------------------------------------------
# residual_stats / fraction_within_sigma / distance_binned_bias — pure math,
# synthetic arrays with a known answer.
# ---------------------------------------------------------------------------


def test_residual_stats_recovers_known_bias_and_rmse():
    # constant residual -> bias == rmse == mae == the constant, exactly
    residual = np.full(50, -0.25)
    stats = comparison.residual_stats(residual)
    assert stats.bias == pytest.approx(-0.25)
    assert stats.rmse == pytest.approx(0.25)
    assert stats.mae == pytest.approx(0.25)
    assert stats.n == 50


def test_residual_stats_mixed_signs_known_answer():
    residual = np.array([1.0, -1.0, 2.0, -2.0, 3.0])
    stats = comparison.residual_stats(residual)
    assert stats.bias == pytest.approx(0.6)  # mean
    assert stats.rmse == pytest.approx(np.sqrt(np.mean(residual**2)))
    assert stats.mae == pytest.approx(np.mean(np.abs(residual)))
    assert stats.n == 5


def test_residual_stats_ignores_nan():
    residual = np.array([1.0, np.nan, 3.0, np.nan])
    stats = comparison.residual_stats(residual)
    assert stats.n == 2
    assert stats.bias == pytest.approx(2.0)


def test_residual_stats_empty_is_nan():
    stats = comparison.residual_stats(np.array([]))
    assert stats.n == 0
    assert np.isnan(stats.bias)


def test_fraction_within_sigma_known_answer():
    residual = np.array([0.1, 0.6, -0.3, 1.5, -0.9])
    sigma = np.full(5, 0.5)
    # within: 0.1<=0.5 yes, 0.6<=0.5 no, 0.3<=0.5 yes, 1.5<=0.5 no, 0.9<=0.5 no
    frac = comparison.fraction_within_sigma(residual, sigma, k=1.0)
    assert frac == pytest.approx(2 / 5)


def test_fraction_within_sigma_k_scales():
    residual = np.full(10, 1.0)
    sigma = np.full(10, 1.0)
    assert comparison.fraction_within_sigma(residual, sigma, k=1.0) == pytest.approx(1.0)
    assert comparison.fraction_within_sigma(residual, sigma, k=0.5) == pytest.approx(0.0)


def test_distance_binned_bias_known_bins():
    # 2 points per bin, constant residual per bin equal to the bin index.
    distances = np.array([10, 20, 30, 40, 60, 90, 150, 180, 250, 280])
    residual = np.array([0.0, 0.0, 1.0, 1.0, 2.0, 2.0, 3.0, 3.0, 4.0, 4.0])
    table = comparison.distance_binned_bias(residual, distances)
    assert len(table) == 5
    for row, expected_bias in zip(table, (0.0, 1.0, 2.0, 3.0, 4.0)):
        assert row["bias"] == pytest.approx(expected_bias)
        assert row["n"] == 2


def test_distance_binned_bias_last_bin_is_inclusive_at_both_ends():
    distances = np.array([200.0, 300.0])
    residual = np.array([1.0, 1.0])
    table = comparison.distance_binned_bias(residual, distances)
    assert table[-1]["n"] == 2  # both 200 and 300 fall in the last (200,300] bin


def test_epicentral_distance_km_known_short_hop():
    # 1 degree of latitude ~ 111.2 km (WGS84-ish; our haversine uses a mean
    # spherical radius, close enough for this sanity check).
    d = comparison.epicentral_distance_km(0.0, 0.0, np.array([0.0]), np.array([1.0]))
    assert d[0] == pytest.approx(111.19, abs=0.5)


# ---------------------------------------------------------------------------
# resample_grid_to_points — bilinear resampling on a known analytic field.
# ---------------------------------------------------------------------------


def test_resample_grid_to_points_recovers_linear_field_exactly():
    lon_axis = np.array([0.0, 1.0, 2.0, 3.0])
    lat_axis = np.array([0.0, 1.0, 2.0])
    lon2d, lat2d = np.meshgrid(lon_axis, lat_axis)
    values = 2.0 * lon2d + 3.0 * lat2d + 1.0  # exactly linear -> bilinear interp is exact
    query_lon = np.array([0.5, 1.5, 2.5])
    query_lat = np.array([0.5, 1.0, 1.5])
    out = comparison.resample_grid_to_points(lon_axis, lat_axis, values, query_lon, query_lat)
    expected = 2.0 * query_lon + 3.0 * query_lat + 1.0
    np.testing.assert_allclose(out, expected)


def test_resample_grid_to_points_outside_domain_is_nan():
    lon_axis = np.array([0.0, 1.0])
    lat_axis = np.array([0.0, 1.0])
    values = np.array([[1.0, 2.0], [3.0, 4.0]])
    out = comparison.resample_grid_to_points(lon_axis, lat_axis, values, np.array([5.0]), np.array([5.0]))
    assert np.isnan(out[0])


# ---------------------------------------------------------------------------
# grid.xml parser — trimmed real Halabja fixture.
# ---------------------------------------------------------------------------


def test_load_shakemap_grid_xml_trimmed_fixture():
    grid = comparison.load_shakemap_grid_xml(FIXTURES_DIR / "us2000bmcg_grid.trimmed.xml")
    assert grid.nlon == 4
    assert grid.nlat == 2
    assert grid.event["magnitude"] == pytest.approx(7.3)
    assert grid.event["depth"] == pytest.approx(19.0)
    assert grid.event["lat"] == pytest.approx(34.9109)
    assert grid.event["lon"] == pytest.approx(45.9592)
    assert grid.event["event_id"] == "us2000bmcg"
    assert grid.lon.shape == (8,)
    assert grid.lat.shape == (8,)
    np.testing.assert_allclose(grid.field("MMI")[:4], [3.1, 3.1, 3.1, 3.1])
    np.testing.assert_allclose(grid.field("PGA")[0], 0.02954)
    # row-major, lat-descending order preserved (real file order, not sorted)
    assert grid.lat[0] == pytest.approx(39.8667)
    assert grid.lat[-1] == pytest.approx(39.85)


def test_parse_shakemap_grid_xml_rejects_row_count_mismatch():
    bad_xml = """<?xml version="1.0"?>
<shakemap_grid>
<event event_id="x" magnitude="5.0" depth="10.0" lat="0.0" lon="0.0" />
<grid_specification lon_min="0" lat_min="0" lon_max="1" lat_max="1" nominal_lon_spacing="1" nominal_lat_spacing="1" nlon="3" nlat="3"/>
<grid_field index="1" name="LON" units="dd" />
<grid_field index="2" name="LAT" units="dd" />
<grid_field index="3" name="MMI" units="intensity" />
<grid_data>
0.0 0.0 3.0
1.0 0.0 3.1
</grid_data>
</shakemap_grid>"""
    with pytest.raises(ValueError, match="data rows"):
        comparison.parse_shakemap_grid_xml(bad_xml)


def test_parse_shakemap_grid_xml_missing_event_tag_raises():
    with pytest.raises(ValueError, match="event"):
        comparison.parse_shakemap_grid_xml("<shakemap_grid></shakemap_grid>")


# ---------------------------------------------------------------------------
# Full pipeline: synthetic ForwardMap vs. a synthetic GridXML with an
# EXACTLY known injected bias — proves compare_forward_map_to_grid recovers
# it (not just the underlying stats primitives in isolation).
# ---------------------------------------------------------------------------


def _synthetic_forward_map(*, pga_g: float, pgv_cms: float, mmi_value: float, sigma_ln: float) -> ForwardMap:
    ny, nx = 5, 5
    lat_axis = np.linspace(-1.0, 1.0, ny)
    lon_axis = np.linspace(-1.0, 1.0, nx)
    lon2d, lat2d = np.meshgrid(lon_axis, lat_axis)

    def gm_channel(imt: str, unit: str, mean_value: float) -> GroundMotionChannel:
        return GroundMotionChannel(
            imt=imt, unit=unit,
            mean=np.full((ny, nx), mean_value),
            sigma_ln=np.full((ny, nx), sigma_ln),
            tau_ln=np.full((ny, nx), sigma_ln / 2),
            phi_ln=np.full((ny, nx), sigma_ln / 2),
            sigma_model_ln=np.zeros((ny, nx)),
        )

    def intensity_channel(scale: str, model: str, mean_value: float) -> IntensityGrid:
        return IntensityGrid(
            scale=scale, model=model,
            mean=np.full((ny, nx), mean_value),
            sigma=np.full((ny, nx), 0.5),
            tau=np.full((ny, nx), 0.3),
            phi=np.full((ny, nx), 0.4),
            sigma_model=np.zeros((ny, nx)),
            driver=np.full((ny, nx), "PGV", dtype=object),
            sigma_gmice_verified=False,
            sigma_gmice_citation="synthetic test fixture",
        )

    return ForwardMap(
        lon2d=lon2d, lat2d=lat2d,
        pga=gm_channel("PGA", "g", pga_g),
        pgv=gm_channel("PGV", "cm/s", pgv_cms),
        ems=intensity_channel("EMS-98", "synthetic", mmi_value),
        mmi=intensity_channel("MMI", "synthetic", mmi_value),
        event={"lat": 0.0, "lon": 0.0, "depth_km": 10.0, "mag_mw": 5.0},
        band="small",
        weights={"A": 1.0},
        grid_meta={"half_extent_km": 100.0, "spacing_km": 10.0, "shape": (ny, nx), "n_sites": ny * nx},
        vs30_meta={"sampler": "synthetic"},
        extrapolation=gmm.ExtrapolationFlags(
            depth_extrapolated=False, magnitude_extrapolated_branches=(), distance_extrapolated_branches=(),
        ),
        in_zagros_polygon=False,
        depth_extrapolated=False,
    )


def _synthetic_grid_xml(*, pga_pctg: float, pgv_cms: float, mmi_value: float) -> comparison.GridXML:
    ny, nx = 5, 5
    lat_axis = np.linspace(-1.0, 1.0, ny)
    lon_axis = np.linspace(-1.0, 1.0, nx)
    lon2d, lat2d = np.meshgrid(lon_axis, lat_axis)
    n = ny * nx
    return comparison.GridXML(
        event={"event_id": "synthetic", "magnitude": 5.0, "depth": 10.0, "lat": 0.0, "lon": 0.0},
        grid_specification={"lon_min": -1.0, "lat_min": -1.0, "lon_max": 1.0, "lat_max": 1.0,
                             "nominal_lon_spacing": 0.5, "nominal_lat_spacing": 0.5},
        nlon=nx, nlat=ny,
        fields={
            "LON": lon2d.ravel(), "LAT": lat2d.ravel(),
            "PGA": np.full(n, pga_pctg), "PGV": np.full(n, pgv_cms), "MMI": np.full(n, mmi_value),
        },
    )


def test_compare_forward_map_to_grid_recovers_injected_bias():
    our_pga_g = 1.0
    our_pgv_cms = 10.0
    our_mmi = 6.0
    ln_bias_pga = 0.2  # ours - usgs, in ln space, by construction below
    ln_bias_pgv = -0.1
    mmi_bias = 0.3

    fm = _synthetic_forward_map(pga_g=our_pga_g, pgv_cms=our_pgv_cms, mmi_value=our_mmi, sigma_ln=0.5)
    usgs_pga_g = our_pga_g * np.exp(-ln_bias_pga)  # so ln(our) - ln(usgs) == ln_bias_pga
    usgs_pgv_cms = our_pgv_cms * np.exp(-ln_bias_pgv)
    usgs_mmi = our_mmi - mmi_bias
    grid_xml = _synthetic_grid_xml(pga_pctg=usgs_pga_g * 100.0, pgv_cms=usgs_pgv_cms, mmi_value=usgs_mmi)

    result = comparison.compare_forward_map_to_grid(fm, grid_xml, event_lon=0.0, event_lat=0.0)

    assert result.n_usgs_cells == 25
    assert result.n_compared == 25  # synthetic USGS grid exactly matches our grid's domain
    assert result.pga_ln.bias == pytest.approx(ln_bias_pga, abs=1e-9)
    assert result.pgv_ln.bias == pytest.approx(ln_bias_pgv, abs=1e-9)
    assert result.mmi.bias == pytest.approx(mmi_bias, abs=1e-9)
    # rmse == mae == |bias| for a perfectly constant residual field
    assert result.pga_ln.rmse == pytest.approx(abs(ln_bias_pga), abs=1e-9)
    assert result.pga_ln.mae == pytest.approx(abs(ln_bias_pga), abs=1e-9)
    # residual (0.2) < sigma (0.5) everywhere -> full coverage
    assert result.pga_frac_within_1sigma == pytest.approx(1.0)
    assert result.pgv_frac_within_1sigma == pytest.approx(1.0)


def test_compare_forward_map_to_grid_partial_domain_overlap():
    fm = _synthetic_forward_map(pga_g=1.0, pgv_cms=10.0, mmi_value=6.0, sigma_ln=0.5)
    # USGS grid extends well beyond our synthetic ForwardMap's [-1, 1] domain
    ny, nx = 3, 3
    lat_axis = np.linspace(-5.0, 5.0, ny)
    lon_axis = np.linspace(-5.0, 5.0, nx)
    lon2d, lat2d = np.meshgrid(lon_axis, lat_axis)
    n = ny * nx
    grid_xml = comparison.GridXML(
        event={"event_id": "synthetic"},
        grid_specification={},
        nlon=nx, nlat=ny,
        fields={"LON": lon2d.ravel(), "LAT": lat2d.ravel(), "PGA": np.full(n, 100.0),
                "PGV": np.full(n, 10.0), "MMI": np.full(n, 6.0)},
    )
    result = comparison.compare_forward_map_to_grid(fm, grid_xml, event_lon=0.0, event_lat=0.0)
    assert result.n_usgs_cells == 9
    assert result.n_compared == 1  # only the center point (0,0) is inside our [-1,1] domain
