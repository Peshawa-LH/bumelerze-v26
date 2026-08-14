"""event_id.py: bml id format, allocator determinism/rollover, state-file
persistence, and the ensure-at-first-detection helper — no network, no
pipeline."""

from __future__ import annotations

import pytest

from shake_service import event_id
from shake_service.worker.feed_watcher import FeedEvent
from shake_service.worker.state import WorkerState

# 2026-08-13T22:28:04Z — reused across tests as a realistic origin time.
T_2026_MS = 1_786_660_084_000


def _event(*, external_id="us_test_1", source="usgs", time_ms=T_2026_MS, mag=4.0):
    return FeedEvent(
        external_id=external_id, source=source, mag=mag, lat=35.5, lon=45.0,
        depth_km=10.0, place="test", time_ms=time_ms, updated_ms=time_ms,
    )


# ---------------------------------------------------------------------------
# format_bumelerze_id / base36 / parse round trip
# ---------------------------------------------------------------------------


def test_first_id_of_a_year_is_zero_padded_0001():
    assert event_id.format_bumelerze_id(2026, 1) == "bml20260001"


def test_base36_suffix_uses_lowercase_digits_and_letters():
    # counter 471,201 = "a3kx" in base 36 — the spec doc's own example id.
    assert event_id.base36(471_201) == "a3kx"
    assert event_id.format_bumelerze_id(2026, 471_201) == "bml2026a3kx"


def test_suffix_rolls_to_five_chars_past_zzzz_never_truncated():
    last_4char = 36**4 - 1  # "zzzz"
    assert event_id.format_bumelerze_id(2026, last_4char) == "bml2026zzzz"
    # The documented rollover: the suffix GROWS — unique forever, no reuse.
    assert event_id.format_bumelerze_id(2026, last_4char + 1) == "bml202610000"


def test_parse_round_trips_padded_and_rollover_ids():
    assert event_id.parse_bumelerze_id("bml20260001") == (2026, 1)
    assert event_id.parse_bumelerze_id("bml2026a3kx") == (2026, 471_201)
    assert event_id.parse_bumelerze_id("bml202610000") == (2026, 36**4)
    assert event_id.parse_bumelerze_id("BML20260001") is None  # lowercase only
    assert event_id.parse_bumelerze_id("bml2026") is None
    assert event_id.parse_bumelerze_id("us2000bmcg") is None


def test_format_rejects_nonsense():
    with pytest.raises(ValueError):
        event_id.format_bumelerze_id(2026, 0)  # 1-based counters
    with pytest.raises(ValueError):
        event_id.format_bumelerze_id(999, 1)  # not a 4-digit year


def test_year_from_time_ms_is_utc():
    assert event_id.year_from_time_ms(T_2026_MS) == 2026
    # 1970-01-01T00:00:00Z exactly.
    assert event_id.year_from_time_ms(0) == 1970


# ---------------------------------------------------------------------------
# BumelerzeIdAllocator — determinism, per-year independence
# ---------------------------------------------------------------------------


def test_allocator_is_sequential_and_deterministic():
    a = event_id.BumelerzeIdAllocator()
    assert [a.allocate(2026) for _ in range(3)] == ["bml20260001", "bml20260002", "bml20260003"]
    # A fresh allocator over the same starting counters replays identically.
    b = event_id.BumelerzeIdAllocator()
    assert [b.allocate(2026) for _ in range(3)] == ["bml20260001", "bml20260002", "bml20260003"]


def test_allocator_counters_are_independent_per_year():
    a = event_id.BumelerzeIdAllocator()
    assert a.allocate(2026) == "bml20260001"
    assert a.allocate(2027) == "bml20270001"  # new year starts at 1
    assert a.allocate(2026) == "bml20260002"  # 2026 unaffected by 2027


def test_allocator_resumes_from_existing_counters_never_reuses():
    a = event_id.BumelerzeIdAllocator({"2026": 41})
    assert a.allocate(2026) == event_id.format_bumelerze_id(2026, 42)
    assert a.counters == {"2026": 42}


# ---------------------------------------------------------------------------
# State-file persistence (the single-writer authority today)
# ---------------------------------------------------------------------------


def test_allocator_from_state_persists_counters_across_save_load(tmp_path):
    state_path = tmp_path / "worker_state.json"
    ws = WorkerState()
    allocator = event_id.allocator_from_state(ws)
    assert allocator.allocate(2026) == "bml20260001"
    assert allocator.allocate(2026) == "bml20260002"
    ws.save(state_path)

    # A restarted worker resumes exactly where the counters left off.
    ws2 = WorkerState.load(state_path)
    assert ws2.meta[event_id.STATE_META_KEY] == {"2026": 2}
    assert event_id.allocator_from_state(ws2).allocate(2026) == "bml20260003"


# ---------------------------------------------------------------------------
# ensure_bumelerze_id — first-detection allocation
# ---------------------------------------------------------------------------


def test_ensure_creates_a_tracked_stub_for_an_unknown_event():
    ws = WorkerState()
    bml = event_id.ensure_bumelerze_id(ws, _event(), now_iso="2026-08-13T22:30:00+00:00")
    assert bml == "bml20260001"
    stub = ws.get_event("us_test_1")
    assert stub is not None
    assert stub.bumelerze_id == "bml20260001"
    assert stub.provider_aliases == {"usgs": "us_test_1"}
    # The "detected, nothing computed yet" stub shape (state.py doc):
    # last_version 0 + empty params_hash so a later pipeline run always
    # computes v1 instead of short-circuiting.
    assert stub.last_version == 0
    assert stub.params_hash == ""
    assert stub.origin_time_ms == T_2026_MS
    assert stub.first_seen_at == "2026-08-13T22:30:00+00:00"


def test_ensure_is_idempotent_the_id_is_immutable():
    ws = WorkerState()
    first = event_id.ensure_bumelerze_id(ws, _event(), now_iso="t0")
    second = event_id.ensure_bumelerze_id(ws, _event(), now_iso="t1")
    assert first == second == "bml20260001"
    # No second counter consumed by the replay.
    assert ws.meta[event_id.STATE_META_KEY] == {"2026": 1}


def test_ensure_backfills_an_id_onto_a_tracked_pre_upgrade_entry():
    # A pre-upgrade state entry (tracked, computed, but bumelerze_id None)
    # gets an id assigned in place — no stub, no duplicate entry.
    ws = WorkerState()
    event_id.ensure_bumelerze_id(ws, _event(external_id="seed"), now_iso="t0")
    legacy = ws.get_event("seed")
    legacy.bumelerze_id = None
    legacy.provider_aliases = {}
    legacy.last_version = 3
    bml = event_id.ensure_bumelerze_id(ws, _event(external_id="seed"), now_iso="t1")
    assert bml == "bml20260002"  # a NEW id (counter moved on; never reused)
    assert ws.get_event("seed").last_version == 3  # entry untouched otherwise
    assert ws.get_event("seed").provider_aliases == {"usgs": "seed"}


def test_ensure_uses_the_origin_year_not_the_detection_year():
    # Origin 2025-12-31T23:59:30Z, detected (now_iso) in 2026: the id says 2025.
    new_years_eve_ms = 1_767_225_570_000  # 2025-12-31T23:59:30Z
    ws = WorkerState()
    bml = event_id.ensure_bumelerze_id(
        ws, _event(external_id="nye", time_ms=new_years_eve_ms), now_iso="2026-01-01T00:00:40+00:00"
    )
    assert bml == "bml20250001"


def test_ensure_ids_survive_a_state_round_trip(tmp_path):
    state_path = tmp_path / "worker_state.json"
    ws = WorkerState()
    event_id.ensure_bumelerze_id(ws, _event(external_id="a"), now_iso="t0")
    event_id.ensure_bumelerze_id(ws, _event(external_id="b", source="emsc"), now_iso="t0")
    ws.save(state_path)

    ws2 = WorkerState.load(state_path)
    assert ws2.get_event("a").bumelerze_id == "bml20260001"
    assert ws2.get_event("b").bumelerze_id == "bml20260002"
    assert ws2.get_event("b").provider_aliases == {"emsc": "b"}
