/**
 * The station symbol for MapLibre Native: the web's canvas triangle
 * (`StationsMap.web.tsx`'s `drawTriangle`: a filled triangle with a white
 * 3 px outline, 36 px, inset 4, drawn at pixel ratio 2) rasterised in plain
 * TypeScript and handed to the map as a PNG data URI. React Native has no
 * canvas; doing it here keeps the exact theme colour of every freshness
 * tier, in both colour schemes, without shipping a PNG per colour.
 *
 * Anti-aliased by distance to the outline, so the edges are as soft as the
 * canvas's. Pure and synchronous: 36 × 36 pixels, built once per colour.
 */

export const STATION_ICON_PX = 36;
const INSET = 4;
const STROKE_PX = 3;

type Vec = readonly [number, number];
const TRIANGLE: readonly Vec[] = [
  [STATION_ICON_PX / 2, INSET],
  [STATION_ICON_PX - INSET, STATION_ICON_PX - INSET],
  [INSET, STATION_ICON_PX - INSET],
];

function parseHexColor(hex: string): [number, number, number] {
  const value = hex.trim().replace(/^#/, "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value.slice(0, 6);
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n) || full.length !== 6) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function distanceToSegment(p: Vec, a: Vec, b: Vec): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / (abx * abx + aby * aby)),
  );
  const dx = p[0] - (a[0] + t * abx);
  const dy = p[1] - (a[1] + t * aby);
  return Math.sqrt(dx * dx + dy * dy);
}

function isInside(p: Vec): boolean {
  let sign = 0;
  for (let i = 0; i < 3; i += 1) {
    const a = TRIANGLE[i] as Vec;
    const b = TRIANGLE[(i + 1) % 3] as Vec;
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (cross !== 0) {
      if (sign === 0) sign = Math.sign(cross);
      else if (Math.sign(cross) !== sign) return false;
    }
  }
  return true;
}

/** Signed distance from `p` to the triangle's outline: negative inside. */
export function signedDistanceToTriangle(p: Vec): number {
  let d = Infinity;
  for (let i = 0; i < 3; i += 1) {
    d = Math.min(
      d,
      distanceToSegment(p, TRIANGLE[i] as Vec, TRIANGLE[(i + 1) % 3] as Vec),
    );
  }
  return isInside(p) ? -d : d;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** RGBA pixels, row by row: the outline (white) over the fill (`color`). */
export function rasterizeStationIcon(color: string): Uint8Array {
  const [r, g, b] = parseHexColor(color);
  const pixels = new Uint8Array(STATION_ICON_PX * STATION_ICON_PX * 4);
  for (let y = 0; y < STATION_ICON_PX; y += 1) {
    for (let x = 0; x < STATION_ICON_PX; x += 1) {
      const d = signedDistanceToTriangle([x + 0.5, y + 0.5]);
      const fill = clamp01(0.5 - d);
      const stroke = clamp01(0.5 - (Math.abs(d) - STROKE_PX / 2));
      const alpha = stroke + fill * (1 - stroke);
      const i = (y * STATION_ICON_PX + x) * 4;
      if (alpha <= 0) continue;
      const mix = (c: number) =>
        Math.round((255 * stroke + c * fill * (1 - stroke)) / alpha);
      pixels[i] = mix(r);
      pixels[i + 1] = mix(g);
      pixels[i + 2] = mix(b);
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

// --- PNG encoding (uncompressed deflate: tiny image, no zlib needed) -------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function chunk(type: string, data: Uint8Array): number[] {
  const typed = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i += 1) typed[i] = type.charCodeAt(i);
  typed.set(data, 4);
  return [...u32(data.length), ...typed, ...u32(crc32(typed))];
}

/** An RGBA image as PNG bytes (one stored deflate block, < 64 KB). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  const len = raw.length;
  const zlib = new Uint8Array(2 + 5 + len + 4);
  zlib.set([0x78, 0x01, 0x01, len & 255, len >>> 8, ~len & 255, (~len >>> 8) & 255]);
  zlib.set(raw, 7);
  zlib.set(u32(adler32(raw)), 7 + len);
  const header = new Uint8Array([...u32(width), ...u32(height), 8, 6, 0, 0, 0]);
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", header),
    ...chunk("IDAT", zlib),
    ...chunk("IEND", new Uint8Array(0)),
  ]);
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += BASE64[(n >> 18) & 63];
    out += BASE64[(n >> 12) & 63];
    out += b === undefined ? "=" : BASE64[(n >> 6) & 63];
    out += c === undefined ? "=" : BASE64[n & 63];
  }
  return out;
}

const cache = new Map<string, string>();

/** The station triangle in `color` as a `data:image/png` URI (cached). */
export function stationIconDataUri(color: string): string {
  const cached = cache.get(color);
  if (cached) return cached;
  const png = encodePng(STATION_ICON_PX, STATION_ICON_PX, rasterizeStationIcon(color));
  const uri = `data:image/png;base64,${toBase64(png)}`;
  cache.set(color, uri);
  return uri;
}
