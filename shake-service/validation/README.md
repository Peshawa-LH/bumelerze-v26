# `validation/` — D20 event-by-event validation outputs

- `SUMMARY.md` — the cross-event table + synthesis. **Start here.**
- `halabja/` — 2017 M7.3 Halabja/Sarpol-e Zahab (`us2000bmcg`), major band.
  Legacy two-report format (`REPORT.md` bare-prior + `REPORT-CONDITIONED.md`
  conditioned re-judgment); generator scripts retired, see that folder's own
  `README.md` for the retirement note and reproducibility verification.
- `us1000hwdw/` — 2018 M6.3 Sarpol-e Zahab, moderate band. Unified
  `REPORT.md` (bare + conditioned + sensitivity grid together).
- `us1000ghda/` — 2018 M6.0 Javanrud/Kermanshah, moderate band. Unified
  `REPORT.md`.

All three generated (or reproducible) via
`scripts/run_validation.py --event <usgs-id>` — one parameterized tool,
band auto-selected from magnitude, ShakeMap/DYFI products discovered from
the event's own USGS detail JSON. See `../README.md`'s "Wave E" note and
`scripts/run_validation.py`'s own module docstring for the full method.
