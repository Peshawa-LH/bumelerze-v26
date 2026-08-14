# Regional catalog build report

Bumelerze regional (Kurdistan/Iraq) earthquake catalog — merged from 5 source catalogs, deduped per `docs/research/event-pipeline-design.md` §2 (16 s / 100 km / |ΔM|≤1.5). Bbox: lat 28.5-39.5, lon 38.0-50.5 (all Iraq + Zagros margin).

**This report is for Peshawa's science review** — read the data-quality notes before treating any count here as final.

## Per-source counts

| Source | Priority | Read | Parse failures | Out of bbox | Missing mag | Kept |
|---|---|---|---|---|---|---|
| ISCGEM | 1 | 26889 | 0 | 26772 | 0 | 117 |
| ONUR2017 | 2 | 11805 | 0 | 4265 | 0 | 7540 |
| EMME | 3 | 28064 | 160 | 24130 | 0 | 3774 |
| USGS | 4 | 3425 | 0 | 1 | 0 | 3424 |
| KISC | 5 | 21910 | 2 | 3451 | 5576 | 12881 |

- **USGS note:** [39 kept rows have date-only origin times (no time-of-day in the source string — either DD/MM/YYYY or a truncated ISO date, both only found in Iraq-USGS-Catalog.xlsx) — midnight UTC is a placeholder, not a measured origin time; the 890 events this file shares by `id` with USGS-2006.csv still get the precise time via the exact-id dedup match, so this only affects events unique to Iraq-USGS-Catalog.xlsx]

## Dedup / merge

- Raw records kept across all sources (pre-dedup): **27736**
- Final merged events: **21360**
- Records merged into an existing event (not counted as new events): **6376**

How those merges were matched — `exact-id` (same source_catalog + native id, e.g. the USGS file pair's shared `id` or the two overlapping KISC files' shared ORID-EVID), `isc-eventid` (ISC-GEM's `eventid` cross-referenced against Onur's `ISC EVENTID` column, step 2 of the algorithm), `spatiotemporal` (the general 16 s / 100 km / ΔM≤1.5 fallback, step 3):

| Match kind | Count |
|---|---|
| exact-id | 4937 |
| isc-eventid | 65 |
| spatiotemporal | 1374 |

Canonical-parameter priority (highest first): `ISC-GEM > Onur-2017 > EMME > USGS > KISC`. Rationale: ISC-GEM is the homogenized-Mw gold standard where it has coverage (sparse — M≳5.5, through 2013 only); Onur 2017 has *already* scholarly-deduped several older Iraqi/regional networks for its Iraq backbone, so it outranks the three remaining raw, un-deduped sources; EMME (always carries Mw) outranks USGS/KISC's mixed mb/ML/mag-not-always-Mw values; KISC (single-network local mb-only detections, least mature processing) ranks last.

### Contributing-source combinations

| Sources | Event count |
|---|---|
| KISC | 8511 |
| ONUR2017 | 7226 |
| EMME | 2878 |
| USGS | 1627 |
| EMME,USGS | 607 |
| KISC,USGS | 186 |
| KISC,ONUR2017 | 55 |
| EMME,KISC,USGS | 54 |
| EMME,ISCGEM,ONUR2017 | 50 |
| EMME,ONUR2017 | 43 |
| EMME,ONUR2017,USGS | 27 |
| EMME,ISCGEM | 22 |
| ISCGEM | 16 |
| EMME,KISC | 15 |
| ISCGEM,USGS | 13 |
| ISCGEM,ONUR2017 | 10 |
| ONUR2017,USGS | 6 |
| KISC,ONUR2017,USGS | 5 |
| ISCGEM,ONUR2017,USGS | 2 |
| EMME,KISC,ONUR2017 | 2 |
| EMME,ISCGEM,ONUR2017,USGS | 1 |
| EMME,ISCGEM,KISC,ONUR2017,USGS | 1 |
| ISCGEM,KISC,ONUR2017,USGS | 1 |
| ISCGEM,KISC,USGS | 1 |
| EMME,KISC,ONUR2017,USGS | 1 |

## Final catalog

- Total events: **21360**
- Year range: 872–2023
- Magnitude range: 0.86–7.70
- SQLite: `regional-catalog/bumelerze-catalog.sqlite`
- CSV: `regional-catalog/bumelerze-catalog.csv`

## Bumelerze ids (retroactive assignment)

Every merged event carries a canonical `bumelerze_id` (`bml` + 4-digit year + base-36 per-year counter — scheme + allocation rules: `shake_service/event_id.py`, spec `docs/research/bumelerze-id-scheme.md`), assigned retroactively by this build: per-year counters walked over the deterministic time-sorted event order, so an unchanged-sources rebuild reproduces every id exactly (see `write_outputs`).

- Ids assigned: **21360** across **177** distinct years
- First (oldest event): `bml08720001`
- Last (newest event): `bml2023003t`
- Busiest year: 2009 (3720 events)

## Live continuation — `regional-catalog/live-catalog.jsonl`

This compiled db is the PRE-LAUNCH archive; its from-launch successor is `regional-catalog/live-catalog.jsonl` (`shake_service/worker/live_catalog.py`): the worker appends one JSON line per newly detected canonical event — any magnitude, post-cross-provider-dedup, bml id included, whether or not a SHAKEmap was computed for it. That file is append-only (first-detection records; the worker state file holds current params) and merges into this database as an additional source at future rebuilds / the Supabase backend sync — with its already-assigned live bml ids carried through verbatim (live ids are immutable; only THIS build's retroactive ids may renumber when historical sources are refreshed).

## Magnitude completeness by decade (quick histogram)

Event counts per decade, split above/below M4.5 — a rough, honest look at how complete the catalog likely is over time (older/smaller events are systematically under-recorded; this is NOT a formal Gutenberg-Richter completeness analysis, just a sanity check for Peshawa's review).

| Decade | M < 4.5 | M ≥ 4.5 | Total |
|---|---|---|---|
| 870s | 0 | 1 | 1 |
| 1000s | 0 | 2 | 2 |
| 1030s | 0 | 1 | 1 |
| 1040s | 0 | 1 | 1 |
| 1050s | 0 | 1 | 1 |
| 1110s | 0 | 2 | 2 |
| 1130s | 0 | 3 | 3 |
| 1150s | 0 | 1 | 1 |
| 1170s | 0 | 1 | 1 |
| 1200s | 0 | 1 | 1 |
| 1220s | 0 | 1 | 1 |
| 1270s | 0 | 1 | 1 |
| 1300s | 0 | 1 | 1 |
| 1310s | 0 | 1 | 1 |
| 1480s | 0 | 1 | 1 |
| 1600s | 0 | 1 | 1 |
| 1640s | 0 | 2 | 2 |
| 1660s | 0 | 1 | 1 |
| 1670s | 0 | 1 | 1 |
| 1680s | 0 | 1 | 1 |
| 1690s | 0 | 2 | 2 |
| 1700s | 0 | 4 | 4 |
| 1710s | 0 | 2 | 2 |
| 1720s | 0 | 1 | 1 |
| 1780s | 0 | 2 | 2 |
| 1800s | 0 | 1 | 1 |
| 1840s | 0 | 4 | 4 |
| 1850s | 0 | 3 | 3 |
| 1860s | 0 | 6 | 6 |
| 1870s | 0 | 8 | 8 |
| 1880s | 0 | 4 | 4 |
| 1890s | 0 | 4 | 4 |
| 1900s | 0 | 28 | 28 |
| 1910s | 0 | 17 | 17 |
| 1920s | 1 | 20 | 21 |
| 1930s | 1 | 84 | 85 |
| 1940s | 0 | 64 | 64 |
| 1950s | 7 | 66 | 73 |
| 1960s | 115 | 305 | 420 |
| 1970s | 428 | 557 | 985 |
| 1980s | 334 | 553 | 887 |
| 1990s | 778 | 579 | 1357 |
| 2000s | 12098 | 546 | 12644 |
| 2010s | 3965 | 365 | 4330 |
| 2020s | 264 | 119 | 383 |

## Data-quality notes (honest, for science review)

- **EKDAG.csv excluded** per the vault README's provenance warning — not read, not counted.
- **EMME**: only the 'to 2006' main sheet was used; the workbook's second sheet (a 2012 Gruenthal-vintage compilation) was left out — not part of the wave brief's requested source, and mixing two differently-curated regional catalogs without review risks silently changing the merge-priority reasoning above.
- **EMME date precision**: 160 rows in the full sheet (before bbox filtering) carry year-only or year-month-only origin dates (no day/month), or a pre-instrumental (year < 1) date; all were skipped rather than defaulted to day 1, which would have fabricated a false precision. Separately, 169 rows use the old bulletin convention 'hour 24' for midnight rolling into the next day — these were NOT skipped, just rolled forward a day (see `read_emme`).
- **EMME pre-instrumental tail**: this sheet (and therefore the final catalog) includes documentary/historical earthquake entries reaching as far back as year 872 — treat any event older than roughly the early-to-mid 20th century as historical/documentary-sourced, not instrumentally measured; magnitude and location precision for those is necessarily much lower than for the modern catalog. The magnitude-completeness table below visibly reflects this (very few events per decade before ~1960, ramping up sharply once KISC/USGS instrumental coverage begins in the 2000s).
- **Onur 2017 backbone**: used sheet 'Iraq EQ Cat r1' specifically (the scholarly, already-deduped Iraq catalog per the vault README), not the raw 'Base catalogue' or 'Updated -2011' intermediate sheets in the same workbook.
- **Iraq-USGS-Catalog.xlsx time precision**: this file's `time` column mixes three string shapes — most rows are full ISO8601 with milliseconds (parsed at full precision), but 39 rows are either date-only (DD/MM/YYYY) or a truncated/malformed ISO date with no time-of-day at all; those 39 got 00:00:00 UTC as a placeholder. Events this file shares an `id` with in `USGS-2006.csv` (890 of them) always get the precise time via that exact-id match regardless, so the placeholder only affects events unique to Iraq-USGS-Catalog.xlsx.
- **KISC magnitude**: mb only (no Mw/ML in this source); rows with the catalog's explicit 'no magnitude' sentinel (-1.0) were dropped rather than treated as a real magnitude value.
- **KISC parse failures (2 total, 1 per file)**: harmless — each `List.nisn_*` file has one column-header text line that doesn't match the data row format; not data corruption.
- **KISC file overlap**: `List.nisn_2008-2009.txt` covers a period already inside `List.nisn_2006-2011 (1).txt`'s range; both were ingested as the same 'KISC' source and left for the general dedup pass to collapse — see the contributing-source table above for how much actually merged.
- **Depth backfill**: when the canonical (highest-priority) record for an event has no depth, the first lower-priority merged record that has one fills it in — every other canonical field always comes from the highest-priority record only.
- This is a MERGE of secondary catalogs, not a new scientific relocation/reprocessing — treat magnitudes/locations as only as good as their original source, and treat the 'final event count' as an upper bound on distinct physical events (imperfect dedup can still occasionally split or over-merge).
