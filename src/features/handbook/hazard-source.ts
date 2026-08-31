import { lookupIsc2017 } from "./isc2017";
import { lookupIsc2025 } from "./isc2025";
import type { Isc2025Result } from "./types";

/**
 * Which published hazard map the design values come from.
 *
 * This is a SECOND axis, orthogonal to the spectrum method in
 * `spectrum/methods.ts`. The method decides whose equations turn mapped
 * values into a curve; the source decides which map the values are read
 * off. Every combination is valid, because both sources publish all three
 * quantities the methods consume.
 *
 * WHY THE CHOICE EXISTS AT ALL
 * ----------------------------
 * ISC-2017 is the code in force. ISC-2025 is published but not yet in
 * force, and practice in Iraq is split on which to design to. Serving only
 * one would be taking a side in that split on the engineer's behalf, on a
 * question the app is not entitled to answer for them.
 *
 * WHAT THEY ARE NOT
 * -----------------
 * They are not interchangeable, and the difference is not vintage alone:
 *
 * - 2025 publishes 79 district values, interpolated to the queried point,
 *   so it answers "the value here" and two nearby sites differ smoothly.
 * - 2017 publishes coloured bands, so it answers "the band here" and every
 *   site inside a band reads the same number.
 *
 * Both are at 2% probability of exceedance in 50 years (a 2475-year return
 * period), so they ARE the same quantity and can be compared directly.
 * `resolution` is carried through to the UI and the report so a reader is
 * never left to assume a band value was interpolated.
 */

export type HazardSourceId = "isc2025" | "isc2017";

export interface HazardSource {
  id: HazardSourceId;
  returnPeriodYears: 2475;
  /** `interpolated` — a value computed for the queried point.
   *  `banded` — the value the map prints for the band the point is in. */
  resolution: "interpolated" | "banded";
  /** Whether this edition is the one legally in force. */
  inForce: boolean;
}

export const HAZARD_SOURCES: readonly HazardSource[] = [
  { id: "isc2025", returnPeriodYears: 2475, resolution: "interpolated", inForce: false },
  { id: "isc2017", returnPeriodYears: 2475, resolution: "banded", inForce: true },
];

/**
 * ISC-2025, the owner's call (2026-09-01).
 *
 * Note this is NOT the edition in force. It is the better data — point
 * values rather than bands — and it is what the handbook has always
 * served, so it stays the default and 2017 is one tap away. The report
 * names the source either way, so nothing rests on the reader remembering
 * which was selected.
 */
export const DEFAULT_HAZARD_SOURCE: HazardSourceId = "isc2025";

export function hazardSource(id: HazardSourceId): HazardSource {
  const found = HAZARD_SOURCES.find((s) => s.id === id);
  if (!found) {
    throw new Error(`unknown hazard source: ${id}`);
  }
  return found;
}

export interface HazardValues {
  ss2475: number;
  s12475: number;
  pga2475: number;
}

export interface HazardReading {
  source: HazardSource;
  values: HazardValues | null;
  /**
   * What Eurocode 8 should use for `ag`, and at which return period.
   *
   * EC8's own reference is the 475-year hazard, which neither Iraqi
   * edition publishes. 2025 publishes a 1000-year PGA, which is the
   * closest either offers, so that is what it feeds. 2017 publishes ONLY
   * 2475, so selecting it moves EC8 further from its own basis — and the
   * UI has to say so rather than quietly handing a 2475-year `ag` to a
   * standard written around 475.
   */
  ec8Ag: { valueG: number; returnPeriodYears: number } | null;
  /** The band label to show beside the values: the Ss band in both
   * sources, so the two read the same way. Null off the map. */
  zoneLabel: string | null;
}

/**
 * The 2025 reading, from a lookup the caller already performed.
 *
 * The handbook screen resolves ISC-2025 once for the whole page (its
 * result table shows the district, the zone and the values), so the
 * spectrum section must not resolve it a SECOND time from the bundled
 * data: two lookups of the same coordinate is wasted work, and if the
 * caller ever passes a result from anywhere else the two would silently
 * disagree. The 2017 path has no such prior lookup and does resolve.
 */
export function readingFromIsc2025(found: Isc2025Result): HazardReading {
  return {
    source: hazardSource("isc2025"),
    values: found.values
      ? {
          ss2475: found.values.ss2475,
          s12475: found.values.s12475,
          pga2475: found.values.pga2475,
        }
      : null,
    ec8Ag: found.values ? { valueG: found.values.pga1000, returnPeriodYears: 1000 } : null,
    zoneLabel: found.zone?.zone ?? null,
  };
}

/** A coordinate and a source in, the mapped design values out, without the
 * caller knowing which extraction pipeline produced them. */
export function readHazard(id: HazardSourceId, lat: number, lon: number): HazardReading {
  const source = hazardSource(id);
  if (id === "isc2017") {
    const found = lookupIsc2017(lat, lon);
    return {
      source,
      values: found.values,
      ec8Ag: found.values ? { valueG: found.values.pga2475, returnPeriodYears: 2475 } : null,
      zoneLabel: found.ssBand?.zone ?? null,
    };
  }
  const found = lookupIsc2025(lat, lon);
  return {
    source,
    values: found.values
      ? {
          ss2475: found.values.ss2475,
          s12475: found.values.s12475,
          pga2475: found.values.pga2475,
        }
      : null,
    ec8Ag: found.values ? { valueG: found.values.pga1000, returnPeriodYears: 1000 } : null,
    zoneLabel: found.zone?.zone ?? null,
  };
}
