-- 0008: canonical Bumelerze event id ("bml id") on public.events.
-- Additive only — no existing column, constraint, or policy changes.
--
-- Scheme (implemented in shake-service/shake_service/event_id.py; spec:
-- docs/research/bumelerze-id-scheme.md): `bml` + 4-digit UTC origin
-- year + lowercase base-36 per-year counter, zero-padded to 4 chars and
-- growing past `zzzz` (e.g. bml20260001, bml2026a3kx, bml202610000).
-- Assigned exactly once at first detection of a canonical (post-dedup)
-- event and immutable forever after; retroactive ids for the pre-launch
-- archival catalog were assigned by scripts/build_regional_catalog.py.
--
-- NULLable on purpose: rows ingested before the allocator handover (and
-- any event the worker never saw) may not have one yet; the backfill
-- reconciles from the worker's regional-catalog/live-catalog.jsonl and
-- state file. UNIQUE because a bml id names exactly one physical event.

alter table public.events
  add column bumelerze_id text unique;

comment on column public.events.bumelerze_id is
  'Canonical Bumelerze event id: bml + 4-digit origin year + base-36 per-year counter (bml20260001, bml2026a3kx; grows past zzzz, never reused). Scheme + allocation rules: shake-service/shake_service/event_id.py and docs/research/bumelerze-id-scheme.md. Assigned once at first detection, immutable; merges/splits repair provider aliases, never this id. ALLOCATOR HANDOVER: today the single allocation authority is the shake-service worker state file (meta.bumelerze_id_counters, single-writer); when ingestion moves server-side, allocation moves to a per-year Postgres sequence/counter table seeded FROM those worker counters so no id is ever reused across the switch — same format, byte-identical.';
