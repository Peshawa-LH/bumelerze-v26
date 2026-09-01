/**
 * Five-pointed star geometry — the epicenter marker (owner: "epicenter
 * star, not a too-big circle"), shared between the SVG renderer
 * (`ShakeMapViewSvg.tsx`, a `react-native-svg` `<Polygon points=...>`) and
 * the MapLibre renderer (`ShakeMapView.web.tsx`, a raw inline `<svg>`
 * string handed to a DOM `maplibre.Marker` element) — one shape, one
 * formula, so the two can never draw a visibly different star.
 */

/** `(x, y)` vertices of a 5-point star centered at `(cx, cy)`, alternating
 * outer/inner radius, starting straight up — the same construction every
 * 5-point star icon uses. Returned as raw pairs (not a pre-joined SVG
 * `points` string) so each caller can format them for its own target
 * (`react-native-svg`'s `points` attribute vs. a hand-built `<polygon
 * points="...">` string). */
export function starVertices(
  cx: number,
  cy: number,
  outerRadius: number,
): readonly (readonly [number, number])[] {
  const innerRadius = outerRadius * 0.4;
  const points: [number, number][] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    // Start pointing straight up (-90deg), then step 36deg (360/10) per
    // point so 5 outer + 5 inner points interleave evenly.
    const angle = (Math.PI / 180) * (i * 36 - 90);
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}

/** `starVertices` joined into an SVG `points="x,y x,y ..."` attribute
 * value — what `react-native-svg`'s `<Polygon points>` prop wants. */
export function starPointsAttribute(cx: number, cy: number, outerRadius: number): string {
  return starVertices(cx, cy, outerRadius)
    .map(([x, y]) => `${x},${y}`)
    .join(" ");
}

/**
 * A tiny standalone `<svg>...</svg>` markup string for the MapLibre DOM
 * marker (`ShakeMapView.web.tsx`) — centered star at `(size/2, size/2)`
 * with `outerRadius` scaled to the requested pixel `size`, filled
 * `fillColor` with a `strokeColor` halo (same contrast trick the SVG
 * renderer's own halo stroke uses). Plain string interpolation, not JSX —
 * this becomes a DOM element's `innerHTML`, never React-rendered.
 */
export function buildStarMarkerSvgMarkup(
  size: number,
  fillColor: string,
  strokeColor: string,
): string {
  const center = size / 2;
  const outerRadius = size * 0.42;
  const points = starPointsAttribute(center, center, outerRadius);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}">` +
    `<polygon points="${points}" fill="${fillColor}" stroke="${strokeColor}" ` +
    `stroke-width="1.5" stroke-linejoin="round" /></svg>`
  );
}
