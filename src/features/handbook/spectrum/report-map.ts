import { ISC2025_SS_ZONES } from "../data";

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
const ZONE_FILL: Record<string, string> = {
  I: "#b2b2b2",
  II: "#e9ffbe",
  III: "#ffff00",
  IV: "#ffaa00",
  V: "#ff0000",
};

/** Drawn from strongest to weakest so a band never hides a stronger one. */
const DRAW_ORDER = ["I", "II", "III", "IV", "V"] as const;

const WIDTH = 320;
const HEIGHT = 380;
const PAD = 6;

export function buildReportMapSvg(lat: number, lon: number): string {
  const rings = ISC2025_SS_ZONES;
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

  const legend = DRAW_ORDER.map(
    (label, i) =>
      `<rect x="${8 + i * 30}" y="${HEIGHT - 20}" width="22" height="10" fill="${ZONE_FILL[label]}" stroke="#666" stroke-width="0.4"/>` +
      `<text x="${19 + i * 30}" y="${HEIGHT - 24}" font-size="7" text-anchor="middle" fill="#333">${label}</text>`,
  ).join("");

  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg" role="img">
<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#fff" stroke="#111" stroke-width="1"/>
${paths.join("")}
${marker}
${legend}
</svg>`;
}
