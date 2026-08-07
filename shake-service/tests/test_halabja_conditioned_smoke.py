"""The wave-D CONDITIONED Halabja re-judgment, wired into pytest
(`@pytest.mark.slow` — network-dependent: fetches the real ~26 MB
`grid.xml` (shared cache with `test_halabja_smoke.py`) plus this wave's own
`dyfi_geo_10km.geojson`, both cached under `.cache/halabja/` afterwards,
see `.gitignore`).

Same policy as `test_halabja_smoke.py`: a REGRESSION/SMOKE check on the
harness (does the full conditioned pipeline run end to end and produce
well-formed, finite numbers, for every sensitivity variant?) — it does NOT
assert the D20 pass/fail verdict itself as a test-failure condition (the
verdict is a scientific result, reported honestly in
`validation/halabja/REPORT-CONDITIONED.md`, not a green/red gate here).

Run explicitly: `./.venv/bin/pytest -m slow -q`
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import run_halabja_conditioned  # noqa: E402

CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache" / "halabja"


@pytest.mark.slow
def test_conditioned_pipeline_runs_end_to_end_and_produces_finite_stats():
    results, inputs, fm, grid_xml = run_halabja_conditioned.run_conditioned_comparison(CACHE_DIR)

    assert results["event"]["id"] == "us2000bmcg"
    assert results["n_dyfi_boxes_total"] > 0
    assert set(results["variants"]) == {"primary", "sensitivity_zanini", "sensitivity_nresp2", "sensitivity_unrestricted"}

    for variant in results["variants"].values():
        assert variant["n_boxes_selected"] > 0
        assert variant["n_conditioning_pga"] == variant["n_boxes_selected"]
        assert variant["n_conditioning_pgv"] == variant["n_boxes_selected"]
        for key in ("pga_ln", "pgv_ln", "mmi"):
            stats = variant["comparison"][key]
            assert np.isfinite(stats["bias"])
            assert np.isfinite(stats["rmse"])
            assert stats["n"] > 0
        assert 0.0 <= variant["comparison"]["pga_frac_within_1sigma"] <= 1.0
        assert 0.0 <= variant["comparison"]["pgv_frac_within_1sigma"] <= 1.0
        for key in (
            "bias_pga_ln_pass", "bias_pgv_ln_pass", "bias_overall_pass",
            "coverage_pga_pass", "coverage_pgv_pass", "coverage_overall_pass",
        ):
            assert isinstance(variant["verdict"][key], bool)

    # the primary variant carries the live ForwardMap/ComparisonResult for figures.
    assert results["variants"]["primary"]["_forward_map"].band == "major"


@pytest.mark.slow
def test_conditioned_primary_variant_passes_all_four_d20_criteria():
    # This DOES assert a specific scientific outcome, deliberately (not the
    # smoke-test policy above) -- the wave-D headline result Peshawa asked
    # for. If a future USGS reprocessing or environment change flips this,
    # it should be noticed via a failing test, not silently drift; unlike
    # the bare-prior smoke test, this is the "did the fair-comparison rerun
    # land where wave D's own REPORT-CONDITIONED.md says it landed" check.
    results, inputs, fm, grid_xml = run_halabja_conditioned.run_conditioned_comparison(CACHE_DIR)
    verdict = results["variants"]["primary"]["verdict"]
    assert verdict["bias_overall_pass"] is True
    assert verdict["coverage_overall_pass"] is True


@pytest.mark.slow
def test_conditioned_report_and_figures_render_without_error(tmp_path):
    results, inputs, fm, grid_xml = run_halabja_conditioned.run_conditioned_comparison(CACHE_DIR)
    report_text = run_halabja_conditioned.render_report(results)
    assert "D20 Halabja CONDITIONED re-judgment" in report_text
    assert "circularity" in report_text.lower()
    assert "doughnut" in report_text.lower()

    primary = results["variants"]["primary"]
    figure_paths = run_halabja_conditioned.make_figures(
        primary["_forward_map"], primary["_cmp_result"], grid_xml,
        results["bare_prior"]["comparison"]["pga_ln_by_distance"] if results["bare_prior"] else None,
        results["bare_prior"]["comparison"]["pgv_ln_by_distance"] if results["bare_prior"] else None,
        tmp_path,
    )
    assert len(figure_paths) == 3
    for path in figure_paths:
        assert path.exists()
        assert path.stat().st_size > 0


@pytest.mark.slow
def test_fetch_dyfi_geo_10km_returns_a_real_feature_collection():
    from shake_service import dyfi_observations as dyfi

    text = run_halabja_conditioned.fetch_dyfi_geo_10km(CACHE_DIR)
    boxes = dyfi.parse_dyfi_geo_geojson(text)
    assert len(boxes) > 100  # the real product has 397 features this wave
