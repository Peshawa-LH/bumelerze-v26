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
6. [Scientific models and software](#6-scientific-models-and-software)
7. [Third-party software dependencies](#7-third-party-software-dependencies)
8. [Data the app collects itself](#8-data-the-app-collects-itself)

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

## 2. The bundled regional catalog

`assets/catalog/bumelerze-catalog.sqlite` is a compiled catalog of about 21,000
events for Iraq and the Zagros margin (lat 28.5 to 39.5, lon 38.0 to 50.5),
merged from five source catalogs. The merge rules, per-source counts, and
data-quality caveats are in `regional-catalog/BUILD_REPORT.md` in the
`bumelerze-engine` repository, which builds this file.

The source catalogs themselves are not redistributed in this repository; only
the merged result is. Their individual terms:

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
  *Seismological Research Letters*, 88(3), 798 to 811,
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
  developments of the Middle East catalog", *Journal of Seismology*, 18,
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

The realistic resolutions, in rough order of preference: obtain written
permission from each rights holder; or offer the compiled catalog under
**CC BY-SA 4.0** instead, which would satisfy ISC-GEM and (if the re-release has
taken effect) EMME; or rebuild the catalog from the unrestricted sources only
and publish that subset under CC BY 4.0. Until one of those is done, the catalog
in this repository should be treated as bundled for use *in the app*, not as an
open dataset ready for redistribution.

This is flagged rather than quietly resolved because a wrong licence statement
on a dataset is worse than none.

## 4. Map data

### OpenFreeMap (default basemap)

- **Styles:** `https://tiles.openfreemap.org/styles/liberty` and `.../dark`.
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

### MapTiler (basemap when an API key is configured)

- **Styles:** `outdoor-v4` and `outdoor-v4-dark` via
  `https://api.maptiler.com/maps/<id>/style.json`.
- **Terms:** MapTiler Cloud terms of service, over OpenStreetMap data under
  ODbL.
- **Required attribution, on screen whenever the map is shown:** `© MapTiler`
  linking to <https://maptiler.com/copyright>, and `© OpenStreetMap contributors`
  linking to <https://openstreetmap.org/copyright>. MapTiler's style documents
  carry these, and MapLibre renders them through the same attribution control.
- **[VERIFY]** MapTiler's documentation states that **free-tier accounts must
  additionally display the MapTiler logo** linking to maptiler.com. The app does
  not currently render that logo. This needs to be checked against the account
  tier actually in use, and the logo added if the free tier applies.

### OpenStreetMap

- **Terms:** © OpenStreetMap contributors, data under the **Open Database
  License (ODbL) 1.0** (<https://www.openstreetmap.org/copyright>). ODbL applies
  to the *data*; map tiles rendered from it are subject to the tile provider's
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
  slope-based default and regional map insets", *Earthquake Spectra*, 36(3),
  1570 to 1584, <https://doi.org/10.1177/8755293020911137>. Underlying method:
  Wald and Allen (2007).
- **[VERIFY]** The file in use is the older ShakeMap-era build
  (`global_vs30_ca_waor_ut_jp_tw.grd`, with California, Washington/Oregon, Utah,
  Japan, and Taiwan insets) from the `usgs/earthquake-global_vs30` repository,
  not the current `global_vs30.grd` distribution. The older repository states
  only "Copyright © 2019 United States Geological Survey"; its licence file was
  not read during this review. Treat it as USGS public domain by default, but
  confirm, and consider moving to the current CC0-marked distribution.

## 6. Scientific models and software

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

### Intensity conversion and conditioning

- GMICE: Zanini and Hofer (2019) for EMS display, Worden et al. (2012) for MMI
  validation (`shake_service/gmice.py`).
- MVN conditioning: Engler et al. (2022) (`shake_service/mvn.py`).
- Magnitude conversion: Scordilis (2006) (`shake_service/magnitude.py`).
- Distance conversion: `ps2ff` (`shake_service/distances.py`).

These are published methods, implemented here from their papers. Each module's
docstring records the provenance and any deliberate divergence.

### Intensity scales

- **EMS-98**, the European Macroseismic Scale 1998 (Grunthal, ed.), is the
  intensity scale used throughout.
- **IMS-25** is the illustrated scale the felt-report artwork follows; the
  reference material is in `assets/Bumelerze-App-Visual-Assets/06-Reference/`.
- **[VERIFY]** Reproduction terms for the IMS-25 reference material itself have
  not been checked. The Bumelerze illustrations are original work commissioned
  for this app (see
  [`assets/Bumelerze-App-Visual-Assets/LICENSE-ARTWORK.md`](assets/Bumelerze-App-Visual-Assets/LICENSE-ARTWORK.md)),
  not copies of the scale's own figures, but the reference folder's status
  should be confirmed.

## 7. Third-party software dependencies

Not data, but part of the same accounting.

**JavaScript / TypeScript** (966 installed packages, direct and transitive, as
resolved by `package-lock.json`), by licence family:

| Licence                     | Packages |
| --------------------------- | -------- |
| MIT                         | ~828     |
| ISC                         | 45       |
| Apache-2.0                  | 29       |
| BSD-3-Clause                | 24       |
| BSD-2-Clause                | 22       |
| BlueOak-1.0.0               | 4        |
| Dual MIT / Apache-2.0       | 2        |
| MPL-2.0                     | 2        |
| Unlicense                   | 2        |
| 0BSD                        | 2        |
| MIT AND Apache-2.0          | 1        |
| LGPL-3.0-or-later           | 1        |
| CC-BY-4.0                   | 1        |
| CC0-1.0                     | 1        |
| Dual BSD-3-Clause / GPL-2.0 | 1        |
| Dual MIT / CC0-1.0          | 1        |

Of the direct dependencies in `package.json`, 51 are MIT, 2 are Apache-2.0
(`typescript`, `sharp`), one is BSD-2-Clause (`@mapbox/mapbox-gl-rtl-text`), and
one is BSD-3-Clause (`maplibre-gl`). All are permissive. No copyleft licence
appears among the direct dependencies, and the single LGPL and MPL entries in
the transitive set are file-level or weak copyleft that does not affect the
app's own licensing.

**Python** (`requirements.txt` in the `bumelerze-engine` repository, 57 pinned
packages): the
scientific stack is predominantly BSD-3-Clause (numpy, scipy, pandas,
scikit-image, numba, matplotlib's own PSF-style licence, shapely, h5py) and MIT,
with GDAL/fiona/pyogrio under MIT-style terms, Django under BSD-3-Clause, and
**openquake.engine under AGPL-3.0-or-later**, which is the only copyleft
dependency and the one that determines that repository's licence. Each package
ships its own licence text in its installed distribution.

## 8. Data the app collects itself

Felt reports, their approximate location, optional photos, and the aggregated
intensity cells derived from them are **not covered by any licence in this
repository**. They are personal data contributed by users, and their handling is
governed by the privacy policy at <https://bumelerze.com/privacy.html>.

Aggregate, non-identifying intensity products derived from those reports may be
published in future, at which point their terms will be stated here. Nothing is
published today.

---

## Corrections

If you hold rights in any source listed here and something is wrong, misattributed,
or used beyond its terms, please write to <hello@bumelerze.com>. It will be fixed
or removed.
