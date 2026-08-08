"""build_handbook_data.py: pure-logic unit tests for the CSV field parsers
and the readability probe. Deliberately NOT exercising `build_pga_zones` /
`build_vs30_grid` / `build_soil_points` themselves (they read the read-only
OneDrive vault, which isn't available in CI/other machines and shouldn't be
a test dependency) — same convention `test_build_regional_catalog.py` uses
for `build_regional_catalog.py`'s `read_*` source readers. The app-side
point-in-polygon/bilinear-sampling/citation logic that actually consumes
this script's output is covered by the TS test suite
(`src/features/handbook/__tests__/`), not here."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build_handbook_data as bhd  # noqa: E402


class TestParseFloat:
    def test_plain_number(self):
        assert bhd._parse_float("467") == 467.0

    def test_negative_and_decimal(self):
        assert bhd._parse_float("-9.08") == -9.08

    def test_none_input(self):
        assert bhd._parse_float(None) is None

    def test_empty_string(self):
        assert bhd._parse_float("") is None
        assert bhd._parse_float("   ") is None

    def test_nan_token(self):
        assert bhd._parse_float("nan") is None
        assert bhd._parse_float("NaN") is None

    def test_non_numeric_garbage(self):
        assert bhd._parse_float("Marl, Marlylimestone") is None


class TestParseClass:
    def test_plain_class(self):
        assert bhd._parse_class("C") == "C"

    def test_strips_whitespace(self):
        assert bhd._parse_class("  D  ") == "D"

    def test_none_input(self):
        assert bhd._parse_class(None) is None

    def test_empty_becomes_none(self):
        assert bhd._parse_class("") is None
        assert bhd._parse_class("   ") is None


class TestCheckReadable:
    def test_readable_file(self, tmp_path):
        f = tmp_path / "ok.txt"
        f.write_text("hello")
        stats = bhd.SourceStats(label="t")
        assert bhd.check_readable(f, stats) is True
        assert stats.skipped_unreadable is False

    def test_missing_file_is_loud_skip_not_a_crash(self, tmp_path):
        f = tmp_path / "does-not-exist.txt"
        stats = bhd.SourceStats(label="t")
        assert bhd.check_readable(f, stats) is False
        assert stats.skipped_unreadable is True
        assert "unreadable" in stats.note


class TestTunables:
    def test_vs30_grid_resolution_hits_size_budget_order_of_magnitude(self):
        # Sanity guard, not a re-derivation of the empirical choice recorded
        # in the module docstring: a resolution this coarse or finer should
        # never accidentally regress to something that blows the ~200 KB
        # bundle target (e.g. a future edit reverting to 0.01 by mistake).
        assert bhd.VS30_GRID_RESOLUTION_DEG >= 0.04

    def test_pga_simplify_tolerance_is_positive(self):
        assert bhd.PGA_SIMPLIFY_TOLERANCE_DEG > 0
