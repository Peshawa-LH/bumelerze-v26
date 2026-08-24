"""event_id — the Bumelerze canonical event-ID ("bml id") scheme + allocator.

Full spec: `docs/research/bumelerze-id-scheme.md` (D14: design confirmed
by the owner; this module is the single implementation).

**Format:**

    bml + <4-digit UTC year> + <lowercase base-36 counter, zero-padded to 4 chars>

e.g. `bml20260001` (first event detected in 2026), `bml2026a3kx` (counter
471,201 of 2026). The suffix is a per-year counter rendered in base 36
(digits `0-9a-z`, lowercase only), zero-padded to 4 characters. Past
`zzzz` (36^4 - 1 = 1,679,615 events in one year — far beyond any plausible
regional catalog year) the suffix simply GROWS to 5 characters
(`bml202610000`), then 6, and so on: no counter is ever reset mid-year and
no id is ever reused; there is no upper bound. (Note the ids are opaque
identifiers, not sort keys: plain string comparison orders ids correctly
only within one suffix width — allocation order across the theoretical
rollover boundary needs `parse_bumelerze_id`'s counter, never `str <`.)

**Allocation rules (immutability + single-writer authority):**

- A bml id is assigned exactly ONCE, at first detection of a canonical
  (post-cross-provider-dedup) event, and is immutable forever after —
  revisions, recomputes, provider-alias additions, and review flips never
  change it. Merges/splits repair the ALIAS map, never the id.
- The year in the id is the event's ORIGIN year (UTC), not the detection
  year — an event that happens at 23:59 UTC on Dec 31 and is detected
  seconds later carries the year it occurred in.
- TODAY the single allocation authority is the live worker's state file
  (`WorkerState.meta["bumelerze_id_counters"]`, one JSON object of
  `{"<year>": <last-allocated counter>}`), because the worker is the
  single writer of that file by design (see `worker/state.py`'s own
  single-writer docstring). Other pipeline entrypoints (`seed_atlas.py`,
  `run_validation.py`) deliberately do NOT allocate — they operate on
  separate state files, and two independent counter files would mint
  colliding ids. Products computed outside the live worker therefore carry
  `bumelerze_id: null` unless the event is also live-tracked.
- FUTURE handover (documented now so the format never forks): when the
  Supabase backend goes live, allocation moves to a Postgres sequence per
  year (or an `INSERT ... ON CONFLICT` counter table) behind an edge
  function, and the worker requests ids instead of minting them. The
  FORMAT stays byte-identical; the handover step seeds each year's
  sequence from the worker state file's counters so no id is ever reused
  across the switch. `supabase/migrations/0008_bumelerze_event_id.sql`
  carries the same note on the `events.bumelerze_id` column.
- Retroactive ids for the pre-launch archival catalog are assigned by
  `scripts/build_regional_catalog.py` using `format_bumelerze_id` with
  per-year counters over that build's deterministic event ordering — a
  separate, non-overlapping namespace in practice, because the archival
  catalog ends years before live allocation began.
"""

from __future__ import annotations

import datetime as _dt
import re
from typing import Any

BML_PREFIX = "bml"
SUFFIX_MIN_WIDTH = 4

_BASE36_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"

# 4-digit year + base-36 suffix of AT LEAST 4 chars (rollover grows it).
BML_ID_RE = re.compile(r"^bml(\d{4})([0-9a-z]{4,})$")

# The key inside `WorkerState.meta` holding the per-year counters
# ({"2026": 12, ...} = 12 ids already allocated for 2026). Kept as a module
# constant so state-file surgery docs (OPERATIONS.md) and tests never
# hardcode a divergent string.
STATE_META_KEY = "bumelerze_id_counters"


def base36(n: int) -> str:
    """Non-negative integer -> lowercase base-36 string (no padding)."""
    if n < 0:
        raise ValueError(f"base36: negative value {n}")
    if n == 0:
        return "0"
    digits: list[str] = []
    while n:
        n, rem = divmod(n, 36)
        digits.append(_BASE36_DIGITS[rem])
    return "".join(reversed(digits))


def format_bumelerze_id(year: int, counter: int) -> str:
    """`(year, counter)` -> canonical bml id. `counter` is 1-based (the
    first event of a year is counter 1 -> `bml<year>0001`). Zero-padded to
    `SUFFIX_MIN_WIDTH`; wider counters keep all their digits (the
    documented past-`zzzz` rollover — never truncated, never reused).
    The year is zero-padded to 4 digits too: the RETROACTIVE archival
    catalog (`scripts/build_regional_catalog.py`) reaches back to
    documentary events of year 872 -> `bml0872...` — same format, no
    special case."""
    if not (0 <= year <= 9999):
        raise ValueError(f"format_bumelerze_id: year {year} not expressible in 4 digits")
    if counter < 1:
        raise ValueError(f"format_bumelerze_id: counter must be >= 1, got {counter}")
    return f"{BML_PREFIX}{year:04d}{base36(counter).rjust(SUFFIX_MIN_WIDTH, '0')}"


def parse_bumelerze_id(bml_id: str) -> tuple[int, int] | None:
    """Canonical id -> `(year, counter)`, or `None` if the string is not a
    well-formed bml id (validation helper for tests/tools, not a parser
    anything load-bearing depends on)."""
    m = BML_ID_RE.match(bml_id)
    if m is None:
        return None
    year = int(m.group(1))
    counter = 0
    for ch in m.group(2):
        counter = counter * 36 + _BASE36_DIGITS.index(ch)
    return year, counter


def year_from_time_ms(time_ms: int) -> int:
    """Origin epoch-ms -> UTC year (the id's year component — module
    docstring: origin year, never detection year)."""
    return _dt.datetime.fromtimestamp(time_ms / 1000.0, tz=_dt.timezone.utc).year


class BumelerzeIdAllocator:
    """Per-year counter allocator. Mutates the counters dict IN PLACE, so
    an allocator built over `WorkerState.meta[STATE_META_KEY]` persists its
    progress with the next `WorkerState.save` — no separate flush step, and
    a crash before save simply re-allocates the same not-yet-persisted ids
    on replay (safe: the matching `EventState.bumelerze_id` assignments
    were part of the same unsaved state, so nothing observable ever carried
    the lost ids)."""

    def __init__(self, counters: dict[str, int] | None = None) -> None:
        # str keys (not int) because this dict round-trips through JSON.
        self.counters: dict[str, int] = counters if counters is not None else {}

    def allocate(self, year: int) -> str:
        """Mint the next id for `year` — increments that year's counter and
        returns the formatted id. Counters only ever move forward."""
        key = str(year)
        next_counter = int(self.counters.get(key, 0)) + 1
        self.counters[key] = next_counter
        return format_bumelerze_id(year, next_counter)


def allocator_from_state(ws: Any) -> BumelerzeIdAllocator:
    """The allocator bound to a `WorkerState`'s own meta dict (the current
    single-writer authority, module docstring) — allocations persist with
    the caller's next `ws.save`. `Any` (duck-typed `.meta`) keeps this
    module import-light and free of a `worker.state` dependency cycle."""
    counters = ws.meta.setdefault(STATE_META_KEY, {})
    return BumelerzeIdAllocator(counters)


def ensure_bumelerze_id(ws: Any, event: Any, *, now_iso: str) -> str:
    """Return the tracked bml id for `event` (a `feed_watcher.FeedEvent`,
    duck-typed), allocating one — and creating a not-yet-computed tracked
    `EventState` stub if the event is unknown — when it has none. This is
    THE first-detection allocation point (called by
    `scripts/run_worker.py`'s `process_decisions` for every newly detected
    canonical event, `"new"` and `"catalog"` decisions alike — allocation
    does not depend on whether the SHAKEmap pipeline triggers).

    The stub (`last_version=0`, `params_hash=""`) marks "detected and
    id-assigned, nothing computed yet": `params_hash=""` can never equal a
    real params hash, so a subsequent `pipeline.run_pipeline` for the same
    event always computes v1 rather than short-circuiting, and
    `last_version=0` lets `feed_watcher` recognize a tracked-but-never-
    computed event whose revised params later cross the trigger policy."""
    from shake_service.worker.state import EventState  # local: avoid import cycle

    known = ws.get_event(event.external_id)
    if known is not None and known.bumelerze_id:
        return known.bumelerze_id

    bml_id = allocator_from_state(ws).allocate(year_from_time_ms(event.time_ms))
    if known is not None:
        known.bumelerze_id = bml_id
        known.provider_aliases.setdefault(event.source, event.external_id)
        return bml_id

    ws.upsert_event(
        EventState(
            external_id=event.external_id,
            source=event.source,
            mag=event.mag,
            lat=event.lat,
            lon=event.lon,
            depth_km=event.depth_km,
            last_version=0,
            params_hash="",
            product_paths={},
            last_feed_updated_ms=event.updated_ms,
            origin_time_ms=event.time_ms,
            first_seen_at=now_iso,
            last_computed_at="",
            bumelerze_id=bml_id,
            provider_aliases={event.source: event.external_id},
        )
    )
    return bml_id
