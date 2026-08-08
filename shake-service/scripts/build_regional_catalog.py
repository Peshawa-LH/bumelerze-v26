"""Build the bundled Kurdistan/Iraq regional earthquake catalog.

Merges five source catalogs (READ-ONLY, kept outside the repo in the
knowledge vault — see `SOURCE_ROOT` below) into one deduped, normalized
SQLite database + CSV export + human-readable `BUILD_REPORT.md`, all
committed under `shake-service/regional-catalog/`. This is a one-off/
occasional build tool (rerun by hand whenever a source catalog is refreshed
or the merge rules change), not part of the always-on worker pipeline.

Sources (priority order, highest first — see `SOURCE_PRIORITY` and the
"Canonical parameter derivation" note in
`docs/research/event-pipeline-design.md` §2):

1. ISC-GEM  — the homogenized-Mw global instrumental catalogue (subset of
   `iraq/Onur-2017-comprehensive/isc-gem-cat.csv`). Highest priority: it is
   the field's gold-standard for consistent Mw, even though its Kurdistan-
   region coverage is sparse (M ≳ 5.5 only, and only through 2013).
2. Onur 2017 — `IraqEQCatr1updated.xlsx`, sheet "Iraq EQ Cat r1": Onur et
   al.'s own already-deduped, multi-source-merged Iraq backbone catalog
   (1903-2009). Second priority because it has *already done* a scholarly
   merge of several older Iraqi/regional networks — re-deduping it against
   ISC-GEM (which is highly reliable but sparse) makes sense, but it should
   outrank the remaining three raw, un-deduped sources.
3. EMME (Zare et al.) — regional catalog to 2006, always carries Mw.
4. USGS — two files (`Iraq-USGS-Catalog.xlsx`, `USGS-2006.csv`) with
   substantial ID overlap (890 events in common — see BUILD_REPORT), treated
   as one source and deduped by `id` before falling through to the general
   spatial-temporal merge.
5. KISC — two `List.nisn_*` station-era local lists (fixed-width text,
   mb magnitude only), lowest priority: single-network local detections with
   the least mature processing of the five sources.

Dedup/merge algorithm follows event-pipeline-design.md §2 (adapted for a
batch/offline build rather than a live streaming ingest):
  1. Exact match: same (source_catalog, source_id) → attach (mainly collapses
     the USGS file-pair's 890 shared ids, and the two overlapping KISC
     files' shared (ORID, EVID) rows).
  2. Cross-reference match: ISC-GEM's own `eventid` *is* an ISC bulletin
     event id, and Onur's "Iraq EQ Cat r1" sheet carries that same id in its
     `ISC EVENTID` column for ~60% of its rows (89 of them resolve into the
     Kurdistan/Iraq bbox and match an ISC-GEM row) — when both are present
     and equal, attach directly regardless of any time/distance drift.
  3. Spatial-temporal match: |Δ origin time| ≤ 16 s AND epicentral distance
     ≤ 100 km AND |ΔM| ≤ 1.5 (haversine distance; bucketed by a 16-second
     time window for O(n) matching instead of O(n²) — see `_bucket_key`).
     Multiple candidates → closest in (|Δt|, distance) lexicographic order.
  4. Otherwise → new internal event.
Records are ingested in strict source-priority order (see `SOURCE_PRIORITY`
above), so the record that *creates* an internal event is always the
highest-priority one among everything that ends up merged into it — canonical
fields are simply "whichever record created the event", which satisfies the
"priority order per field" rule without needing a separate resolution pass.
The one exception is `depth_km`: many higher-priority records lack a depth
(EMME/Onur don't always have one), so a null canonical depth is backfilled
from the first lower-priority merged record that has one — documented at
`_merge_into`.

Run: `python scripts/build_regional_catalog.py` from `shake-service/`
(with `.venv` activated — needs pandas, openpyxl, xlrd, on top of the
existing environment).
"""

from __future__ import annotations

import csv
import math
import re
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import pandas as pd

# --- Paths -------------------------------------------------------------

# Read-only vault data — never written to. If OneDrive hasn't fully
# hydrated a file (resource-deadlock / unreadable), the corresponding
# `read_*` function catches it, logs a loud SKIPPED note in `stats`, and
# the wave continues rather than blocking on it (wave-brief instruction).
SOURCE_ROOT = Path(
    "/Users/pesha/Library/CloudStorage/OneDrive-Personal/knowledge_vault/"
    "data/earthquake-catalogs"
)

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "shake-service" / "regional-catalog"
SQLITE_PATH = OUTPUT_DIR / "bumelerze-catalog.sqlite"
CSV_PATH = OUTPUT_DIR / "bumelerze-catalog.csv"
REPORT_PATH = OUTPUT_DIR / "BUILD_REPORT.md"

# --- Spatial scope -------------------------------------------------------
# Generous Kurdistan/Iraq box: covers all of Iraq plus the Zagros margin
# (western Iran, southeastern Turkey border strip, northeastern Syria) —
# wider than the KRG-administered region alone because seismic sources that
# shake Kurdistan (e.g. the Zagros fold-thrust belt, Sarpol-e Zahab-type
# events) sit across the Iran border, and the app's own gazetteer already
# covers border towns in all four countries (`src/features/geo/gazetteer.ts`).
BBOX_LAT_MIN, BBOX_LAT_MAX = 28.5, 39.5
BBOX_LON_MIN, BBOX_LON_MAX = 38.0, 50.5

# --- Dedup thresholds (event-pipeline-design.md §2) -----------------------
DEDUP_TIME_WINDOW_S = 16.0
DEDUP_DISTANCE_KM = 100.0
DEDUP_MAG_DELTA = 1.5

# Ingestion order = canonical-parameter priority order (highest first).
SOURCE_PRIORITY = ["ISCGEM", "ONUR2017", "EMME", "USGS", "KISC"]


# --- Data model ------------------------------------------------------------


@dataclass
class RawRecord:
    source_catalog: str
    source_id: Optional[str]
    isc_event_id: Optional[int]
    time: datetime  # tz-aware, UTC
    lat: float
    lon: float
    depth_km: Optional[float]
    mag: float
    mag_type: str


@dataclass
class MergedEvent:
    time: datetime
    lat: float
    lon: float
    depth_km: Optional[float]
    mag: float
    mag_type: str
    source_catalog: str
    source_id: Optional[str]
    contributing_sources: set[str] = field(default_factory=set)
    merged_count: int = 0


@dataclass
class SourceStats:
    label: str
    rows_read: int = 0
    parse_failures: int = 0
    out_of_bbox: int = 0
    missing_mag: int = 0
    kept: int = 0
    skipped_unreadable: bool = False
    note: str = ""


# --- Helpers ---------------------------------------------------------------


def in_bbox(lat: float, lon: float) -> bool:
    return BBOX_LAT_MIN <= lat <= BBOX_LAT_MAX and BBOX_LON_MIN <= lon <= BBOX_LON_MAX


def utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def check_readable(path: Path, stats: SourceStats, sample_bytes: int = 4096) -> bool:
    """Small-read readability probe (wave-brief instruction: test each vault
    file first; skip loudly on a resource-deadlock/unreadable error rather
    than blocking the whole build)."""
    try:
        with path.open("rb") as fh:
            fh.read(sample_bytes)
        return True
    except OSError as exc:
        stats.skipped_unreadable = True
        stats.note = f"SKIPPED (unreadable: {exc})"
        return False


# --- Source readers ---------------------------------------------------------
# Each reader takes a SourceStats it mutates in place and returns the list of
# RawRecords it managed to parse and keep (already bbox+magnitude filtered).


def read_iscgem(stats: SourceStats) -> list[RawRecord]:
    path = SOURCE_ROOT / "iraq/Onur-2017-comprehensive/isc-gem-cat.csv"
    if not check_readable(path, stats):
        return []

    cols = [
        "date", "lat", "lon", "smajax", "sminax", "strike", "depth_q", "depth",
        "depth_unc", "depth_q2", "mw", "mw_unc", "mw_q", "s", "mo", "fac",
        "mo_auth", "mpp", "mpr", "mrr", "mrt", "mtp", "mtt", "eventid",
    ]
    df = pd.read_csv(path, comment="#", header=None, names=cols, skipinitialspace=True)
    stats.rows_read = len(df)

    out: list[RawRecord] = []
    for row in df.itertuples(index=False):
        try:
            dt = datetime.strptime(row.date.strip(), "%Y-%m-%d %H:%M:%S.%f")
        except (ValueError, AttributeError):
            stats.parse_failures += 1
            continue
        lat, lon = float(row.lat), float(row.lon)
        if not in_bbox(lat, lon):
            stats.out_of_bbox += 1
            continue
        if pd.isna(row.mw):
            stats.missing_mag += 1
            continue
        eventid = int(row.eventid) if not pd.isna(row.eventid) else None
        depth = float(row.depth) if not pd.isna(row.depth) else None
        out.append(
            RawRecord(
                source_catalog="ISCGEM",
                source_id=str(eventid) if eventid is not None else None,
                isc_event_id=eventid,
                time=utc(dt),
                lat=lat,
                lon=lon,
                depth_km=depth,
                mag=float(row.mw),
                mag_type="Mw",
            )
        )
    stats.kept = len(out)
    return out


def read_onur2017(stats: SourceStats) -> list[RawRecord]:
    path = SOURCE_ROOT / "iraq/Onur-2017-comprehensive/IraqEQCatr1updated.xlsx"
    if not check_readable(path, stats):
        return []

    df = pd.read_excel(path, sheet_name="Iraq EQ Cat r1")
    # The source workbook's headers carry trailing whitespace (e.g.
    # "LAT     ", "MAG ") — strip them once here rather than matching the
    # exact padded strings at every access site below (itertuples() also
    # can't expose a column whose name contains internal spaces as an
    # attribute, e.g. "ISC EVENTID", so this rename is required, not just
    # cosmetic).
    df = df.rename(columns=lambda c: c.strip().replace(" ", "_"))
    stats.rows_read = len(df)

    out: list[RawRecord] = []
    for row in df.itertuples(index=False):
        year, month, day = row.YEAR, row.MONTH, row.DAY
        time_val = row.TIME
        lat, lon = row.LAT, row.LON
        mag = row.MAG
        mag_type_raw = row.TYPE
        isc_eventid_raw = getattr(row, "ISC_EVENTID", None)

        try:
            hour = time_val.hour if hasattr(time_val, "hour") else 0
            minute = time_val.minute if hasattr(time_val, "minute") else 0
            second = time_val.second if hasattr(time_val, "second") else 0
            dt = datetime(int(year), int(month), int(day), hour, minute, second)
        except (ValueError, TypeError):
            stats.parse_failures += 1
            continue

        lat, lon = float(lat), float(lon)
        if not in_bbox(lat, lon):
            stats.out_of_bbox += 1
            continue
        if pd.isna(mag):
            stats.missing_mag += 1
            continue

        depth_raw = row.DEPTH
        try:
            depth = float(depth_raw) if not pd.isna(depth_raw) else None
        except (TypeError, ValueError):
            depth = None

        isc_eventid = None
        if isc_eventid_raw is not None and not pd.isna(isc_eventid_raw):
            isc_eventid = int(isc_eventid_raw)

        out.append(
            RawRecord(
                source_catalog="ONUR2017",
                source_id=str(isc_eventid) if isc_eventid is not None else None,
                isc_event_id=isc_eventid,
                time=utc(dt),
                lat=lat,
                lon=lon,
                depth_km=depth,
                mag=float(mag),
                mag_type=str(mag_type_raw).strip(),
            )
        )
    stats.kept = len(out)
    return out


def read_emme(stats: SourceStats) -> list[RawRecord]:
    path = SOURCE_ROOT / "EMME_MiddleEast_Zare/Zare_EMME_EQCatalogue_Data.xls"
    if not check_readable(path, stats):
        return []

    # Only the "to 2006" main sheet (README's documented scope for this
    # file) — the workbook's second sheet is a different vintage/compilation
    # (Gruenthal 2012) not mentioned in the wave brief; deliberately excluded
    # to avoid silently mixing two differently-curated regional catalogs.
    df = pd.read_excel(path, sheet_name="EMME_Catalog_Up_to_2006_B_Dec")
    stats.rows_read = len(df)

    out: list[RawRecord] = []
    for row in df.itertuples(index=False):
        year, month, day = row.YEAR, row.MONTH, row.DAY
        if month == 0 or day == 0 or year < 1:
            # Year-only/year-month-only paleo-precision entries (160 rows in
            # the full sheet) — too imprecise to place on a specific day;
            # skipped rather than defaulted to day 1, which would silently
            # fabricate a date.
            stats.parse_failures += 1
            continue
        try:
            hour = int(row.H) if not pd.isna(row.H) else 0
            minute = int(row.M) if not pd.isna(row.M) else 0
            second = float(row.S) if not pd.isna(row.S) else 0.0
            day_carry = 0
            if hour == 24:
                # This sheet uses the old bulletin convention "hour 24" for
                # midnight rolling into the next day (169 rows) — not a
                # sentinel/error, so roll the date forward rather than
                # dropping otherwise-good records.
                hour = 0
                day_carry = 1
            dt = (
                datetime(int(year), int(month), int(day), hour, minute)
                + pd.Timedelta(days=day_carry, seconds=second)
            )
        except (ValueError, TypeError):
            stats.parse_failures += 1
            continue

        lat, lon = float(row.LAT), float(row.LONG)
        if not in_bbox(lat, lon):
            stats.out_of_bbox += 1
            continue

        # MW is populated for every row in this sheet (verified during
        # exploration); MW2/MB/MS are near-always empty/zero placeholders.
        # Still fall through defensively in priority order in case a future
        # refresh of this file has gaps.
        mag, mag_type = None, None
        for value, label in ((row.MW, "Mw"), (row.MW2, "Mw"), (row.MS, "Ms"), (row.MB, "Mb")):
            if value is not None and not pd.isna(value) and value > 0:
                mag, mag_type = float(value), label
                break
        if mag is None:
            stats.missing_mag += 1
            continue

        depth = float(row.DEPTH) if not pd.isna(row.DEPTH) else None

        out.append(
            RawRecord(
                source_catalog="EMME",
                source_id=str(int(row.ID_NEW)) if not pd.isna(row.ID_NEW) else None,
                isc_event_id=None,
                time=utc(dt.to_pydatetime() if hasattr(dt, "to_pydatetime") else dt),
                lat=lat,
                lon=lon,
                depth_km=depth,
                mag=mag,
                mag_type=mag_type,
            )
        )
    stats.kept = len(out)
    return out


# `Iraq-USGS-Catalog.xlsx`'s `time` column turns out to mix THREE string
# shapes in the same column (verified during exploration): most rows are
# full ISO8601 with milliseconds ("1970-10-25T11:22:18.570Z"), a smaller
# group is date-only DD/MM/YYYY ("20/06/1990" — no time-of-day at all), and
# a handful are a truncated/malformed ISO date with a stray trailing "T"
# and nothing after it ("1983-07-22T"). `USGS-2006.csv` is uniformly full
# ISO8601. A single robust per-string parser (tried in order) handles all
# four shapes instead of one `pd.to_datetime(..., format=...)` call per
# file, which is what silently produced ~1700 false parse failures on the
# xlsx file during development of this script.
_ISO_FORMATS = ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ")
_TRUNCATED_ISO_DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})T?$")


def _parse_usgs_time(raw: str) -> tuple[Optional[datetime], bool]:
    """Returns (parsed UTC datetime or None, is_date_only_precision)."""
    s = raw.strip()
    for fmt in _ISO_FORMATS:
        try:
            return datetime.strptime(s, fmt), False
        except ValueError:
            continue
    try:
        return datetime.strptime(s, "%d/%m/%Y"), True
    except ValueError:
        pass
    m = _TRUNCATED_ISO_DATE_RE.match(s)
    if m:
        return datetime.strptime(m.group(1), "%Y-%m-%d"), True
    return None, False


def read_usgs(stats: SourceStats) -> list[RawRecord]:
    # USGS-2006.csv read FIRST, not just file-listing order: both files are
    # the same priority tier ("USGS"), and for the 890 ids they share, the
    # record that CREATES the internal event becomes canonical (module
    # docstring). USGS-2006.csv has full ISO8601 timestamps for every row;
    # Iraq-USGS-Catalog.xlsx has 39 date-only/truncated ones (see the
    # data-quality note below) — reading the higher-precision file first
    # means a shared event (e.g. the well-known 2017 Halabja earthquake,
    # id us2000bmcg) keeps its real origin time instead of a midnight
    # placeholder silently winning by file-order coincidence.
    files = [
        SOURCE_ROOT / "iraq/USGS/USGS-2006.csv",
        SOURCE_ROOT / "iraq/USGS/Iraq-USGS-Catalog.xlsx",
    ]
    out: list[RawRecord] = []
    date_only_kept = 0
    for path in files:
        if not check_readable(path, stats):
            stats.note += f" [also skipped {path.name}: unreadable]"
            continue
        df = pd.read_excel(path, sheet_name="Worksheet") if path.suffix == ".xlsx" else pd.read_csv(path)
        stats.rows_read += len(df)
        for row in df.itertuples(index=False):
            dt, is_date_only = _parse_usgs_time(str(row.time))
            if dt is None:
                stats.parse_failures += 1
                continue
            lat, lon = float(row.latitude), float(row.longitude)
            if not in_bbox(lat, lon):
                stats.out_of_bbox += 1
                continue
            if pd.isna(row.mag):
                stats.missing_mag += 1
                continue
            depth = float(row.depth) if not pd.isna(row.depth) else None
            if is_date_only:
                date_only_kept += 1
            out.append(
                RawRecord(
                    source_catalog="USGS",
                    source_id=str(row.id),
                    isc_event_id=None,
                    time=utc(dt),
                    lat=lat,
                    lon=lon,
                    depth_km=depth,
                    mag=float(row.mag),
                    mag_type=str(row.magType) if not pd.isna(row.magType) else "",
                )
            )
    stats.kept = len(out)
    if date_only_kept:
        stats.note = (
            f"{stats.note} [{date_only_kept} kept rows have date-only origin times "
            "(no time-of-day in the source string — either DD/MM/YYYY or a truncated "
            "ISO date, both only found in Iraq-USGS-Catalog.xlsx) — "
            "midnight UTC is a placeholder, not a measured origin time; the 890 "
            "events this file shares by `id` with USGS-2006.csv still get the "
            "precise time via the exact-id dedup match, so this only affects "
            "events unique to Iraq-USGS-Catalog.xlsx]"
        )
    return out


_KISC_LINE_RE = re.compile(
    r"^\d{7}\s+([A-Za-z]{3}\d{2},\d{4})\s+(\d{2}:\d{2}:\d{2}\.\d+)\s+"
    r"(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(\d+)\s+(\d+)\s+(-?\d+\.\d+)\s*$"
)


def read_kisc(stats: SourceStats) -> list[RawRecord]:
    files = [
        SOURCE_ROOT / "iraq/KISC/List.nisn_2006-2011 (1).txt",
        SOURCE_ROOT / "iraq/KISC/List.nisn_2008-2009.txt",
    ]
    out: list[RawRecord] = []
    for path in files:
        if not check_readable(path, stats):
            stats.note += f" [also skipped {path.name}: unreadable]"
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            stats.rows_read += 1
            m = _KISC_LINE_RE.match(line)
            if not m:
                stats.parse_failures += 1
                continue
            date_str, time_str, lat_s, lon_s, depth_s, orid, evid, mb_s = m.groups()
            try:
                dt = datetime.strptime(f"{date_str} {time_str}", "%b%d,%Y %H:%M:%S.%f")
            except ValueError:
                stats.parse_failures += 1
                continue
            lat, lon = float(lat_s), float(lon_s)
            if not in_bbox(lat, lon):
                stats.out_of_bbox += 1
                continue
            mb = float(mb_s)
            if mb <= 0:
                # -1.0 is this catalog's explicit "no magnitude computed"
                # sentinel — never a real mb value.
                stats.missing_mag += 1
                continue
            out.append(
                RawRecord(
                    source_catalog="KISC",
                    source_id=f"{orid}-{evid}",
                    isc_event_id=None,
                    time=utc(dt),
                    lat=lat,
                    lon=lon,
                    depth_km=float(depth_s),
                    mag=mb,
                    mag_type="mb",
                )
            )
    stats.kept = len(out)
    return out


READERS = {
    "ISCGEM": read_iscgem,
    "ONUR2017": read_onur2017,
    "EMME": read_emme,
    "USGS": read_usgs,
    "KISC": read_kisc,
}


# --- Merge / dedup -----------------------------------------------------------


def _bucket_key(dt: datetime) -> int:
    return int(dt.timestamp() // DEDUP_TIME_WINDOW_S)


class Merger:
    def __init__(self) -> None:
        self.events: list[MergedEvent] = []
        self._exact_index: dict[tuple[str, str], int] = {}
        self._isc_index: dict[int, int] = {}
        self._buckets: dict[int, list[int]] = defaultdict(list)
        self.merge_log: list[tuple[str, str]] = []  # (matched_by, detail) for reporting

    def _register(self, record: RawRecord, idx: int) -> None:
        if record.source_id is not None:
            self._exact_index[(record.source_catalog, record.source_id)] = idx
        if record.isc_event_id is not None:
            self._isc_index[record.isc_event_id] = idx
        ev = self.events[idx]
        self._buckets[_bucket_key(ev.time)].append(idx)

    def _find_spatiotemporal(self, record: RawRecord) -> Optional[int]:
        bkey = _bucket_key(record.time)
        seen: set[int] = set()
        candidates: list[tuple[float, float, int]] = []
        for bk in (bkey - 1, bkey, bkey + 1):
            for idx in self._buckets.get(bk, []):
                if idx in seen:
                    continue
                seen.add(idx)
                ev = self.events[idx]
                dt = abs((ev.time - record.time).total_seconds())
                if dt > DEDUP_TIME_WINDOW_S:
                    continue
                dist = haversine_km(ev.lat, ev.lon, record.lat, record.lon)
                if dist > DEDUP_DISTANCE_KM:
                    continue
                if abs(ev.mag - record.mag) > DEDUP_MAG_DELTA:
                    continue
                candidates.append((dt, dist, idx))
        if not candidates:
            return None
        candidates.sort()
        return candidates[0][2]

    def ingest(self, record: RawRecord) -> None:
        idx: Optional[int] = None
        matched_by = None

        if record.source_id is not None:
            key = (record.source_catalog, record.source_id)
            if key in self._exact_index:
                idx = self._exact_index[key]
                matched_by = "exact-id"

        if idx is None and record.isc_event_id is not None:
            if record.isc_event_id in self._isc_index:
                idx = self._isc_index[record.isc_event_id]
                matched_by = "isc-eventid"

        if idx is None:
            idx = self._find_spatiotemporal(record)
            if idx is not None:
                matched_by = "spatiotemporal"

        if idx is None:
            self.events.append(
                MergedEvent(
                    time=record.time,
                    lat=record.lat,
                    lon=record.lon,
                    depth_km=record.depth_km,
                    mag=record.mag,
                    mag_type=record.mag_type,
                    source_catalog=record.source_catalog,
                    source_id=record.source_id,
                    contributing_sources={record.source_catalog},
                    merged_count=1,
                )
            )
            idx = len(self.events) - 1
        else:
            self._merge_into(idx, record, matched_by or "?")

        self._register(record, idx)

    def _merge_into(self, idx: int, record: RawRecord, matched_by: str) -> None:
        ev = self.events[idx]
        ev.contributing_sources.add(record.source_catalog)
        ev.merged_count += 1
        # Depth backfill only (see module docstring): canonical time/lat/lon/
        # mag/mag_type always come from whichever record CREATED the event,
        # which — because ingestion happens in strict source-priority order —
        # is always the highest-priority record among everything merged here.
        if ev.depth_km is None and record.depth_km is not None:
            ev.depth_km = record.depth_km
        self.merge_log.append((matched_by, f"{record.source_catalog}:{record.source_id}"))


# --- Output ------------------------------------------------------------------


def write_outputs(events: list[MergedEvent]) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ordered = sorted(events, key=lambda e: e.time)

    rows = []
    for i, ev in enumerate(ordered, start=1):
        rows.append(
            {
                "id": f"bumelerze-{i:06d}",
                "time": ev.time.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
                "year": ev.time.year,
                "lat": round(ev.lat, 4),
                "lon": round(ev.lon, 4),
                "depth_km": round(ev.depth_km, 2) if ev.depth_km is not None else None,
                "mag": round(ev.mag, 2),
                "mag_type": ev.mag_type,
                "source_catalog": ev.source_catalog,
                "source_id": ev.source_id,
                "contributing_sources": ",".join(sorted(ev.contributing_sources)),
                "merged_count": ev.merged_count,
            }
        )

    if SQLITE_PATH.exists():
        SQLITE_PATH.unlink()
    conn = sqlite3.connect(SQLITE_PATH)
    conn.execute(
        """
        CREATE TABLE events (
            id TEXT PRIMARY KEY,
            time TEXT NOT NULL,
            year INTEGER NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            depth_km REAL,
            mag REAL NOT NULL,
            mag_type TEXT NOT NULL,
            source_catalog TEXT NOT NULL,
            source_id TEXT,
            contributing_sources TEXT NOT NULL,
            merged_count INTEGER NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX idx_events_time ON events(time)")
    conn.execute("CREATE INDEX idx_events_mag ON events(mag)")
    conn.execute("CREATE INDEX idx_events_year ON events(year)")
    conn.executemany(
        """
        INSERT INTO events
            (id, time, year, lat, lon, depth_km, mag, mag_type,
             source_catalog, source_id, contributing_sources, merged_count)
        VALUES
            (:id, :time, :year, :lat, :lon, :depth_km, :mag, :mag_type,
             :source_catalog, :source_id, :contributing_sources, :merged_count)
        """,
        rows,
    )
    conn.commit()
    conn.close()

    with CSV_PATH.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()) if rows else [])
        writer.writeheader()
        writer.writerows(rows)

    return rows


def build_report(
    all_stats: list[SourceStats],
    events: list[MergedEvent],
    rows: list[dict],
    merge_log: list[tuple[str, str]],
) -> str:
    lines = ["# Regional catalog build report", ""]
    lines.append(
        "Bumelerze regional (Kurdistan/Iraq) earthquake catalog — merged from 5 source "
        "catalogs, deduped per `docs/research/event-pipeline-design.md` §2 "
        f"(16 s / 100 km / |ΔM|≤1.5). Bbox: lat {BBOX_LAT_MIN}-{BBOX_LAT_MAX}, "
        f"lon {BBOX_LON_MIN}-{BBOX_LON_MAX} (all Iraq + Zagros margin)."
    )
    lines.append("")
    lines.append(
        "**This report is for Peshawa's science review** — read the data-quality notes "
        "before treating any count here as final."
    )
    lines.append("")

    lines.append("## Per-source counts")
    lines.append("")
    lines.append(
        "| Source | Priority | Read | Parse failures | Out of bbox | Missing mag | Kept |"
    )
    lines.append("|---|---|---|---|---|---|---|")
    for rank, source in enumerate(SOURCE_PRIORITY, start=1):
        s = next(st for st in all_stats if st.label == source)
        if s.skipped_unreadable:
            lines.append(f"| {source} | {rank} | — | — | — | — | **SKIPPED — {s.note}** |")
            continue
        lines.append(
            f"| {source} | {rank} | {s.rows_read} | {s.parse_failures} | "
            f"{s.out_of_bbox} | {s.missing_mag} | {s.kept} |"
        )
    lines.append("")
    for s in all_stats:
        if s.note and not s.skipped_unreadable:
            lines.append(f"- **{s.label} note:** {s.note.strip()}")
    lines.append("")

    total_raw_kept = sum(s.kept for s in all_stats)
    lines.append("## Dedup / merge")
    lines.append("")
    lines.append(f"- Raw records kept across all sources (pre-dedup): **{total_raw_kept}**")
    lines.append(f"- Final merged events: **{len(events)}**")
    lines.append(f"- Records merged into an existing event (not counted as new events): "
                  f"**{total_raw_kept - len(events)}**")
    lines.append("")
    match_kind_counts = Counter(kind for kind, _ in merge_log)
    lines.append(
        "How those merges were matched — `exact-id` (same source_catalog + native id, e.g. "
        "the USGS file pair's shared `id` or the two overlapping KISC files' shared "
        "ORID-EVID), `isc-eventid` (ISC-GEM's `eventid` cross-referenced against Onur's "
        "`ISC EVENTID` column, step 2 of the algorithm), `spatiotemporal` (the general "
        "16 s / 100 km / ΔM≤1.5 fallback, step 3):"
    )
    lines.append("")
    lines.append("| Match kind | Count |")
    lines.append("|---|---|")
    for kind in ("exact-id", "isc-eventid", "spatiotemporal"):
        lines.append(f"| {kind} | {match_kind_counts.get(kind, 0)} |")
    lines.append("")
    lines.append("Canonical-parameter priority (highest first): "
                  "`ISC-GEM > Onur-2017 > EMME > USGS > KISC`. Rationale: ISC-GEM is the "
                  "homogenized-Mw gold standard where it has coverage (sparse — M≳5.5, "
                  "through 2013 only); Onur 2017 has *already* scholarly-deduped several "
                  "older Iraqi/regional networks for its Iraq backbone, so it outranks the "
                  "three remaining raw, un-deduped sources; EMME (always carries Mw) "
                  "outranks USGS/KISC's mixed mb/ML/mag-not-always-Mw values; KISC "
                  "(single-network local mb-only detections, least mature processing) "
                  "ranks last.")
    lines.append("")

    lines.append("### Contributing-source combinations")
    lines.append("")
    combo_counts = Counter(",".join(sorted(e.contributing_sources)) for e in events)
    lines.append("| Sources | Event count |")
    lines.append("|---|---|")
    for combo, count in combo_counts.most_common():
        lines.append(f"| {combo} | {count} |")
    lines.append("")

    lines.append("## Final catalog")
    lines.append("")
    lines.append(f"- Total events: **{len(events)}**")
    if events:
        years = [e.time.year for e in events]
        lines.append(f"- Year range: {min(years)}–{max(years)}")
        mags = [e.mag for e in events]
        lines.append(f"- Magnitude range: {min(mags):.2f}–{max(mags):.2f}")
    lines.append(f"- SQLite: `regional-catalog/bumelerze-catalog.sqlite`")
    lines.append(f"- CSV: `regional-catalog/bumelerze-catalog.csv`")
    lines.append("")

    lines.append("## Magnitude completeness by decade (quick histogram)")
    lines.append("")
    lines.append(
        "Event counts per decade, split above/below M4.5 — a rough, honest look at "
        "how complete the catalog likely is over time (older/smaller events are "
        "systematically under-recorded; this is NOT a formal Gutenberg-Richter "
        "completeness analysis, just a sanity check for Peshawa's review)."
    )
    lines.append("")
    decade_counts: dict[int, dict[str, int]] = defaultdict(lambda: {"lt45": 0, "ge45": 0})
    for e in events:
        decade = (e.time.year // 10) * 10
        bucket = "ge45" if e.mag >= 4.5 else "lt45"
        decade_counts[decade][bucket] += 1
    lines.append("| Decade | M < 4.5 | M ≥ 4.5 | Total |")
    lines.append("|---|---|---|---|")
    for decade in sorted(decade_counts):
        c = decade_counts[decade]
        total = c["lt45"] + c["ge45"]
        lines.append(f"| {decade}s | {c['lt45']} | {c['ge45']} | {total} |")
    lines.append("")

    lines.append("## Data-quality notes (honest, for science review)")
    lines.append("")
    lines.append(
        "- **EKDAG.csv excluded** per the vault README's provenance warning — not read, "
        "not counted."
    )
    lines.append(
        "- **EMME**: only the 'to 2006' main sheet was used; the workbook's second sheet "
        "(a 2012 Gruenthal-vintage compilation) was left out — not part of the wave brief's "
        "requested source, and mixing two differently-curated regional catalogs without "
        "review risks silently changing the merge-priority reasoning above."
    )
    lines.append(
        "- **EMME date precision**: 160 rows in the full sheet (before bbox filtering) carry "
        "year-only or year-month-only origin dates (no day/month), or a pre-instrumental "
        "(year < 1) date; all were skipped rather than defaulted to day 1, which would have "
        "fabricated a false precision. Separately, 169 rows use the old bulletin convention "
        "'hour 24' for midnight rolling into the next day — these were NOT skipped, just "
        "rolled forward a day (see `read_emme`)."
    )
    lines.append(
        "- **EMME pre-instrumental tail**: this sheet (and therefore the final catalog) "
        "includes documentary/historical earthquake entries reaching as far back as year "
        "872 — treat any event older than roughly the early-to-mid 20th century as "
        "historical/documentary-sourced, not instrumentally measured; magnitude and "
        "location precision for those is necessarily much lower than for the modern "
        "catalog. The magnitude-completeness table below visibly reflects this (very few "
        "events per decade before ~1960, ramping up sharply once KISC/USGS instrumental "
        "coverage begins in the 2000s)."
    )
    lines.append(
        "- **Onur 2017 backbone**: used sheet 'Iraq EQ Cat r1' specifically (the scholarly, "
        "already-deduped Iraq catalog per the vault README), not the raw 'Base catalogue' "
        "or 'Updated -2011' intermediate sheets in the same workbook."
    )
    lines.append(
        "- **Iraq-USGS-Catalog.xlsx time precision**: this file's `time` column mixes three "
        "string shapes — most rows are full ISO8601 with milliseconds (parsed at full "
        "precision), but 39 rows are either date-only (DD/MM/YYYY) or a truncated/malformed "
        "ISO date with no time-of-day at all; those 39 got 00:00:00 UTC as a placeholder. "
        "Events this file shares an `id` with in `USGS-2006.csv` (890 of them) always get "
        "the precise time via that exact-id match regardless, so the placeholder only "
        "affects events unique to Iraq-USGS-Catalog.xlsx."
    )
    lines.append(
        "- **KISC magnitude**: mb only (no Mw/ML in this source); rows with the catalog's "
        "explicit 'no magnitude' sentinel (-1.0) were dropped rather than treated as a real "
        "magnitude value."
    )
    lines.append(
        "- **KISC parse failures (2 total, 1 per file)**: harmless — each `List.nisn_*` file "
        "has one column-header text line that doesn't match the data row format; not data "
        "corruption."
    )
    lines.append(
        "- **KISC file overlap**: `List.nisn_2008-2009.txt` covers a period already inside "
        "`List.nisn_2006-2011 (1).txt`'s range; both were ingested as the same 'KISC' "
        "source and left for the general dedup pass to collapse — see the "
        "contributing-source table above for how much actually merged."
    )
    lines.append(
        "- **Depth backfill**: when the canonical (highest-priority) record for an event has "
        "no depth, the first lower-priority merged record that has one fills it in — every "
        "other canonical field always comes from the highest-priority record only."
    )
    lines.append(
        "- This is a MERGE of secondary catalogs, not a new scientific relocation/"
        "reprocessing — treat magnitudes/locations as only as good as their original source, "
        "and treat the 'final event count' as an upper bound on distinct physical events "
        "(imperfect dedup can still occasionally split or over-merge)."
    )
    lines.append("")

    return "\n".join(lines)


def main() -> None:
    all_stats: list[SourceStats] = []
    merger = Merger()

    for source in SOURCE_PRIORITY:
        stats = SourceStats(label=source)
        all_stats.append(stats)
        records = READERS[source](stats)
        for record in records:
            merger.ingest(record)
        print(
            f"{source}: read={stats.rows_read} parse_failures={stats.parse_failures} "
            f"out_of_bbox={stats.out_of_bbox} missing_mag={stats.missing_mag} "
            f"kept={stats.kept}"
        )

    print(f"Merged events: {len(merger.events)}")

    rows = write_outputs(merger.events)
    report = build_report(all_stats, merger.events, rows, merger.merge_log)
    REPORT_PATH.write_text(report, encoding="utf-8")
    print(f"Wrote {SQLITE_PATH}, {CSV_PATH}, {REPORT_PATH}")


if __name__ == "__main__":
    main()
