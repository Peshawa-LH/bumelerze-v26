"""review — the v1 scientist-review channel (D21, `docs/decisions.md`:
"every product carries review_status (automatic | reviewed); the app
displays it (provenance-as-UI). Peshawa flips the flag via a simple review
channel (script/dashboard first, admin UI later)").

Reads/re-writes an ALREADY EXPORTED product version's `info.json` in place,
flipping `review_status` `"automatic"` -> `"reviewed"` (+ `reviewed_by`/
`reviewed_at`). Pure functions here — no CLI parsing, no `WorkerState` I/O —
so `scripts/review_product.py` stays a thin wrapper, same split as
`export.py` (core logic) vs. `worker/pipeline.py` (orchestration)."""

from __future__ import annotations

import datetime as _dt
import json
from pathlib import Path
from typing import Any


class ReviewError(ValueError):
    """Raised for a review request that cannot be honored as given (e.g.
    no `info.json` exists yet at the given event/version)."""


def info_json_path(products_root: str | Path, event_id: str, version: int) -> Path:
    """The on-disk path `worker/pipeline.py`/`export.write_products` puts
    one version's `info.json` at — reproduced here as a single named
    function so `scripts/review_product.py` never hand-builds the path
    string itself."""
    return Path(products_root) / event_id / f"v{version}" / "info.json"


def read_info_json(path: str | Path) -> dict[str, Any]:
    p = Path(path)
    if not p.exists():
        raise ReviewError(f"review: no info.json at {p} — has this event/version been computed yet?")
    return json.loads(p.read_text())


def mark_reviewed(
    path: str | Path,
    *,
    reviewed_by: str,
    reviewed_at: _dt.datetime | None = None,
    allow_re_review: bool = False,
) -> dict[str, Any]:
    """Read the `info.json` at `path`, set `review_status="reviewed"` +
    `reviewed_by`/`reviewed_at`, write it back (atomic replace — same
    crash-safety pattern as `worker/state.py`'s own `save`), and return the
    updated dict.

    Idempotent by default: re-running against an ALREADY-reviewed product
    is a no-op that returns the existing record unchanged (never silently
    overwrites a real reviewer's name/timestamp on a second/replayed call)
    — pass `allow_re_review=True` to explicitly replace it (e.g. a
    corrected reviewer name or timestamp).
    """
    p = Path(path)
    info = read_info_json(p)

    if info.get("review_status") == "reviewed" and not allow_re_review:
        return info

    ts = (reviewed_at or _dt.datetime.now(_dt.timezone.utc)).isoformat()
    info["review_status"] = "reviewed"
    info["reviewed_by"] = reviewed_by
    info["reviewed_at"] = ts

    tmp_path = p.with_name(p.name + ".tmp")
    tmp_path.write_text(json.dumps(info))
    tmp_path.replace(p)
    return info
