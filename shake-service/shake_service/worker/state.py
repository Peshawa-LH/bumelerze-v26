"""state — worker state persisted to a single JSON file.

**Why a JSON file, not sqlite** (task-specified: document the choice):
this worker has exactly one writer (the daemon process itself — `--once`
and `--daemon` are never run concurrently against the same state file by
design), triggers at most a handful of times per day even in an active
sequence (D9's M>=3.5 regional floor is rare), and the entire state fits
comfortably in memory (one small record per tracked event). A JSON file
gives: zero extra dependency, trivial human inspection/debugging
(`cat worker_state.json`) for a solo dev who is not a JS/DB ops person,
trivial backup (`cp`), and an atomic-replace write (below) that is enough
crash-safety for this write pattern. sqlite would add a schema-migration
surface and a binary-diff-only file for a problem this small — genuinely
overkill here. Revisit if/when this worker tracks thousands of events or
gains concurrent writers (neither is expected).

**Idempotent restarts:** `WorkerState.load` reconstructs exactly the state
the previous process last `save`d (or an empty state if the file does not
exist yet — first run). Nothing here depends on process memory surviving a
restart; `scripts/run_worker.py` re-`load`s at the top of every `--once`
invocation and once at `--daemon` startup, and `--daemon` re-`save`s after
every processed cycle (not just at shutdown) so a mid-cycle crash loses at
most one cycle's decisions, never corrupts the file (atomic replace), and
never reprocesses an event it already finished (per-event `params_hash` +
`last_feed_updated_ms`, consulted by `feed_watcher.evaluate_feed_events`).
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

STATE_SCHEMA_VERSION = 1


@dataclass
class EventState:
    """Everything the worker needs to remember about one tracked event."""

    external_id: str
    source: str

    mag: float
    lat: float
    lon: float
    depth_km: float

    last_version: int
    params_hash: str
    product_paths: dict[str, str]  # {"cont_mi": "...", "info": "...", "grid": "..."}

    last_feed_updated_ms: int

    first_seen_at: str  # ISO 8601
    last_computed_at: str  # ISO 8601

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "EventState":
        return cls(
            external_id=d["external_id"],
            source=d["source"],
            mag=float(d["mag"]),
            lat=float(d["lat"]),
            lon=float(d["lon"]),
            depth_km=float(d["depth_km"]),
            last_version=int(d["last_version"]),
            params_hash=d["params_hash"],
            product_paths=dict(d.get("product_paths", {})),
            last_feed_updated_ms=int(d["last_feed_updated_ms"]),
            first_seen_at=d["first_seen_at"],
            last_computed_at=d["last_computed_at"],
        )


@dataclass
class WorkerState:
    """In-memory worker state, keyed by `FeedEvent.external_id`. Load/save
    are the only I/O this class does; everything else is plain dict
    bookkeeping so `feed_watcher`/`pipeline` can use it without touching
    the filesystem in their own unit tests."""

    events: dict[str, EventState] = field(default_factory=dict)
    meta: dict[str, Any] = field(default_factory=lambda: {"schema_version": STATE_SCHEMA_VERSION})

    def get_event(self, external_id: str) -> EventState | None:
        return self.events.get(external_id)

    def upsert_event(self, event_state: EventState) -> None:
        self.events[event_state.external_id] = event_state

    def known_external_ids(self) -> list[str]:
        return list(self.events.keys())

    # -- persistence ---------------------------------------------------

    @classmethod
    def load(cls, path: str | Path) -> "WorkerState":
        path = Path(path)
        if not path.exists():
            return cls()
        raw = json.loads(path.read_text())
        events = {
            external_id: EventState.from_dict(record)
            for external_id, record in raw.get("events", {}).items()
        }
        meta = raw.get("meta", {"schema_version": STATE_SCHEMA_VERSION})
        return cls(events=events, meta=meta)

    def save(self, path: str | Path) -> None:
        """Atomic write: serialize to a sibling temp file, then
        `os.replace` (atomic on POSIX and Windows) — a crash mid-write
        leaves the previous, still-valid state file in place rather than a
        half-written JSON document."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "meta": self.meta,
            "events": {external_id: es.to_dict() for external_id, es in self.events.items()},
        }
        tmp_path = path.with_name(path.name + ".tmp")
        tmp_path.write_text(json.dumps(payload, indent=2, sort_keys=True))
        os.replace(tmp_path, path)
