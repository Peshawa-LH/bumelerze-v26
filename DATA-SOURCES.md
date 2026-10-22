# Data sources and attribution

Bumelerze does not generate earthquake data. It collects, merges, and displays
data produced by public seismological agencies and open geospatial projects.
This file lists every source, the terms it comes under, and the credit it asks
for.

Items marked **[VERIFY]** are ones where the published terms are ambiguous,
unreachable, or in tension with something else here. They are marked rather than
guessed at, and they are open questions, not settled positions.

Contents:

1. [Live event feeds](#1-live-event-feeds)
2. [The bundled regional catalog](#2-the-bundled-regional-catalog)
3. [Terms of the compiled Bumelerze catalog](#3-terms-of-the-compiled-bumelerze-catalog)
4. [Map data](#4-map-data)
5. [Site and terrain data](#5-site-and-terrain-data)
6. [Live seismic stations and waveforms](#6-live-seismic-stations-and-waveforms)
7. [Engineer's handbook data](#7-engineers-handbook-data)
8. [Exposure data behind the damage estimates](#8-exposure-data-behind-the-damage-estimates)
9. [Scientific models and software](#9-scientific-models-and-software)
10. [Fonts and icons](#10-fonts-and-icons)
11. [Third-party software dependencies](#11-third-party-software-dependencies)
12. [Data the app collects itself](#12-data-the-app-collects-itself)

---

## 1. Live event feeds

Configured in `src/features/events/config.ts`. All three are queried in parallel
and merged into one deduplicated event list.

### USGS (United States Geological Survey)

- **Endpoints:** `https://earthquake.usgs.gov/fdsnws/event/1/query` and the
  `4.5_week.geojson` summary feed.
- **Terms:** USGS-authored data and information are in the **U.S. Public
  Domain** (<https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits>).
  No licence restriction. Attribution is requested, not required.
- **Requested credit:** `Credit: U.S. Geological Survey`.
- **Note:** the public-domain status covers USGS-authored data. Some images and
  graphics hosted on USGS sites are third-party copyrighted; those are not used
  here.

### EMSC / CSEM (European-Mediterranean Seismological Centre)

- **Endpoint:** `https://www.seismicportal.eu/fdsnws/event/1/query`.
- **Terms:** <https://www.seismicportal.eu/terms.html>. The page states that
  "some of the datasets" on the site are under **CC BY 4.0**, and separately
  contains a general clause permitting reproduction for personal, academic,
  educational, and non-commercial use.
- **Requested credit:** `Credit: EMSC/CSEM, https://www.emsc-csem.org`.
- **[VERIFY]** The terms page does not say which datasets the CC BY 4.0
  statement covers, and does not reconcile that statement with its
  non-commercial clause. For the FDSN event endpoint specifically there is no
  unambiguous per-endpoint licence. This needs to be confirmed with EMSC in
  writing before Bumelerze is distributed through the app stores.

### GEOFON (GFZ Helmholtz Centre for Geosciences, Potsdam)

- **Endpoint:** `https://geofon.gfz.de/fdsnws/event/1/query`.
- **Terms:** **CC BY 4.0**. Stated at <https://geofon.gfz.de/eqinfo/faq/>:
  earthquake products produced by GEOFON (event locations including depths and
  magnitudes) are released under CC BY 4.0.
- **Requested credit:** "Event locations were obtained from the GEOFON program
  of the GFZ Helmholtz Centre for Geosciences using data from the GEVN partner
  networks."

### ISC (International Seismological Centre)

- **Endpoint:** `http://www.isc.ac.uk/fdsnws/event/1/query` (server-side
  ingester only, `supabase/functions/ingest-events/`; not a client-side feed —
  see that function's README). Polled daily as a backfill/correction sweep,
  not a live feed: the ISC Bulletin is reviewed and runs roughly 13 months
  behind. Carries records authored by ISN (Iraqi Meteorological and
  Seismology Organisation), SLUB (Seismological Laboratory of University of
  Basrah), ISK (Kandilli Observatory / KOERI, Turkey), TEH/THR (Tehran
  University / IIEES, Iran), AFAD (Turkey), and IDC (CTBTO) — each source
  record's `author_agency`/`magnitude_author` (migration 0023) preserves
  which one actually authored it, so per-event attribution can name the real
  contributing agency, not just "ISC".
- **Shown to users:** the ISC Bulletin also supplies 130,153 of the 150,072
  events in the bundled regional catalog (section 2). The Catalog screen names
  ISC as the source of each of those events, with its ISC event id.
- **Terms:** ISC's citation page
  (<https://www.isc.ac.uk/iscbulletin/citing.php>, checked 2026-10-19) says
  that data retrieved from the ISC Bulletin "should always be cited. This
  includes use by academic or commercial organisations, as well as by
  individuals." It asks for the product citation and the articles that
  describe the procedures. No separate licence text was found: the old
  terms-of-use page (`isc.ac.uk/termsofuse/`) returns 404, and the bulletin's
  text output names each contributing agency but states no licence.
- **Citation:** International Seismological Centre (2026), On-line Bulletin,
  <https://doi.org/10.31905/D808B830>. For the location procedure: Bondár, I.
  and Storchak, D.A. (2011), _Geophys. J. Int._, 186, 1220 to 1244,
  <https://doi.org/10.1111/j.1365-246X.2011.05107.x>.

## 2. The bundled regional catalog

`assets/catalog/bumelerze-catalog.sqlite` is a compiled catalog of 150,072
events for Iraq and the Zagros margin (lat 28.5 to 39.5, lon 38.0 to 50.5),
merged from six source catalogs. Events per source after the merge:

| Source             | Events  |
| ------------------ | ------- |
| ISC Bulletin       | 130,153 |
| KISC               | 8,130   |
| Onur et al. (2017) | 7,364   |
| EMME               | 3,544   |
| USGS               | 764     |
| ISC-GEM            | 117     |

The merge rules, per-source counts, and data-quality caveats are in
`regional-catalog/BUILD_REPORT.md` in the `bumelerze-engine` repository, which
builds this file. The Catalog screen names the source catalog and source id
of every event.

The source catalogs themselves are not redistributed in this repository; only
the merged result is. Their individual terms:

### ISC Bulletin

- **Provider:** International Seismological Centre.
- **Coverage used:** 2011 to the catalog build (2026-08-27), every magnitude
  the bulletin carries inside the bounding box, with the authoring agency of
  each solution. It is the only source with coverage after 2017.
- **Terms and citation:** as in section 1: ISC asks that data from the
  bulletin always be cited, by academic and commercial users alike, and
  states no further licence. Product citation: International Seismological
  Centre (2026), On-line Bulletin, <https://doi.org/10.31905/D808B830>.

### ISC-GEM Global Instrumental Earthquake Catalogue

- **Provider:** International Seismological Centre and GEM Foundation.
- **Terms:** **CC BY-SA 3.0 Unported**, covering both copyright and database
  rights (<http://www.isc.ac.uk/iscgem/download.php>). Commercial use is
  permitted; **share-alike applies**.
- **Citation:** International Seismological Centre (2026), ISC-GEM Earthquake
  Catalogue, <https://doi.org/10.31905/d808b825>. Additionally Storchak et al.
  (2013, 2015) and Di Giacomo et al. (2018) for general use, Bondar et al.
  (2015) for locations, and Di Giacomo et al. (2015a, 2018) for magnitudes.
- **[VERIFY]** The share-alike condition is the sharpest constraint in this
  whole file. See section 3.

### Onur et al. (2017), comprehensive Iraq catalogue

- **Citation:** Onur, T., Gok, R., Abdulnaby, W., Mahdi, H., Numan, N.M.S.,
  Al-Shukri, H., Shakir, A.M., Chlaib, H.K., Ameen, T.H., and Abd, N.A. (2017),
  "A Comprehensive Earthquake Catalog for Iraq in Terms of Moment Magnitude",
  _Seismological Research Letters_, 88(3), 798 to 811,
  <https://doi.org/10.1785/0220160078>.
- **Terms:** **no explicit open licence found.** The catalogue is distributed as
  an SRL Electronic Supplement, and the Seismological Society of America states
  that supplemental material is governed by its copyright transfer policy. SSA's
  free-reuse allowance covers a few figures or tables and a short word count,
  which does not cover redistributing a catalogue file.
- **[VERIFY]** Permission from SSA or the authors is needed before this source's
  contribution can be redistributed as open data. The accepted manuscript is
  publicly readable via DOE PAGES/OSTI (LLNL-JRNL-682738), but public access is
  not an open licence.

### EMME (Earthquake Model of the Middle East) catalogue

- **Citation:** Zare, M., Amini, H., Yazdi, P., et al. (2014), "Recent
  developments of the Middle East catalog", _Journal of Seismology_, 18,
  749 to 772, <https://doi.org/10.1007/s10950-014-9444-1>.
- **Terms:** governed by GEM Foundation data licensing policy rather than by the
  journal. GEM's published policy is an initial release under CC BY-NC-SA 4.0,
  re-released under CC BY-SA 4.0 after 18 months, with commercial use beyond
  that requiring a separate agreement.
- **[VERIFY]** The GEM licensing page was not directly reachable during this
  review and the above was read only through secondary extracts. Given the 2014
  date the CC BY-SA re-release should apply, but this must be confirmed
  directly, because a surviving non-commercial term would be incompatible with
  distributing the app through the app stores.

### USGS (regional files)

- Two USGS-sourced files, in the U.S. Public Domain as above. No restriction.

### KISC / Iraqi national network station lists

- Local single-network detection lists (`List.nisn_*`), mb magnitudes only.
- **[VERIFY]** No published licence or terms-of-use statement is known for these
  files. Their provenance and redistribution terms need to be established with
  the originating institution before the compiled catalog is offered as open
  data.

## 3. Terms of the compiled Bumelerze catalog

**Intent: the compiled Bumelerze regional catalog is offered under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**, so that researchers
can reuse it with nothing more than a citation. Attribution: "Bumelerze regional
earthquake catalog, Peshawa L. Hasan, <https://bumelerze.com>", together with
the underlying source citations listed in section 2.

**[VERIFY] This licence choice is not yet reconciled with its inputs, and must
be before the catalog is redistributed as CC BY 4.0.** Three specific problems:

1. **ISC-GEM is CC BY-SA 3.0.** Share-alike propagates. A derived database that
   incorporates ISC-GEM records would ordinarily have to be offered under the
   same or a compatible share-alike licence, which CC BY 4.0 is not.
2. **EMME is under GEM Foundation terms** that were CC BY-NC-SA on release. If
   the non-commercial term still applies, that source cannot be in an openly
   licensed derivative at all.
3. **Onur et al. (2017) and the KISC lists carry no open licence.**
4. **The ISC Bulletin**, which supplies most of the events, asks for citation
   but states no licence (section 1).

The realistic resolutions, in rough order of preference: obtain written
permission from each rights holder; or offer the compiled catalog under
**CC BY-SA 4.0** instead, which would satisfy ISC-GEM and (if the re-release has
taken effect) EMME; or rebuild the catalog from the unrestricted sources only
and publish that subset under CC BY 4.0. Until one of those is done, the catalog
in this repository should be treated as bundled for use _in the app_, not as an
open dataset ready for redistribution.

This is flagged rather than quietly resolved because a wrong licence statement
on a dataset is worse than none.

## 4. Map data

### OpenFreeMap (fallback basemap)

- **Styles:** `https://tiles.openfreemap.org/styles/liberty` and `.../dark`.
- **When it is used:** in builds without a MapTiler key, and automatically
  whenever the MapTiler style fails to load (`src/features/map/style-provider.ts`).
- **Terms:** the tile data is **OpenStreetMap data under the Open Database
  License (ODbL)**. The OpenFreeMap project code is MIT. The tile schema is
  OpenMapTiles (code BSD-3-Clause, design CC BY 4.0), with Natural Earth (public
  domain), Noto Sans (SIL OFL 1.1), and Maki icons (CC0 1.0).
- **Required attribution:** `OpenFreeMap © OpenMapTiles Data from OpenStreetMap`.
  The OpenFreeMap portion is optional but appreciated; the OpenStreetMap
  attribution is required.
- **Already displayed in-app.** The vector source's TileJSON carries the
  attribution string and MapLibre feeds it into an always-expanded
  `AttributionControl` (`compact: false`); see `src/features/map/config.ts` for
  why it is not duplicated by hand.

### MapTiler (live basemap)

- **Styles:** `outdoor-v4` and `outdoor-v4-dark` via
  `https://api.maptiler.com/maps/<id>/style.json`.
- **When it is used:** the production web build sets the MapTiler key
  (`scripts/build-app-web.sh`), so this is the basemap people see at
  app.bumelerze.com.
- **Terms:** MapTiler Cloud terms of service, over OpenStreetMap data under
  ODbL.
- **Required attribution, on screen whenever the map is shown:** `© MapTiler`
  linking to <https://maptiler.com/copyright>, and `© OpenStreetMap contributors`
  linking to <https://openstreetmap.org/copyright>. MapTiler's style documents
  carry these, and MapLibre renders them through the same attribution control.
- **Logo:** MapTiler's documentation states that free-tier accounts must
  additionally display the MapTiler logo linking to maptiler.com. The app
  renders it whenever a MapTiler style is the active basemap, on the map and
  in the handbook's coordinate picker (`MapTilerAttributionLogo`,
  `src/features/map/components/`).

### OpenStreetMap

- **Terms:** © OpenStreetMap contributors, data under the **Open Database
  License (ODbL) 1.0** (<https://www.openstreetmap.org/copyright>). ODbL applies
  to the _data_; map tiles rendered from it are subject to the tile provider's
  own terms above.

### Kurdish place names dataset (own-labels, derived extract of OpenStreetMap)

- **What it is:** neither OpenFreeMap's nor MapTiler's OpenMapTiles-schema
  vector tiles carry a Sorani (`name:ckb`) field at all, so below the dozen
  hand-checked cities in the bundled gazetteer (`src/features/geo/gazetteer.ts`),
  the map had no real Kurdish place names. OpenStreetMap itself does carry
  `name:ckb` and often `name:ku` (Kurmanji) tags, contributed by Kurdish
  mappers — `scripts/build-kurdish-places.mjs` queries the public Overpass API
  for cities/towns/suburbs/villages/hamlets in the app's own `REGION_BBOX`
  carrying one of `name:ckb`/`name:ku`/`name:ar`, dedups node/way duplicates,
  and tiers the result into two bundled JSON assets:
  `src/features/geo/data/kurdish-places-core.json` (tier 1-2: city/town/suburb)
  and `kurdish-places-villages.json` (tier 3: village/hamlet, loaded lazily by
  the web map). Rendered by `src/features/map/own-labels.ts`.
- **Terms:** this is a derived extract of OpenStreetMap data, so it is
  covered by the same **Open Database License (ODbL) 1.0** as the parent
  OpenStreetMap entry above. ODbL's share-alike term means this SPECIFIC
  extracted dataset (the two JSON files, not the app as a whole) is itself
  offered under ODbL — it is not relicensed just because it ships inside this
  repository.
- **Required attribution:** © OpenStreetMap contributors.
- **Displayed in-app:** the own-labels GeoJSON source carries this credit as
  its own `attribution` string (`OWN_LABELS_ATTRIBUTION` in `own-labels.ts`),
  collected automatically by the same `AttributionControl` the basemap's own
  attribution feeds into — no separate hand-typed credit line to keep in
  sync.
- **Data-quality note, not a licence issue:** the build script rejects a
  `name:ku` value that is Arabic-script (Kurmanji is written in Latin script;
  a small share of `name:ku` tags in the source data — concentrated on small
  villages south of Baghdad, well outside any Kurdish-populated area — are
  copy-paste/import mistakes, not real Kurmanji) and a `name:ckb` value with
  no Arabic-script characters at all. Rejected values are dropped, not
  guessed at; see the script's own doc comment for the exact counts from the
  most recent run.

### Map overlays (Layers panel)

Every overlay is listed, with its source, link and licence, in
`src/features/map/layer-registry.ts`; the Layers panel shows a one-line credit
under each toggle. All are off by default.

#### Active faults: AFEAD

- **File:** `public/data/afead-faults-region.geojson`, a regional clip
  (lon 34 to 54, lat 25 to 43) of the Active Faults of Eurasia Database,
  AFEAD v2021, GIN RAS.
- **Terms:** **CC BY 4.0**. Redistributable with credit.
- **Citation:** Zelenin, E., Bachmanov, D., Garipova, S., Trifonov, V. and
  Kozhurin, A. (2022), "The Active Faults of Eurasia Database (AFEAD): the
  ontology and design behind the continental-scale dataset", _Earth System
  Science Data_, 14, 4489 to 4503, <https://doi.org/10.5194/essd-14-4489-2022>.
- **Displayed in-app:** "GIN RAS" under the toggle, and "Source: AFEAD" when a
  fault is tapped.

#### Active faults: GEM Global Active Faults

- **File:** `public/data/gem-active-faults-region.geojson`, a regional clip
  (same box) of the GEM Global Active Faults Database. In this region it
  carries the EMME fault model with slip rates.
- **Terms:** **CC BY-SA 4.0**. **Share-alike applies:** the clipped file is
  itself offered under CC BY-SA 4.0, not under the repository's code licence.
- **Citation:** Styron, R. and Pagani, M. (2020), "The GEM Global Active
  Faults Database", _Earthquake Spectra_, 36(1_suppl), 160 to 180,
  <https://doi.org/10.1177/8755293020944182>; data at
  <https://github.com/GEMScienceTools/gem-global-active-faults>.
- **Displayed in-app:** "GEM Foundation" under the toggle, and the source
  catalog "via GEM" when a fault is tapped.

#### Past earthquakes (M5+)

- **File:** `public/data/historical-earthquakes.geojson`: the 1,023 events of
  magnitude 5 or more in the bundled regional catalog (section 2), with the
  homogenised Mw where one exists. Exported by
  `scripts/export_map_overlays.py` in `bumelerze-engine`.
- **Terms:** those of each source catalog (sections 2 and 3); each point
  carries its source catalog.
- **Displayed in-app:** "Bumelerze catalogue" under the toggle.

## 5. Site and terrain data

### Terrain hillshade: AWS Open Data "Terrain Tiles"

- **Source:** `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`
  (<https://registry.opendata.aws/terrain-tiles/>), Mapzen's terrarium-encoded
  elevation tiles, now mirrored by AWS. Wired up in
  `src/features/map/terrain.ts`.
- **Terms:** there is **no single licence**. The dataset is a mosaic of national
  and international elevation products, and the registry entry points at an
  attribution document
  (<https://github.com/tilezen/joerd/blob/master/docs/attribution.md>) that
  requires per-source credit "in a place that is reasonable to the medium".
- **Sources requiring named credit** include: 3DEP, NED, GMTED2010, SRTM and
  ETOPO1 (courtesy of the U.S. Geological Survey and NOAA); ArcticDEM
  (DigitalGlobe / NSF); "© Commonwealth of Australia (Geoscience Australia)
  2017"; "© offene Daten Österreichs, Digitales Geländemodell (DGM)
  Österreich"; "Contains information licensed under the Open Government Licence
  Canada"; "Produced using Copernicus data and information funded by the
  European Union" (EU-DEM); "Source: INEGI, Continental relief, 2016";
  "Copyright 2011 Crown copyright (c) Land Information New Zealand";
  "© Kartverket"; "© Environment Agency copyright and/or database right 2015".
- **Currently displayed in-app:** `Terrain: Mapzen/AWS Open Data`
  (`TERRAIN_ATTRIBUTION` in `src/features/map/terrain.ts`).
- **[VERIFY]** That short string is a dataset-level credit and does not include
  the per-source list above. The app should link the short credit through to the
  full attribution document, which is the normal way this is satisfied on a
  small screen. Worth doing before release.

### Vs30 site conditions: USGS Global Vs30 Mosaic

- **Used by:** `shake_service/vs30.py` (`RasterVs30`) in the `bumelerze-engine`
  repository. The raster
  file itself is held outside this repository and is not redistributed here.
- **Terms:** **CC0 1.0 Universal** (public-domain dedication), per
  <https://www.usgs.gov/data/us-geological-survey-global-vs30-mosaic>. No
  attribution is legally required.
- **Requested citation:** Heath, D.C., Wald, D.J., Worden, C.B., Thompson, E.M.,
  and Smoczyk, G.M. (2020), "A global hybrid VS30 map with a topographic
  slope-based default and regional map insets", _Earthquake Spectra_, 36(3),
  1570 to 1584, <https://doi.org/10.1177/8755293020911137>. Underlying method:
  Wald and Allen (2007).
- **[VERIFY]** The file in use is the older ShakeMap-era build
  (`global_vs30_ca_waor_ut_jp_tw.grd`, with California, Washington/Oregon, Utah,
  Japan, and Taiwan insets) from the `usgs/earthquake-global_vs30` repository,
  not the current `global_vs30.grd` distribution. The older repository states
  only "Copyright © 2019 United States Geological Survey"; its licence file was
  not read during this review. Treat it as USGS public domain by default, but
  confirm, and consider moving to the current CC0-marked distribution.

### Ground conditions overlay (Vs30 site classes)

- **File:** `public/data/vs30-site-class.png` (with its corners in
  `src/features/map/vs30-overlay.ts`): the engine's regional Vs30 grid, from
  the USGS global Vs30 model above, coloured by NEHRP site class. Exported by
  `scripts/export_map_overlays.py` in `bumelerze-engine`.
- **Terms:** USGS, public domain, as above.
- **Displayed in-app:** "USGS" under the "Ground conditions (Vs30)" toggle.

## 6. Live seismic stations and waveforms

- **What it is:** the Sensor tab's "Live stations" view shows 38 open
  seismic stations around the region and streams their recent waveforms.
  The station list is `assets/stations/live-stations.json`, built by
  `scripts/build-live-stations.mjs` from the FDSN station services below.
  Waveforms are fetched on request from the same services' FDSN dataselect;
  on the web, EarthScope stations also stream through EarthScope's public
  DataLink ring (`wss://rtserve.earthscope.org/datalink`).
- **Services and networks:**
  - **EarthScope** (<https://service.earthscope.org/fdsnws>): network MP,
    the Iraqi Seismic Observatory (13 stations); networks A0 and A2
    (6 stations); IU.GNI of the Global Seismographic Network (1 station).
  - **KOERI**, Kandilli Observatory, via EIDA
    (<https://eida.koeri.boun.edu.tr/fdsnws>): network KO (16 stations).
  - **GEOFON**, GFZ (<https://geofon.gfz.de/fdsnws>): GE.ARPR (1 station).
  - **Raspberry Shake** (<https://data.raspberryshake.org/fdsnws>): AM.R079D
    (1 station), the Kurdistan Educational Seismic Observatory's Raspberry
    Shake 4D, hosted by Tishk International University in Hawler. Network
    AM, operated by Raspberry Shake, S.A.; DOI
    <https://doi.org/10.7914/SN/AM>. Its public archive serves data 30
    minutes old and older, so the app counts it as live for an hour and
    shows the delay ("Last sample 30 min ago").
- **Terms:** only open (unrestricted) channels are requested
  (`includerestricted=false`). Each network sets its own terms and citation;
  network DOIs and citations are listed at <https://www.fdsn.org/networks/>.
- **Raspberry Shake terms:** <https://raspberryshake.org/license/>. AM.R079D
  is the Kurdistan Educational Seismic Observatory's own Raspberry Shake.
  Only this one Shake is shown, and nothing is redistributed: each browser
  or phone fetches its data from Raspberry Shake directly, and nothing is
  stored on Bumelerze's servers.
- **Displayed in-app:** every station shows its credit ("Data: Iraqi Seismic
  Observatory via EarthScope", "Data: Kandilli Observatory (KOERI) via EIDA",
  "Data: GEOFON (GFZ)", "Data: Kurdistan Educational Seismic Observatory via
  Raspberry Shake, S.A.", ...); the Raspberry Shake also shows "Hosted by
  Tishk International University".

## 7. Engineer's handbook data

### Iraqi Seismic Code values

- **ISC-2017** (the code in force): the design PGA zonation and the Ss and S1
  maps, digitised by the project from the code's Figures 2-2/1(a), (b) and (c)
  (`src/features/handbook/data/isc2017-zones.json`, `pga-zones.json`), plus
  the code's tables used by the design-spectrum calculator (Table 2-2/1 for
  Fa and Fv, Table 3-2/1 for structural systems).
- **ISC-2025** (published by IMOS, not yet in force): the 79 published
  district values and the Ss zonation map
  (`isc2025-districts.json`, `isc2025-ss-zones.json`), interpolated between
  districts (`isc2025-surface.json`).
- **Built by:** `scripts/build_handbook_data.py`, `build_isc2017_hazard.py` and
  `build_isc2025_hazard.py` in `bumelerze-engine`.
- **Terms:** no licence text accompanies the code documents. The handbook
  reproduces numeric design values with the code named on every result, and
  does not reproduce the code text.

### Other handbook data

- **Vs30 grid** (`vs30-grid.json`): its own citation is the SRTM30_PLUS
  topography, <https://topex.ucsd.edu/pub/srtm30_plus/>.
- **Soil and site points** (`soil-points.json`): the project's own Sulaimani
  soil and site investigation, 2024 (Peshawa L. Hasan, DAAD-Iraq / KISC field
  campaign).

## 8. Exposure data behind the damage estimates

The damage estimates shown with a shakemap (the risk summary that
`bumelerze-engine` publishes alongside a product) rest on this exposure data:

Building-type estimates come from Bumelerze's own field surveys in Iraq and
the Kurdistan Region, with the GEM Global Exposure Model as a reference where
the surveys do not reach.

- **Citation:** Yepes-Estrada C., Calderón A., Costa C., Crowley H., Dabbeek
  J., Hoyos M., Martins L., Paul N., Rao A., Silva V. (2023). Global Building
  Exposure Model for Earthquake Risk Assessment. _Earthquake Spectra_ 39(4).
  <https://doi.org/10.1177/87552930231194048>.

### GFZ OpenBuildingMap (building footprints)

- **What it is:** the building footprints the damage estimates count and
  classify ("Buildings in the shaken area", the damage-grade bar, damage by
  building class). `bumelerze-engine` reads the Iraq tiles of the 2025
  release, which merge OpenStreetMap buildings with machine-learned
  footprints.
- **Citation:** Schorlemmer D. et al. (2025). OpenBuildingMap building
  footprints. GFZ Data Services. <https://doi.org/10.5880/GFZ.LKUT.2025.002>.
- **Terms:** **Open Database License (ODbL) 1.0**, share-alike; contains
  OpenStreetMap data © OpenStreetMap contributors.
- **Required attribution:** © OpenStreetMap contributors, and OpenBuildingMap.
- **Displayed in-app:** one line under the damage estimate on Event Detail
  (`RiskSection`) and on the two Event hub damage slides (Impact at a glance,
  when it shows building damage, and Damage by building class):
  "Building data: GFZ OpenBuildingMap, © OpenStreetMap contributors (ODbL)"
  (`eventDetail.risk.buildingCredit`). It sits on the slide itself, so a
  screenshot keeps it. The Atlas PDF report carries the full source list.

### WorldPop and JRC Global Human Settlement Layer (population)

- **What it is:** the people counts shown with a damage estimate ("People by
  shaking level", or "People in the shaken area" on older products).
  `bumelerze-engine` takes the number of people per ~100 m grid square from
  WorldPop (Iraq 2025, scaled to the 2024 census) and places them in
  buildings with the JRC Global Human Settlement Layer (settlement classes
  GHS-SMOD and built-up surface GHS-BUILT-S).
- **Citations:** Bondarenko M. et al. (2025). Constrained estimates of
  2015-2030 total number of people per grid square, R2025A v1. WorldPop,
  University of Southampton. <https://doi.org/10.5258/SOTON/WP00839>.
  Schiavina M., Melchiorri M., Pesaresi M. (2023). GHS-SMOD R2023A.
  European Commission, Joint Research Centre.
  <https://doi.org/10.2905/A0DF7A6F-49DE-46EA-9BDE-563437A6E2BA>.
- **Terms:** both **CC BY 4.0**.
- **Displayed in-app:** "Population: WorldPop and JRC GHS (CC BY 4.0)"
  (`eventDetail.risk.populationCredit`) under the damage estimate on Event
  Detail, and on the Event hub's Impact at a glance when it shows people
  only. When that slide shows both donuts it carries one line for both
  sources instead (`eventHub.impact.dataCredit`): "Data: OpenBuildingMap,
  © OpenStreetMap contributors (ODbL); WorldPop, JRC GHS (CC BY 4.0)".

## 9. Scientific models and software

### OpenQuake Engine

- **Provider:** GEM Foundation. Pinned at `openquake.engine==3.26.2`.
- **Licence:** **AGPL-3.0-or-later** (confirmed from the installed
  distribution's own metadata: `License-Expression: AGPL-3.0-or-later`).
- This is why the engine is AGPL. See [`LICENSING.md`](LICENSING.md) and the
  `bumelerze-engine` repository's own README.

### Ground-motion models (used as OpenQuake hazardlib GSIM classes)

Chiou and Youngs (2014); Akkar et al. (2014, Rjb); Boore et al. (2014); Kale et
al. (2015, Iran). These are published equations from the scientific literature,
implemented in OpenQuake. Cite the papers; the implementations come under
OpenQuake's licence. The selection and weighting are documented in
`shake_service/config.py` in the `bumelerze-engine` repository.

### Flinn-Engdahl regionalisation (event naming)

- **Use:** the far-field name of an event is the Flinn-Engdahl region that
  contains its epicentre, looked up on-device from the coordinates
  (`src/features/geo/fe-region.ts`), then translated
  (`src/features/geo/data/fe-region-translations.ts`). This is why the World
  and Significant views no longer show USGS's bearing-format sentences.
- **Data:** the F-E 1995 revision, 757 regions: Flinn, Engdahl and Hill (1974,
  BSSA 64) and Young, Presgrave, Aichele, Wiens and Flinn (1996, PEPI 96,
  223-297). The names and the 1-degree grid come from the tables distributed
  by USGS/NEIC (`names.asc`, `quadsidx.asc`, `{ne,nw,se,sw}sect.asc`), built into
  `fe-regions.generated.ts` by `scripts/build-fe-regions.mjs`. The generated
  lookup agrees with the ObsPy reference implementation on 73,000 USGS M4.5+
  epicentres and a 40,000-point global sweep.
- **Terms:** the region numbers and names are a scientific standard also
  published by EMSC, ISC and GEOFON; the tables are USGS-distributed and
  USGS-authored data is in the U.S. Public Domain. **[VERIFY]** no licence
  text accompanies the table files themselves (the copies used here came from
  ObsPy's data directory); confirm with USGS/NEIC before the next store
  submission.
- **Translations:** Bumelerze's own, machine-drafted, pending native-speaker
  review.

### Intensity conversion and conditioning

- GMICE: Zanini and Hofer (2019) for EMS display, Worden et al. (2012) for MMI
  validation (`shake_service/gmice.py`).
- MVN conditioning: Engler et al. (2022) (`shake_service/mvn.py`).
- Magnitude conversion: Scordilis (2006) (`shake_service/magnitude.py`).
- Distance conversion: `ps2ff` (`shake_service/distances.py`).

These are published methods, implemented here from their papers. Each module's
docstring records the provenance and any deliberate divergence.

### Intensity scales

- **IMS-25** is the intensity scale used throughout, and the felt-report
  artwork follows its illustrated scale; the reference material is held with
  the commissioned artwork package outside this repository.
- **[VERIFY]** Reproduction terms for the IMS-25 reference material itself have
  not been checked. The Bumelerze illustrations are original work commissioned
  for this app (see
  [`assets/artwork/LICENSE-ARTWORK.md`](assets/artwork/LICENSE-ARTWORK.md)),
  not copies of the scale's own figures, but the reference material's status
  should be confirmed.

## 10. Fonts and icons

- **Vazirmatn** (`assets/fonts/`, and `website/fonts/` for the website): the
  Arabic-script typeface for Sorani and Arabic. **SIL Open Font License 1.1**,
  © 2015 The Vazirmatn Project Authors; the licence ships beside the fonts
  (`OFL-Vazirmatn.txt`).
- **Ionicons** (via `@expo/vector-icons`): **MIT**, © Ionic. The web build
  ships a subset with only the icons the app uses
  (`assets/fonts/web/Ionicons-subset.ttf`, built by
  `scripts/build-web-icon-font.py`); iOS and Android use the full font.

## 11. Third-party software dependencies

Not data, but part of the same accounting.

**JavaScript / TypeScript** (1,290 packages in `package-lock.json`, direct and
transitive, including the optional platform-specific binaries that only install
on matching machines), by licence:

| Licence                                  | Packages |
| ---------------------------------------- | -------- |
| MIT                                      | 1,055    |
| ISC                                      | 82       |
| Apache-2.0                               | 43       |
| BSD-3-Clause                             | 31       |
| BSD-2-Clause                             | 26       |
| MPL-2.0                                  | 12       |
| LGPL-3.0 / LGPL-3.0-or-later             | 11       |
| BlueOak-1.0.0                            | 8        |
| Apache-2.0 AND LGPL-3.0-or-later         | 3        |
| Dual MIT / CC0-1.0                       | 3        |
| Python-2.0                               | 2        |
| Dual MIT / Apache-2.0                    | 2        |
| Unlicense                                | 2        |
| 0BSD                                     | 2        |
| MIT AND Apache-2.0                       | 1        |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1        |
| CC-BY-4.0                                | 1        |
| CC0-1.0                                  | 1        |
| Dual MIT / GPL-3.0-or-later              | 1        |
| Dual BSD-3-Clause / GPL-2.0              | 1        |
| MIT AND Zlib                             | 1        |
| Dual Unlicense / Apache-2.0              | 1        |

Of the 59 direct dependencies in `package.json`, 55 are MIT, 2 are Apache-2.0
(`typescript`, `sharp`), one is BSD-2-Clause (`@mapbox/mapbox-gl-rtl-text`),
and one is BSD-3-Clause (`maplibre-gl`). All are permissive. No copyleft
licence appears among the direct dependencies. The weak-copyleft entries in the
transitive set are the platform binaries of `sharp` (libvips, LGPL; a build-time
image tool, not shipped in the app) and of `lightningcss` (MPL-2.0, a build
tool), plus `oregondsp` (LGPL-3.0), a signal-processing library that
`seisplotjs` brings into the live-station waveform view. The dual-licensed
packages are used under their permissive option.

**Python** (`requirements.txt` in the `bumelerze-engine` repository, 60 pinned
packages): the
scientific stack is predominantly BSD-3-Clause (numpy, scipy, pandas,
scikit-image, numba, matplotlib's own PSF-style licence, shapely, h5py) and MIT,
with GDAL/fiona/pyogrio under MIT-style terms, Django under BSD-3-Clause, and
**openquake.engine under AGPL-3.0-or-later**, which is the only copyleft
dependency and the one that determines that repository's licence. Each package
ships its own licence text in its installed distribution.

## 12. Data the app collects itself

Felt reports, their approximate location, optional photos, and the aggregated
intensity cells derived from them are **not covered by any licence in this
repository**. They are personal data contributed by users, and their handling is
governed by the privacy policy at <https://bumelerze.com/privacy.html>.

Aggregated community intensity (area-level cells, never single reports) is
displayed in the app, but it is not released as a dataset. If it is released
in future, its terms will be stated here.

---

## Corrections

If you hold rights in any source listed here and something is wrong, misattributed,
or used beyond its terms, please write to <hello@bumelerze.com>. It will be fixed
or removed.
