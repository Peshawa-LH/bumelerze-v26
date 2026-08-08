/**
 * Bumelerze basemap fixture (map-presentation wave, 2026-08-08 — owner:
 * "the basemap is not there, it's just the radial maps"). Trimmed Natural
 * Earth admin-0 boundary lines + coastline, committed as a small JSON
 * fixture — provenance, source, and processing steps: `README.md` in this
 * folder.
 *
 * Same "generated, trusted, not runtime-validated" convention as
 * `atlas/index.ts` (that module's own doc comment: "GENERATED ... do not
 * hand-edit") — this fixture never comes from the network at render time,
 * only from this repo, so there's no zod schema here for the same reason
 * that module has none: the IO boundary this project's zod convention
 * guards against is external/runtime data, not a build-time-generated,
 * code-reviewed fixture checked into git.
 */
import type { LonLatBoundingBox } from "../projection";
import raw from "./basemap.trimmed.json";

/** One polyline: an ordered list of `[lon, lat]` points, same coordinate
 * convention as `ContourRing.points` (`types.ts`) — never assumed closed. */
export type BasemapLine = readonly (readonly [number, number])[];

interface BasemapFixtureShape {
  bbox: LonLatBoundingBox;
  borders: BasemapLine[];
  coastline: BasemapLine[];
}

const fixture = raw as unknown as BasemapFixtureShape;

/** The fixture's own coverage extent (`README.md`: lon 35..55, lat 25..45,
 * padded 2° during trimming) — `ShakeMapView` clips against the current
 * product's contour bbox, not this one, but tests use this to verify every
 * point stayed inside the source trim. */
export const BASEMAP_BBOX: LonLatBoundingBox = fixture.bbox;

/** Country border lines (Natural Earth `admin_0_boundary_lines_land`). */
export const BASEMAP_BORDERS: readonly BasemapLine[] = fixture.borders;

/** Coastline (Natural Earth `coastline`). */
export const BASEMAP_COASTLINE: readonly BasemapLine[] = fixture.coastline;
