/**
 * Credits shown on the About screen. Every URL and licence here comes from
 * `DATA-SOURCES.md` (the project's own source-by-source accounting) and, for
 * the map credits, from the strings the map already carries
 * (`features/map/own-labels.ts`, `terrain.ts`, `attribution.ts`). The names of
 * agencies stay in Latin script in every language; the descriptive line under
 * each name is translated (`about.sources.<id>`).
 */

export interface AboutSource {
  /** Key under `about.sources` (label/value) and part of the row's testID. */
  id: string;
  /** Shown as-is in every language (an agency or project name). When absent
   * the row's label is translated (`about.sources.<id>.label`). */
  name?: string;
  icon: "pulse-outline" | "map-outline" | "layers-outline" | "library-outline";
  url: string;
}

export const DATA_SOURCES: readonly AboutSource[] = [
  {
    id: "usgs",
    name: "USGS",
    icon: "pulse-outline",
    url: "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits",
  },
  {
    id: "emsc",
    name: "EMSC",
    icon: "pulse-outline",
    url: "https://www.seismicportal.eu/terms.html",
  },
  {
    id: "geofon",
    name: "GEOFON",
    icon: "pulse-outline",
    url: "https://geofon.gfz.de/eqinfo/faq/",
  },
  {
    id: "isc",
    name: "ISC",
    icon: "pulse-outline",
    url: "https://www.isc.ac.uk/iscgem/",
  },
  {
    id: "catalogue",
    icon: "library-outline",
    url: "https://github.com/Peshawa-LH/bumelerze-v26/blob/main/DATA-SOURCES.md",
  },
];

export const MAP_SOURCES: readonly AboutSource[] = [
  {
    id: "osm",
    name: "OpenStreetMap",
    icon: "map-outline",
    url: "https://www.openstreetmap.org/copyright",
  },
  {
    id: "openfreemap",
    name: "OpenFreeMap",
    icon: "map-outline",
    url: "https://openfreemap.org/",
  },
  {
    id: "maptiler",
    name: "MapTiler",
    icon: "map-outline",
    url: "https://www.maptiler.com/copyright/",
  },
  {
    id: "terrain",
    icon: "map-outline",
    url: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
  },
  {
    id: "placeNames",
    icon: "map-outline",
    url: "https://www.openstreetmap.org/copyright",
  },
  {
    id: "layers",
    icon: "layers-outline",
    url: "https://github.com/Peshawa-LH/bumelerze-v26/blob/main/DATA-SOURCES.md",
  },
];

export const PRIVACY_POLICY_URL = "https://bumelerze.com/privacy.html";
export const SOURCE_CODE_URL = "https://github.com/Peshawa-LH/bumelerze-v26";
export const FONT_URL = "https://github.com/rastikerdar/vazirmatn";
export const FULL_SOURCES_URL =
  "https://github.com/Peshawa-LH/bumelerze-v26/blob/main/DATA-SOURCES.md";
