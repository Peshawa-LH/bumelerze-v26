# Engineering handbook data build report

Bumelerze Engineer's Handbook (spec-v1.md §7, design-brief.md §9) bundled data — built by `shake-service/scripts/build_handbook_data.py` from three read-only vault sources (`docs/data-registry.md`). **This report is for Peshawa's review of the extraction/provenance handling before the handbook screen ships publicly** — the spec's own open item flags Vs30/Iraqi-code licensing as a pre-ship blocker (§7 TODO); nothing here resolves that, it only documents exactly what was extracted so the licensing review has concrete numbers to work from.

## 1. Iraqi Seismic Code 2017 — design PGA zonation

Source: `/Users/pesha/Library/CloudStorage/OneDrive-Personal/knowledge_vault/data/gis-basemaps/iraq/SeismicCode-2017/PGA 2017.shp` (owner's own digitization — see flag below).

- Raw shapefile features: 9 (fields: `PGA`, `Zone`, `ID`, `PGA 2017` — the `PGA 2017` field was used as the canonical value; it matches the plain `PGA` field on every kept feature).
- Kept **8** zone polygons (Zones I-VII, PGA 0.1g-0.7g; Zone VI appears twice as two disjoint polygons, both 0.6g).
- Dropped **1** feature: a ~0.0002 deg² sliver polygon near 47.97°E/30.02°N with every attribute field NULL — a digitization artifact, not a real zone; carries no PGA value so it was excluded rather than shipped with a fabricated one.
- Simplified 5070 raw vertices → 386 (Douglas-Peucker, tolerance 0.02° ≈ 2.2 km at this latitude, topology-preserving).
- Output: `src/features/handbook/data/pga-zones.json` (7,128 bytes).

**Licensing/provenance flag (owner confirmation needed):** per `docs/data-registry.md`, this shapefile is **the owner's own digitization** of the Iraqi Seismic Code 2017 zonation map, not a third-party redistributable dataset — confirm before the handbook screen ships publicly that in-app display of the zonation (not just Peshawa's own research use) is intended and that the code edition/citation text to show alongside it (which specific Iraqi Seismic Code 2017 publication/table) is settled.

## 2. Iraq Vs30 raster

Source: `/Users/pesha/Library/CloudStorage/OneDrive-Personal/knowledge_vault/data/gis-basemaps/iraq/VS30/vs30 clip.tif` (+ `Citation.txt`, carried verbatim below).

- Source raster: 1171×997 px, native ≈30 arcsec resolution, Vs30 range 180-900 m/s (Int32, nodata sentinel 2147483647).
- Downsampled (GDAL `average` resampling) to a 195×166 grid at 0.05° (~5.5 km) resolution — 17,261/32,370 cells have valid data (the rest fall outside the source raster's Iraq clip extent and are the app's "outside coverage" state).
- Output: `src/features/handbook/data/vs30-grid.json` (159,928 bytes).
- Resolution was chosen empirically against the wave brief's "target ≤ ~200 KB" ceiling: 0.05° gives ~160 KB (0.04° was already ~250 KB); the app bilinearly interpolates between grid cells at query time (`src/features/handbook/vs30-sample.ts`) so the coarser grid still varies smoothly, though it is necessarily less precise than the native 30 m raster.

**Citation (verbatim from `Citation.txt`):**

> Index of /pub/srtm30_plus. Retrieved February 8, 2023 from https://topex.ucsd.edu/pub/srtm30_plus/

Note: this citation is for the SRTM30+ topographic DEM — the standard input to slope-based Vs30 estimation (Wald & Allen-style) — not a separate Vs30-specific publication; carried verbatim as instructed, no interpretation added.

**Licensing flag (owner confirmation needed):** `docs/data-registry.md` marks this layer "check citation/license before in-app display" — unresolved by this build, still an open item before the handbook screen ships publicly.

## 3. Sulaimani soil/site dataset

Source directory: `/Users/pesha/Library/CloudStorage/OneDrive-Personal/knowledge_vault/data/soil-investigation/sulaimani-2024` (Peshawa's own DAAD-Iraq/KISC field campaign).

**Provenance (verbatim from `metadata.md`):**

> # Sulaimani (Sulaymaniyah) soil / site-condition investigation — 2024
>
> Site-characterization dataset for **Sulaymaniyah, Kurdistan (Iraq)**, for seismic
> site amplification / microzonation. Peshawa's own dataset (DAAD-Iraq / KISC field
> campaign). These are the **final / revised versions** — the copies the SHAKEmaps
> toolkit (v26) runs on.
>
> - **Copied** (not moved) from `2_WorkDrive/5_MyPhD/SHAKEmaps/SHAKEmaps-Toolkit-v26/event_data/sulaimany_soil_data` on 2026-07-15. Live copy stays in v26.
> - **Full research project** (raw data + processing history): `2_WorkDrive/1_Reserach/2024_DAAD-Iraq_KISC-SoilInvestigation`.
> - **Paper:** WCEE2024, session GEO10 "Soil Amplification" (`WCEE24-GEO10-Full_Paper_Sulaimaniyah`).
> - All datasets carry **Lat/Long** → mappable; all classified to **EC8** and **NEHRP** (HV also DIN 4149:2005).
>
> ## Files
> | File | Rows | Method / content |
> |---|---|---|
> | `SulaimaniSoil-SP-HV-2024-Revised-v3.csv` | 62 | **H/V spectral ratio** (ambient microtremor). Peak frequency/amplitude cross-checked across tools (hvsrpy, geopsy), SESAME clarity criteria; soil class per DIN 4149 / EC8 / NEHRP. *This is the final revised (v3).* |
> | `Sulaimany_Boreholes-PLH-2024.csv` | 61 | **Borehole** logs — well depth, layer thickness, depth-profile columns (0–90 m), EC8/NEHRP class. |
> | `SPT_Vs_Suli_PLH.csv` | 103 | **SPT → Vs** correlation — N-values, Vs, Vs(5 m), EC8/NEHRP, per boring log. |
> | `SulaimaniSoil-DEMSoilClass-2024.csv` | 77 | **DEM-based Vs30** soil classification (`sampled-vs30-dem`), EC8/NEHRP. |
>
> ## Notes
> - Three independent site-condition methods (HV microtremor, boreholes, SPT-Vs) +
>   a topography/DEM proxy — cross-comparable for Vs30 / soil-class mapping.
> - Distinct from the **building-stock** Sulaimani dataset (`../../building-stock/2024_Sulaimani/`).

Per-file extraction:

| Method | Source file | Field mapping (EC8 / NEHRP / Vs30-ish) | Rows kept |
|---|---|---|---|
| H/V spectral ratio | `SulaimaniSoil-SP-HV-2024-Revised-v3.csv` | `soil-class-EC8` / `soil-class-NEHRP` / `sampled-vs30-dem` (DEM proxy co-located at HV points) | 62 |
| Borehole | `Sulaimany_Boreholes-PLH-2024.csv` | `EC8 - Borehole` / `NEHRP - Boreholes` / none (lithology logs only, no Vs numeral) | 61 |
| SPT→Vs | `SPT_Vs_Suli_PLH.csv` | `EC8` / `NEHRP` / `Vs5` (Vs to 5 m depth — the shallowest fixed-depth read-out available, **not a true 30 m average**, flagged as an estimate in the app) | 103 |
| DEM-based Vs30 class | `SulaimaniSoil-DEMSoilClass-2024.csv` | `EC8` / `NEHRP` / `sampled-vs30-dem` | 77 |

- Total merged points: **303**.
- Output: `src/features/handbook/data/soil-points.json` (36,434 bytes).
- This is Peshawa's own campaign data — no third-party licensing flag (per `docs/data-registry.md`).

## Summary

- PGA value range observed (Iraqi Code 2017 zonation): 0.1g-0.7g.
- Licensing/citation status: **Vs30 citation carried verbatim above; Iraqi-code shapefile provenance = owner's own digitization, flagged above for confirmation; Sulaimani soil data = owner's own campaign, no external license concern.**
- Per spec-v1.md §7's own TODO, none of this is cleared for public shipping until Peshawa confirms the two flags above — the data-model/build work itself was explicitly allowed to proceed ahead of that per the same TODO.
