"""bumelerze-shake-service worker — the daemon that turns the validated
`gmpe_forward` engine (`forward.py`/`export.py`/`conditioned_forward.py`,
all built and D20-validated in earlier waves) into an automatic service.

Modules:
- `feed_watcher`: polls USGS feeds, decides which events qualify for a
  (re)compute — new regional M>=3.5 events, or updates to a known event
  that cross a revision threshold (D9's "auto for regional M>=3.5").
- `state`: JSON-file-backed per-event worker state (last version, params
  hash, product paths, timestamps) — idempotent restarts.
- `pipeline`: per-trigger orchestration — forward map -> export products ->
  state update -> (stub) upload. Conditioning is an explicit, documented,
  not-yet-wired integration point (no felt-report source exists until
  Supabase).
- `uploader`: `ProductUploader` interface — `LocalOnlyUploader` (default)
  and a `SupabaseUploader` stub for when the Supabase project exists.

See `scripts/run_worker.py` for the CLI (`--once` / `--daemon`).
"""

from __future__ import annotations
