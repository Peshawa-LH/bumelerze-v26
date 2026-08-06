"""Config sanity: band weights sum to 1, band classification edges, grid
extent policy, Zagros polygon shape."""

import pytest

from shake_service import config


@pytest.mark.parametrize("band", ["small", "moderate", "major"])
def test_band_weights_sum_to_one(band):
    total = sum(config.BAND_WEIGHTS[band].values())
    assert total == pytest.approx(1.0)


@pytest.mark.parametrize("band", ["small", "moderate", "major"])
def test_band_weights_cover_all_gsim_keys(band):
    assert set(config.BAND_WEIGHTS[band].keys()) == set(config.GSIM_KEYS)


@pytest.mark.parametrize(
    "mw,expected",
    [
        (2.0, "small"),
        (3.5, "small"),
        (4.999, "small"),
        (5.0, "moderate"),
        (6.499, "moderate"),
        (6.5, "major"),
        (7.5, "major"),
    ],
)
def test_magnitude_band_edges(mw, expected):
    assert config.magnitude_band(mw) == expected


def test_grid_extent_km_matches_g8_policy():
    assert config.grid_extent_km("small") == 100.0
    assert config.grid_extent_km("moderate") == 200.0
    assert config.grid_extent_km("major") == 300.0


def test_grid_extent_monotone_with_band_severity():
    assert (
        config.grid_extent_km("small")
        < config.grid_extent_km("moderate")
        < config.grid_extent_km("major")
    )


def test_region_bbox_contains_halabja():
    # 2017 Sarpol-e Zahab/Halabja epicentre, ~34.9N 45.9E — the validation
    # anchor (D9/D20 §7) must fall inside the configured region.
    bbox = config.REGION_BBOX
    assert bbox["min_lat"] <= 34.9 <= bbox["max_lat"]
    assert bbox["min_lon"] <= 45.9 <= bbox["max_lon"]


def test_zagros_polygon_is_a_simple_ring_of_at_least_four_points():
    ring = config.ZAGROS_POLYGON_LONLAT
    assert len(ring) >= 4
    # not accidentally closed (rupture_params.py is responsible for closing it)
    assert ring[0] != ring[-1]
    for lon, lat in ring:
        assert config.REGION_BBOX["min_lon"] - 5 <= lon <= config.REGION_BBOX["max_lon"] + 5
        assert config.REGION_BBOX["min_lat"] - 5 <= lat <= config.REGION_BBOX["max_lat"] + 5


def test_band_weights_and_grid_extent_share_edges():
    # Deliberate alignment documented in config.py: the same Mw edges drive
    # both the mixture weights and the grid-extent policy.
    for band in ("small", "moderate", "major"):
        assert band in config.BAND_WEIGHTS
        assert band in config.GRID_EXTENT_KM
