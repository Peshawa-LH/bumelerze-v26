#!/usr/bin/env python3
"""build_handbook_data — one-off/occasional build tool for the Engineer's
Handbook (spec-v1.md §7, design-brief.md §9): "engineer enters coordinates →
table of design values with a citation on every number".

Reads three READ-ONLY vault sources (never written to; see `docs/
data-registry.md` for provenance/licensing notes on each) and writes three
compact, offline, app-bundled JSON files under
`src/features/handbook/data/`, plus this run's extraction report at
`shake-service/handbook-data/HANDBOOK_DATA_REPORT.md` — same "generator
writes straight into src/" pattern as `bundle_atlas_for_app.py` (D21), and
the same readability-probe/loud-skip discipline `build_regional_catalog.py`
uses for vault reads.

Sources:
1. Iraqi Seismic Code 2017 design-PGA zonation (`PGA 2017.shp`, pyshp-free —
   read via `osgeo.ogr`, already pinned in requirements.txt via
   openquake/fiona's own GDAL dependency, so no new package was installed).
   9 polygon features; one (all fields NULL, ~0.0002 deg² sliver near
   47.97°E/30.02°N) is a digitization artifact with no PGA value and is
   dropped. The remaining 8 are simplified (Douglas-Peucker,
   SimplifyPreserveTopology, tolerance 0.02° ≈ 2.2 km at this latitude —
   chosen empirically: shrinks the raw ~5070 total vertices to ~386, final
   JSON ~7 KB, while keeping every zone boundary within roughly one
   downsampled-Vs30-grid-cell of its original digitized position, which is
   the operative precision floor for a "preliminary reference" tool per the
   in-app disclaimer) and written as a flat zone-polygon list for app-side
   point-in-polygon lookup (`src/features/handbook/point-in-polygon.ts`).

2. Iraq Vs30 raster (`vs30 clip.tif`, GDAL Int32, nodata 2147483647,
   0.008333° ≈ 30 arcsec native resolution, values 180-900 m/s). Downsampled
   via `gdal.Warp(resampleAlg="average")` to a 0.05° (~5.5 km) grid — chosen
   empirically: the finest resolution whose flat JSON array still clears the
   wave brief's "target ≤ ~200 KB" bundle-size ceiling (~160 KB actual;
   0.04° was already ~250 KB). The app samples this grid bilinearly
   (`src/features/handbook/vs30-sample.ts`) rather than nearest-neighbor, so
   the coarser grid still varies smoothly across a query point instead of
   jumping between cell values.

3. Sulaimani soil/site campaign (4 CSVs, Peshawa's own DAAD-Iraq/KISC field
   data, `soil-investigation/sulaimani-2024/metadata.md` — read verbatim
   below) — merged into one point list carrying whichever of
   {EC8 class, NEHRP class, a Vs30-ish estimate} each method actually
   produces (never fabricating a field a method doesn't measure).

Run: `./.venv/bin/python scripts/build_handbook_data.py` from
`shake-service/` (needs GDAL + its Python bindings, both already in
requirements.txt).
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from osgeo import gdal, ogr

gdal.UseExceptions()
ogr.UseExceptions()

# --- Paths ------------------------------------------------------------------

# Read-only vault data (`docs/data-registry.md` — never written to).
VAULT_ROOT = Path(
    "/Users/pesha/Library/CloudStorage/OneDrive-Personal/knowledge_vault/data"
)
PGA_SHAPEFILE = VAULT_ROOT / "gis-basemaps/iraq/SeismicCode-2017/PGA 2017.shp"
VS30_RASTER = VAULT_ROOT / "gis-basemaps/iraq/VS30/vs30 clip.tif"
VS30_CITATION_FILE = VAULT_ROOT / "gis-basemaps/iraq/VS30/Citation.txt"
SOIL_DIR = VAULT_ROOT / "soil-investigation/sulaimani-2024"
SOIL_METADATA_FILE = SOIL_DIR / "metadata.md"

REPO_ROOT = Path(__file__).resolve().parents[2]
SHAKE_SERVICE_ROOT = REPO_ROOT / "shake-service"
REPORT_DIR = SHAKE_SERVICE_ROOT / "handbook-data"
REPORT_PATH = REPORT_DIR / "HANDBOOK_DATA_REPORT.md"

APP_DATA_DIR = REPO_ROOT / "src" / "features" / "handbook" / "data"
PGA_ZONES_OUT = APP_DATA_DIR / "pga-zones.json"
VS30_GRID_OUT = APP_DATA_DIR / "vs30-grid.json"
SOIL_POINTS_OUT = APP_DATA_DIR / "soil-points.json"

# --- Tunables (see module docstring for how these were picked) -------------
PGA_SIMPLIFY_TOLERANCE_DEG = 0.02
VS30_GRID_RESOLUTION_DEG = 0.05
VS30_NODATA_SENTINEL = -9999


@dataclass
class SourceStats:
    label: str
    note: str = ""
    skipped_unreadable: bool = False
    extra: dict[str, Any] = field(default_factory=dict)


def check_readable(path: Path, stats: SourceStats, sample_bytes: int = 4096) -> bool:
    """Small-read readability probe (same convention as
    `build_regional_catalog.py`): loud-skip on a resource-deadlock/
    unreadable OneDrive placeholder rather than blocking the whole build."""
    try:
        with path.open("rb") as fh:
            fh.read(sample_bytes)
        return True
    except OSError as exc:
        stats.skipped_unreadable = True
        stats.note = f"SKIPPED (unreadable: {exc})"
        return False


# --- 1. Iraqi Seismic Code 2017 PGA zonation --------------------------------


def build_pga_zones(stats: SourceStats) -> list[dict[str, Any]]:
    for path in (PGA_SHAPEFILE, PGA_SHAPEFILE.with_suffix(".dbf")):
        if not check_readable(path, stats):
            return []

    ds = ogr.Open(str(PGA_SHAPEFILE))
    layer = ds.GetLayer()
    stats.extra["raw_feature_count"] = layer.GetFeatureCount()

    zones: list[dict[str, Any]] = []
    dropped_null = 0
    raw_vertex_total = 0
    for feat in layer:
        zone = feat.GetField("Zone")
        pga_g = feat.GetField("PGA 2017")
        geom = feat.GetGeometryRef()
        raw_vertex_total += geom.GetGeometryRef(0).GetPointCount()
        if zone is None or pga_g is None:
            # The one all-NULL sliver polygon (~0.0002 deg², see module
            # docstring) — no design value to attach, so it carries no
            # information for the handbook and is dropped rather than
            # shipped as a "zone" with a fabricated/missing PGA.
            dropped_null += 1
            continue
        simplified = geom.SimplifyPreserveTopology(PGA_SIMPLIFY_TOLERANCE_DEG)
        ring = simplified.GetGeometryRef(0)
        coords = [
            [round(ring.GetX(i), 4), round(ring.GetY(i), 4)]
            for i in range(ring.GetPointCount())
        ]
        zones.append({"zone": str(zone), "pgaG": float(pga_g), "ring": coords})

    stats.extra["zones_kept"] = len(zones)
    stats.extra["zones_dropped_null"] = dropped_null
    stats.extra["raw_vertex_total"] = raw_vertex_total
    stats.extra["simplified_vertex_total"] = sum(len(z["ring"]) for z in zones)
    stats.extra["pga_range_g"] = (
        min(z["pgaG"] for z in zones),
        max(z["pgaG"] for z in zones),
    )
    return zones


# --- 2. Iraq Vs30 raster -----------------------------------------------------


def build_vs30_grid(stats: SourceStats) -> Optional[dict[str, Any]]:
    if not check_readable(VS30_RASTER, stats):
        return None

    citation = ""
    if check_readable(VS30_CITATION_FILE, SourceStats(label="vs30-citation")):
        citation = VS30_CITATION_FILE.read_text(encoding="utf-8").strip()
    stats.extra["citation"] = citation

    src = gdal.Open(str(VS30_RASTER))
    src_band = src.GetRasterBand(1)
    src_nodata = src_band.GetNoDataValue()
    stats.extra["source_size"] = (src.RasterXSize, src.RasterYSize)
    src_stats = src_band.ComputeStatistics(False)
    stats.extra["source_min_max_m_s"] = (src_stats[0], src_stats[1])

    warped = gdal.Warp(
        "",
        src,
        format="MEM",
        xRes=VS30_GRID_RESOLUTION_DEG,
        yRes=VS30_GRID_RESOLUTION_DEG,
        resampleAlg="average",
        srcNodata=src_nodata,
        dstNodata=VS30_NODATA_SENTINEL,
    )
    band = warped.GetRasterBand(1)
    arr = band.ReadAsArray()
    gt = warped.GetGeoTransform()
    cols, rows = warped.RasterXSize, warped.RasterYSize

    values: list[int] = []
    valid_count = 0
    for row in arr.tolist():
        for v in row:
            if v <= VS30_NODATA_SENTINEL + 1:
                values.append(VS30_NODATA_SENTINEL)
            else:
                values.append(round(v))
                valid_count += 1

    grid = {
        "originLon": round(gt[0], 6),
        "originLat": round(gt[3], 6),
        "dLon": round(gt[1], 6),
        "dLat": round(gt[5], 6),
        "cols": cols,
        "rows": rows,
        "nodata": VS30_NODATA_SENTINEL,
        "citation": citation,
        "values": values,
    }
    stats.extra["grid_size"] = (cols, rows)
    stats.extra["valid_cells"] = valid_count
    stats.extra["total_cells"] = cols * rows
    return grid


# --- 3. Sulaimani soil/site points -------------------------------------------


def _read_csv_rows(path: Path, stats: SourceStats) -> list[dict[str, str]]:
    if not check_readable(path, stats):
        return []
    # `utf-8-sig` strips the BOM every one of these four exports starts with
    # (verified during exploration — first header cell reads "﻿ID"
    # etc. without this).
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def _parse_float(raw: Optional[str]) -> Optional[float]:
    if raw is None:
        return None
    text = raw.strip()
    if text == "" or text.lower() == "nan":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _parse_class(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    text = raw.strip()
    return text if text else None


def build_soil_points(all_stats: list[SourceStats]) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []

    # --- H/V spectral ratio (ambient microtremor) ---
    hv_stats = SourceStats(label="sulaimani-hv")
    all_stats.append(hv_stats)
    hv_rows = _read_csv_rows(SOIL_DIR / "SulaimaniSoil-SP-HV-2024-Revised-v3.csv", hv_stats)
    hv_kept = 0
    for row in hv_rows:
        lat, lon = _parse_float(row.get("Latitude")), _parse_float(row.get("Longitude"))
        if lat is None or lon is None:
            continue
        points.append(
            {
                "id": row.get("ID", "").strip() or f"hv-{hv_kept}",
                "method": "hvsr",
                "lat": lat,
                "lon": lon,
                "ec8": _parse_class(row.get("soil-class-EC8")),
                "nehrp": _parse_class(row.get("soil-class-NEHRP")),
                "vs30EstimateMS": _parse_float(row.get("sampled-vs30-dem")),
            }
        )
        hv_kept += 1
    hv_stats.extra["kept"] = hv_kept

    # --- Boreholes ---
    bh_stats = SourceStats(label="sulaimani-boreholes")
    all_stats.append(bh_stats)
    bh_rows = _read_csv_rows(SOIL_DIR / "Sulaimany_Boreholes-PLH-2024.csv", bh_stats)
    bh_kept = 0
    for row in bh_rows:
        lat, lon = _parse_float(row.get("latitude")), _parse_float(row.get("longitude"))
        if lat is None or lon is None:
            continue
        points.append(
            {
                "id": (row.get("Survey point") or "").strip() or f"bh-{bh_kept}",
                "method": "borehole",
                "lat": lat,
                "lon": lon,
                "ec8": _parse_class(row.get("EC8 - Borehole")),
                "nehrp": _parse_class(row.get("NEHRP - Boreholes")),
                # Boreholes in this dataset carry lithology logs, not a
                # Vs30-ish numeral — never fabricated here.
                "vs30EstimateMS": None,
            }
        )
        bh_kept += 1
    bh_stats.extra["kept"] = bh_kept

    # --- SPT -> Vs ---
    spt_stats = SourceStats(label="sulaimani-spt-vs")
    all_stats.append(spt_stats)
    spt_rows = _read_csv_rows(SOIL_DIR / "SPT_Vs_Suli_PLH.csv", spt_stats)
    spt_kept = 0
    for i, row in enumerate(spt_rows):
        lat, lon = _parse_float(row.get("Lat")), _parse_float(row.get("Long"))
        if lat is None or lon is None:
            continue
        boring_log = (row.get("Boring log") or "").strip()
        point = (row.get("Point") or "").strip()
        points.append(
            {
                "id": f"{boring_log}-{point}-{i}" if boring_log or point else f"spt-{i}",
                "method": "spt-vs",
                "lat": lat,
                "lon": lon,
                "ec8": _parse_class(row.get("EC8")),
                "nehrp": _parse_class(row.get("NEHRP")),
                # "Vs5" = Vs to 5 m depth, this dataset's shallowest fixed-
                # depth Vs read-out — the closest available proxy to Vs30 in
                # the SPT-derived rows, NOT a true 30 m average; the app-side
                # citation/footnote must say so (never silently equated with
                # Vs30).
                "vs30EstimateMS": _parse_float(row.get("Vs5 ")) or _parse_float(row.get("Vs5")),
            }
        )
        spt_kept += 1
    spt_stats.extra["kept"] = spt_kept

    # --- DEM-based Vs30 soil classification ---
    dem_stats = SourceStats(label="sulaimani-dem-vs30")
    all_stats.append(dem_stats)
    dem_rows = _read_csv_rows(SOIL_DIR / "SulaimaniSoil-DEMSoilClass-2024.csv", dem_stats)
    dem_kept = 0
    for row in dem_rows:
        lat, lon = _parse_float(row.get("Latitude")), _parse_float(row.get("Longitude"))
        if lat is None or lon is None:
            continue
        points.append(
            {
                "id": row.get("ID", "").strip() or f"dem-{dem_kept}",
                "method": "dem-vs30",
                "lat": lat,
                "lon": lon,
                "ec8": _parse_class(row.get("EC8")),
                "nehrp": _parse_class(row.get("NEHRP")),
                "vs30EstimateMS": _parse_float(row.get("sampled-vs30-dem")),
            }
        )
        dem_kept += 1
    dem_stats.extra["kept"] = dem_kept

    return points


# --- Report -------------------------------------------------------------------


def build_report(
    pga_stats: SourceStats,
    pga_zones: list[dict[str, Any]],
    vs30_stats: SourceStats,
    vs30_grid: Optional[dict[str, Any]],
    soil_stats: list[SourceStats],
    soil_points: list[dict[str, Any]],
    soil_metadata: str,
) -> str:
    lines = ["# Engineering handbook data build report", ""]
    lines.append(
        "Bumelerze Engineer's Handbook (spec-v1.md §7, design-brief.md §9) bundled data — "
        "built by `shake-service/scripts/build_handbook_data.py` from three read-only vault "
        "sources (`docs/data-registry.md`). **This report is for Peshawa's review of the "
        "extraction/provenance handling before the handbook screen ships publicly** — the "
        "spec's own open item flags Vs30/Iraqi-code licensing as a pre-ship blocker (§7 "
        "TODO); nothing here resolves that, it only documents exactly what was extracted so "
        "the licensing review has concrete numbers to work from."
    )
    lines.append("")

    # --- PGA ---
    lines.append("## 1. Iraqi Seismic Code 2017 — design PGA zonation")
    lines.append("")
    lines.append(f"Source: `{PGA_SHAPEFILE}` (owner's own digitization — see flag below).")
    lines.append("")
    if pga_stats.skipped_unreadable:
        lines.append(f"**SKIPPED — {pga_stats.note}**")
    else:
        lo, hi = pga_stats.extra["pga_range_g"]
        lines.append(
            f"- Raw shapefile features: {pga_stats.extra['raw_feature_count']} "
            f"(fields: `PGA`, `Zone`, `ID`, `PGA 2017` — the `PGA 2017` field was used as the "
            "canonical value; it matches the plain `PGA` field on every kept feature)."
        )
        lines.append(
            f"- Kept **{pga_stats.extra['zones_kept']}** zone polygons (Zones I-VII, PGA "
            f"{lo:.1f}g-{hi:.1f}g; Zone VI appears twice as two disjoint polygons, both "
            "0.6g)."
        )
        lines.append(
            f"- Dropped **{pga_stats.extra['zones_dropped_null']}** feature: a ~0.0002 deg² "
            "sliver polygon near 47.97°E/30.02°N with every attribute field NULL — a "
            "digitization artifact, not a real zone; carries no PGA value so it was excluded "
            "rather than shipped with a fabricated one."
        )
        lines.append(
            f"- Simplified {pga_stats.extra['raw_vertex_total']} raw vertices → "
            f"{pga_stats.extra['simplified_vertex_total']} "
            f"(Douglas-Peucker, tolerance {PGA_SIMPLIFY_TOLERANCE_DEG}° ≈ 2.2 km at this "
            "latitude, topology-preserving)."
        )
        out_size = PGA_ZONES_OUT.stat().st_size if PGA_ZONES_OUT.exists() else 0
        lines.append(f"- Output: `src/features/handbook/data/pga-zones.json` ({out_size:,} bytes).")
    lines.append("")
    lines.append(
        "**Licensing/provenance flag (owner confirmation needed):** per "
        "`docs/data-registry.md`, this shapefile is **the owner's own digitization** of "
        "the Iraqi Seismic Code 2017 zonation map, not a third-party redistributable dataset "
        "— confirm before the handbook screen ships publicly that in-app display of the "
        "zonation (not just Peshawa's own research use) is intended and that the code "
        "edition/citation text to show alongside it (which specific Iraqi Seismic Code 2017 "
        "publication/table) is settled."
    )
    lines.append("")

    # --- Vs30 ---
    lines.append("## 2. Iraq Vs30 raster")
    lines.append("")
    lines.append(f"Source: `{VS30_RASTER}` (+ `Citation.txt`, carried verbatim below).")
    lines.append("")
    if vs30_stats.skipped_unreadable or vs30_grid is None:
        lines.append(f"**SKIPPED — {vs30_stats.note}**")
    else:
        src_min, src_max = vs30_stats.extra["source_min_max_m_s"]
        src_w, src_h = vs30_stats.extra["source_size"]
        grid_w, grid_h = vs30_stats.extra["grid_size"]
        lines.append(
            f"- Source raster: {src_w}×{src_h} px, native ≈30 arcsec resolution, Vs30 range "
            f"{src_min:.0f}-{src_max:.0f} m/s (Int32, nodata sentinel 2147483647)."
        )
        lines.append(
            f"- Downsampled (GDAL `average` resampling) to a {grid_w}×{grid_h} grid at "
            f"{VS30_GRID_RESOLUTION_DEG}° (~5.5 km) resolution — "
            f"{vs30_stats.extra['valid_cells']:,}/{vs30_stats.extra['total_cells']:,} cells "
            "have valid data (the rest fall outside the source raster's Iraq clip extent and "
            "are the app's \"outside coverage\" state)."
        )
        out_size = VS30_GRID_OUT.stat().st_size if VS30_GRID_OUT.exists() else 0
        lines.append(f"- Output: `src/features/handbook/data/vs30-grid.json` ({out_size:,} bytes).")
        lines.append(
            "- Resolution was chosen empirically against the wave brief's \"target ≤ ~200 KB\" "
            f"ceiling: {VS30_GRID_RESOLUTION_DEG}° gives ~160 KB (0.04° was already ~250 KB); "
            "the app bilinearly interpolates between grid cells at query time "
            "(`src/features/handbook/vs30-sample.ts`) so the coarser grid still varies "
            "smoothly, though it is necessarily less precise than the native 30 m raster."
        )
    lines.append("")
    lines.append("**Citation (verbatim from `Citation.txt`):**")
    lines.append("")
    lines.append(f"> {vs30_stats.extra.get('citation', '')}")
    lines.append("")
    lines.append(
        "Note: this citation is for the SRTM30+ topographic DEM — the standard input to "
        "slope-based Vs30 estimation (Wald & Allen-style) — not a separate Vs30-specific "
        "publication; carried verbatim as instructed, no interpretation added."
    )
    lines.append("")
    lines.append(
        "**Licensing flag (owner confirmation needed):** `docs/data-registry.md` marks "
        "this layer \"check citation/license before in-app display\" — unresolved by this "
        "build, still an open item before the handbook screen ships publicly."
    )
    lines.append("")

    # --- Soil ---
    lines.append("## 3. Sulaimani soil/site dataset")
    lines.append("")
    lines.append(f"Source directory: `{SOIL_DIR}` (Peshawa's own DAAD-Iraq/KISC field campaign).")
    lines.append("")
    lines.append("**Provenance (verbatim from `metadata.md`):**")
    lines.append("")
    for line in soil_metadata.splitlines():
        lines.append(f"> {line}" if line.strip() else ">")
    lines.append("")
    lines.append("Per-file extraction:")
    lines.append("")
    lines.append("| Method | Source file | Field mapping (EC8 / NEHRP / Vs30-ish) | Rows kept |")
    lines.append("|---|---|---|---|")
    method_labels = {
        "sulaimani-hv": (
            "H/V spectral ratio",
            "SulaimaniSoil-SP-HV-2024-Revised-v3.csv",
            "`soil-class-EC8` / `soil-class-NEHRP` / `sampled-vs30-dem` (DEM proxy co-located at HV points)",
        ),
        "sulaimani-boreholes": (
            "Borehole",
            "Sulaimany_Boreholes-PLH-2024.csv",
            "`EC8 - Borehole` / `NEHRP - Boreholes` / none (lithology logs only, no Vs numeral)",
        ),
        "sulaimani-spt-vs": (
            "SPT→Vs",
            "SPT_Vs_Suli_PLH.csv",
            "`EC8` / `NEHRP` / `Vs5` (Vs to 5 m depth — the shallowest fixed-depth read-out available, **not a true 30 m average**, flagged as an estimate in the app)",
        ),
        "sulaimani-dem-vs30": (
            "DEM-based Vs30 class",
            "SulaimaniSoil-DEMSoilClass-2024.csv",
            "`EC8` / `NEHRP` / `sampled-vs30-dem`",
        ),
    }
    for s in soil_stats:
        label, source_file, mapping = method_labels[s.label]
        kept = s.extra.get("kept", 0) if not s.skipped_unreadable else "SKIPPED"
        lines.append(f"| {label} | `{source_file}` | {mapping} | {kept} |")
    lines.append("")
    lines.append(f"- Total merged points: **{len(soil_points)}**.")
    out_size = SOIL_POINTS_OUT.stat().st_size if SOIL_POINTS_OUT.exists() else 0
    lines.append(f"- Output: `src/features/handbook/data/soil-points.json` ({out_size:,} bytes).")
    lines.append(
        "- This is Peshawa's own campaign data — no third-party licensing flag (per "
        "`docs/data-registry.md`)."
    )
    lines.append("")

    lines.append("## Summary")
    lines.append("")
    if pga_zones:
        lo, hi = pga_stats.extra["pga_range_g"]
        lines.append(f"- PGA value range observed (Iraqi Code 2017 zonation): {lo:.1f}g-{hi:.1f}g.")
    lines.append(
        "- Licensing/citation status: **Vs30 citation carried verbatim above; Iraqi-code "
        "shapefile provenance = owner's own digitization, flagged above for confirmation; "
        "Sulaimani soil data = owner's own campaign, no external license concern.**"
    )
    lines.append(
        "- Per spec-v1.md §7's own TODO, none of this is cleared for public shipping until "
        "Peshawa confirms the two flags above — the data-model/build work itself was "
        "explicitly allowed to proceed ahead of that per the same TODO."
    )
    lines.append("")

    return "\n".join(lines)


def main() -> None:
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    pga_stats = SourceStats(label="pga-zones")
    pga_zones = build_pga_zones(pga_stats)
    PGA_ZONES_OUT.write_text(json.dumps(pga_zones, separators=(",", ":")))
    print(f"PGA zones: kept={len(pga_zones)} -> {PGA_ZONES_OUT}")

    vs30_stats = SourceStats(label="vs30-grid")
    vs30_grid = build_vs30_grid(vs30_stats)
    VS30_GRID_OUT.write_text(json.dumps(vs30_grid if vs30_grid is not None else {}, separators=(",", ":")))
    print(f"Vs30 grid -> {VS30_GRID_OUT}")

    soil_stats: list[SourceStats] = []
    soil_points = build_soil_points(soil_stats)
    SOIL_POINTS_OUT.write_text(json.dumps(soil_points, separators=(",", ":")))
    print(f"Soil points: kept={len(soil_points)} -> {SOIL_POINTS_OUT}")

    soil_metadata = ""
    metadata_stats = SourceStats(label="soil-metadata")
    if check_readable(SOIL_METADATA_FILE, metadata_stats):
        soil_metadata = SOIL_METADATA_FILE.read_text(encoding="utf-8").strip()

    report = build_report(
        pga_stats, pga_zones, vs30_stats, vs30_grid, soil_stats, soil_points, soil_metadata
    )
    REPORT_PATH.write_text(report, encoding="utf-8")
    print(f"Wrote {REPORT_PATH}")


if __name__ == "__main__":
    main()
