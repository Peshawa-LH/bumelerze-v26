import { HAZARD_SOURCE_LABEL, type Hazard } from "@/features/building/assessment";

import { VS30_GRID } from "./data";
import { readHazard } from "./hazard-source";
import { siteClassFromVs30 } from "./site-class";
import { sampleVs30 } from "./vs30-sample";

/** Design PGA, zone, Vs30 and site class at a point, from the engineering
 * handbook's bundled data. Null fields outside the mapped area. Used by the
 * automatic assessment of a tagged home (`building/assess-at-point.ts`). */
export function siteHazard(lat: number, lon: number): Hazard {
  const reading = readHazard("isc2025", lat, lon);
  const vs30 = sampleVs30(VS30_GRID, lat, lon);
  return {
    pga_g: reading.values ? reading.values.pga2475 : null,
    zone: reading.zoneLabel,
    vs30: vs30 === null ? null : Math.round(vs30),
    site_class: vs30 === null ? null : siteClassFromVs30(vs30).ec8,
    source: HAZARD_SOURCE_LABEL,
  };
}
