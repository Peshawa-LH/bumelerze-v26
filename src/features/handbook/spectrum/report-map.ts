import { ISC2017_ZONES, ISC2025_SS_ZONES } from "../data";
import type { HazardSourceId } from "../hazard-source";

/**
 * A locator map for the printed report, as inline SVG.
 *
 * WHY NOT A STREET MAP
 * --------------------
 * A tile-server basemap would need a network request from a detached print
 * window, an API key, and a race against the print dialog — an image that
 * has not loaded when printing starts leaves a blank box on the page. It
 * would also be the wrong map: on a seismic design report, what matters is
 * which hazard zone the site sits in, not which road runs past it.
 *
 * So this draws the ISC-2025 `Ss` zone bands the app already ships as
 * vectors, in the same five colours as the official IMOS sheet, with the
 * site marked. Offline, no key, prints crisply at any size, and it lets a
 * checker see at a glance that the marker really is in the zone the report
 * claims.
 */

/** The official IMOS-2025 sheet's own fills, so the printed locator reads
 * as the same map an engineer has on their desk. */
const ZONE_FILL_2025: Record<string, string> = {
  I: "#b2b2b2",
  II: "#e9ffbe",
  III: "#ffff00",
  IV: "#ffaa00",
  V: "#ff0000",
};

/** ISC-2017's ten `Ss` bands, sampled from the legend swatches printed in
 * Figure 2-2/1(a) itself rather than approximated, for the same reason as
 * the 2025 palette: the locator should read as the figure on the desk. */
const ZONE_FILL_2017: Record<string, string> = {
  I: "#c7c7c7",
  II: "#dcdcdc",
  III: "#dfeaec",
  IV: "#f9fdcd",
  V: "#f5d661",
  VI: "#f6a74f",
  VII: "#f8684d",
  VIII: "#ff5f33",
  IX: "#f74917",
  X: "#cb1a17",
};

/** Drawn weakest first so a band never hides a stronger one. */
const DRAW_ORDER_2025 = ["I", "II", "III", "IV", "V"] as const;
const DRAW_ORDER_2017 = [
  "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
] as const;

interface LocatorBand {
  zone: string;
  ring: readonly (readonly [number, number])[];
}

/** The selected source's own Ss zonation. The report must show the map the
 * values were read off; showing 2025's bands beside 2017's numbers would
 * be a figure that contradicts its own table. */
function locatorBands(source: HazardSourceId): {
  bands: LocatorBand[];
  fill: Record<string, string>;
  order: readonly string[];
} {
  if (source === "isc2017") {
    return {
      bands: ISC2017_ZONES.quantities.ss.map((b) => ({ zone: b.zone, ring: b.ring })),
      fill: ZONE_FILL_2017,
      order: DRAW_ORDER_2017,
    };
  }
  return {
    bands: ISC2025_SS_ZONES.map((z) => ({ zone: z.zone, ring: z.ring })),
    fill: ZONE_FILL_2025,
    order: DRAW_ORDER_2025,
  };
}

const WIDTH = 320;
/* Iraq is very nearly square once longitude is corrected for latitude, so a
 * 380-tall frame left ~33 px of empty paper above and below the country.
 * 345 hugs it, with room for the legend strip along the bottom. */
const HEIGHT = 345;
const PAD = 6;

/** Width over height, so the report can size this figure to match the
 * spectrum plot's height instead of letting a portrait map tower over it. */
export const REPORT_MAP_ASPECT = WIDTH / HEIGHT;

export function buildReportMapSvg(
  lat: number,
  lon: number,
  source: HazardSourceId = "isc2025",
): string {
  const { bands: rings, fill: ZONE_FILL, order: DRAW_ORDER } = locatorBands(source);
  if (rings.length === 0) {
    return "";
  }

  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const zone of rings) {
    for (const [x, y] of zone.ring) {
      if (x < minLon) minLon = x;
      if (x > maxLon) maxLon = x;
      if (y < minLat) minLat = y;
      if (y > maxLat) maxLat = y;
    }
  }

  // Equirectangular with a cos(lat) correction on longitude. Over one
  // country that is visually indistinguishable from a proper projection and
  // needs no projection library in a print document.
  const midLat = (minLat + maxLat) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const spanX = (maxLon - minLon) * kx;
  const spanY = maxLat - minLat;
  const scale = Math.min((WIDTH - 2 * PAD) / spanX, (HEIGHT - 2 * PAD) / spanY);
  const offsetX = (WIDTH - spanX * scale) / 2;
  const offsetY = (HEIGHT - spanY * scale) / 2;

  const toX = (l: number) => offsetX + (l - minLon) * kx * scale;
  // SVG y grows downward, latitude grows upward.
  const toY = (l: number) => offsetY + (maxLat - l) * scale;

  const paths: string[] = [];
  for (const label of DRAW_ORDER) {
    for (const zone of rings) {
      if (zone.zone !== label) continue;
      const d = zone.ring
        .map(([x, y], i) => `${i === 0 ? "M" : "L"}${toX(x).toFixed(1)} ${toY(y).toFixed(1)}`)
        .join(" ");
      paths.push(
        `<path d="${d}Z" fill="${ZONE_FILL[label] ?? "#ddd"}" stroke="#666" stroke-width="0.4"/>`,
      );
    }
  }

  const mx = toX(lon);
  const my = toY(lat);
  const inFrame = mx >= 0 && mx <= WIDTH && my >= 0 && my <= HEIGHT;

  const marker = inFrame
    ? `<g>
<line x1="${mx.toFixed(1)}" y1="${(my - 11).toFixed(1)}" x2="${mx.toFixed(1)}" y2="${(my + 11).toFixed(1)}" stroke="#000" stroke-width="1.2"/>
<line x1="${(mx - 11).toFixed(1)}" y1="${my.toFixed(1)}" x2="${(mx + 11).toFixed(1)}" y2="${my.toFixed(1)}" stroke="#000" stroke-width="1.2"/>
<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="4.5" fill="none" stroke="#000" stroke-width="1.6"/>
<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="1.6" fill="#000"/>
</g>`
    : "";

  // Spaced by however many bands the source has: 2025 prints five, 2017
  // prints ten, and a fixed 30 px step ran the tenth swatch off the frame.
  const step = (WIDTH - 16) / DRAW_ORDER.length;
  const swatch = Math.min(22, step - 4);
  const legend = DRAW_ORDER.map(
    (label, i) =>
      `<rect x="${(8 + i * step).toFixed(1)}" y="${HEIGHT - 20}" width="${swatch.toFixed(1)}" height="10" fill="${ZONE_FILL[label]}" stroke="#666" stroke-width="0.4"/>` +
      `<text x="${(8 + i * step + swatch / 2).toFixed(1)}" y="${HEIGHT - 24}" font-size="7" text-anchor="middle" fill="#333">${label}</text>`,
  ).join("");

  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg" role="img">
<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#fff" stroke="#111" stroke-width="1"/>
${paths.join("")}
${marker}
${legend}
</svg>`;
}
