"""bumelerze-shake-service — regional SHAKEmap engine (Python worker).

Wave A scope (this package, current state): the hazardlib GMPE adapter
foundation — config, magnitude conversion, rupture-parameter derivation,
point-source distances (ps2ff), and the ground-motion mixture engine.

Lineage: D9 (service architecture) -> D19 (hazardlib-as-library pivot) ->
D20 (confirmed 4-branch GMPE set + banded weights). See the repo's
`docs/decisions.md` and `docs/research/gmpe-set-proposal-v2.md`.

Not yet in this package (later waves): the `gmpe_forward` grid engine and
`mvn` conditioning engine (extracted from SHAKEmaps-Toolkit-v26, wave B),
Vs30 raster sampling (wave B), product export (wave B/C), Halabja
validation harness (wave C).
"""

__all__: list[str] = []
