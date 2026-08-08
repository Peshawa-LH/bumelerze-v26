import type { SiteClassResult } from "./types";

/**
 * EC8 (Eurocode 8, EN 1998-1:2004 Table 3.1) ground-type boundaries derived
 * from Vs30 alone. Types A-D are Vs30-only thresholds; E and the two
 * special soil types (S1/S2) require additional criteria (surface layer
 * thickness, plasticity, organic content) this handbook has no data for —
 * a bundled Vs30 grid can only ever place a point in A-D, never E/S1/S2,
 * which is a real (documented, not silent) limitation of a coordinate-only
 * lookup tool.
 */
function ec8ClassFromVs30(vs30MS: number): string {
  if (vs30MS > 800) return "A";
  if (vs30MS >= 360) return "B";
  if (vs30MS >= 180) return "C";
  return "D";
}

/**
 * NEHRP (ASCE 7-16 Table 20.3-1) site-class boundaries derived from Vs30
 * alone. Class F requires a site-specific response analysis this tool
 * can't perform — same "can only place A-E" limitation as EC8 above.
 */
function nehrpClassFromVs30(vs30MS: number): string {
  if (vs30MS > 1500) return "A";
  if (vs30MS > 760) return "B";
  if (vs30MS > 360) return "C";
  if (vs30MS > 180) return "D";
  return "E";
}

/** Derives both site-classification systems from a single sampled Vs30
 * value (m/s) — never independently estimated, always a function of the
 * same Vs30 number shown in the Vs30 row above it (spec-v1.md §7: "site
 * class derived from Vs30"). */
export function siteClassFromVs30(vs30MS: number): SiteClassResult {
  return { ec8: ec8ClassFromVs30(vs30MS), nehrp: nehrpClassFromVs30(vs30MS) };
}
