"""The D20 Halabja smoke test, wired into pytest (`@pytest.mark.slow` —
network-dependent, fetches a real ~26 MB `grid.xml` on first run, cached
under `.cache/halabja/` afterwards, see `.gitignore`).

This test is a REGRESSION/SMOKE check on the harness (does the pipeline run
end to end and produce well-formed, finite numbers?) — it does NOT assert
the D20 pass/fail verdict itself. Whether our forward map passes or fails
the bias/coverage thresholds against a real USGS Atlas grid is a scientific
result, reported honestly in `validation/halabja/REPORT.md`
(`scripts/run_halabja.py`), not a thing this test should gate green/red on
(task instruction: never tune to pass; a legitimate FAIL is not a test
failure).

Run explicitly: `./.venv/bin/pytest -m slow -q`
(excluded from the default `pytest -q` run — see `pyproject.toml`'s
`markers` and the default `addopts` absence: this file's collection itself
is cheap, only the test body is slow/network-bound).
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import run_halabja  # noqa: E402

CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache" / "halabja"


@pytest.mark.slow
def test_halabja_smoke_pipeline_runs_end_to_end_and_produces_finite_stats():
    results, fm, cmp_result, grid_xml = run_halabja.run_smoke_test(CACHE_DIR)

    assert results["event"]["id"] == "us2000bmcg"
    assert results["event"]["mag_mw"] == pytest.approx(7.3, abs=0.01)
    assert fm.band == "major"

    for key in ("pga_ln", "pgv_ln", "mmi"):
        stats = results["comparison"][key]
        assert np.isfinite(stats["bias"])
        assert np.isfinite(stats["rmse"])
        assert stats["n"] > 0

    assert 0.0 <= results["comparison"]["pga_frac_within_1sigma"] <= 1.0
    assert 0.0 <= results["comparison"]["pgv_frac_within_1sigma"] <= 1.0
    assert results["comparison"]["n_compared"] > 0
    assert results["comparison"]["n_compared"] <= results["comparison"]["n_usgs_cells"]

    spz = results["spz_spot_check"]
    assert np.isfinite(spz["predicted_pga_g"]) and spz["predicted_pga_g"] > 0
    assert np.isfinite(spz["z_sigmas"])

    # the verdict dict always has all six boolean keys, whatever their value
    verdict = results["verdict"]
    for key in (
        "bias_pga_ln_pass", "bias_pgv_ln_pass", "bias_overall_pass",
        "coverage_pga_pass", "coverage_pgv_pass", "coverage_overall_pass",
    ):
        assert isinstance(verdict[key], bool)


@pytest.mark.slow
def test_halabja_smoke_report_and_figures_render_without_error(tmp_path):
    results, fm, cmp_result, grid_xml = run_halabja.run_smoke_test(CACHE_DIR)
    report_text = run_halabja.render_report(results)
    assert "D20 Halabja smoke test" in report_text
    assert "us2000bmcg" in report_text

    figure_paths = run_halabja.make_figures(fm, cmp_result, grid_xml, tmp_path)
    assert len(figure_paths) == 3
    for path in figure_paths:
        assert path.exists()
        assert path.stat().st_size > 0


@pytest.mark.slow
def test_find_spz_station_returns_none_for_this_event():
    inputs = run_halabja.fetch_halabja_inputs(CACHE_DIR)
    # documented expectation (this event's Atlas stationlist is DYFI-only,
    # zero instrumental stations) — asserted so a future USGS reprocessing
    # that adds one is noticed, not silently ignored.
    assert run_halabja.find_spz_station(inputs.stationlist) is None
