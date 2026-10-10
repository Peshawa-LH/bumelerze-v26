#!/usr/bin/env node
// Draws website-src/partials/svg/skyline.svg, the strip above the site
// footer: open Zagros ridges, then a small town on the plain, then a
// Hawraman-style village climbing a hill. Flat silhouettes in three layers,
// each a class so CSS can tint it per theme (all fill="currentColor"):
//   far   distant ridges              mid   nearer ridges
//   near  the hill, the town and the village (and the 8-unit ground band)
// Every building's body runs down into the ground, the slope or the roof
// below it, so nothing floats. Town houses use an 11-unit storey; village
// houses are slightly smaller, as they are further away. Seeded, so
// re-running gives the same file.
//
//   node scripts/draw-website-skyline.mjs                  write the site's skyline
//   node scripts/draw-website-skyline.mjs --variant 2      mirrored layout
//   node scripts/draw-website-skyline.mjs --out <file.svg> write elsewhere

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outArg = args.indexOf("--out");
const OUT =
  outArg !== -1
    ? path.resolve(args[outArg + 1])
    : path.join(ROOT, "website-src", "partials", "svg", "skyline.svg");
const MIRROR = args.includes("--variant") && args[args.indexOf("--variant") + 1] === "2";

const W = 1600;
const BASE = 152;
const XS = [];
for (let x = -10; x <= 1610; x += 10) XS.push(x);

/** Small seeded PRNG (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (R, list) => list[Math.floor(R() * list.length)];
const r1 = (v) => String(Math.round(v * 10) / 10);
const cw = (x, y, w, h) => `M${r1(x)} ${r1(y)}h${r1(w)}v${r1(h)}h${r1(-w)}Z`;
const ccw = (x, y, w, h) => `M${r1(x)} ${r1(y)}v${r1(h)}h${r1(w)}v${r1(-h)}Z`;

/** A natural ridge line: midpoint displacement, end-to-end drift removed,
 * lightly smoothed, then scaled into [lo, hi]. */
function ridge(seed, lo, hi, rough, smooth) {
  const R = rng(seed);
  let pts = [lo + R() * (hi - lo), lo + R() * (hi - lo)];
  let amp = hi - lo;
  while (pts.length < XS.length) {
    const next = [];
    for (let i = 0; i < pts.length - 1; i++) {
      next.push(pts[i], (pts[i] + pts[i + 1]) / 2 + (R() * 2 - 1) * (amp / 2));
    }
    next.push(pts[pts.length - 1]);
    pts = next;
    amp *= rough;
  }
  pts = pts.slice(0, XS.length);
  const n = pts.length;
  const first = pts[0];
  const last = pts[n - 1];
  pts = pts.map((v, i) => v - (first + ((last - first) * i) / (n - 1)));
  for (let k = 0; k < smooth; k++) {
    pts = pts.map((v, i) =>
      i === 0 || i === n - 1 ? v : (pts[i - 1] + 2 * v + pts[i + 1]) / 4,
    );
  }
  const mn = Math.min(...pts);
  const mx = Math.max(...pts);
  return pts.map((v) => lo + ((v - mn) / (mx - mn)) * (hi - lo));
}
const ridgePath = (ys) =>
  "M-10 154L" + XS.map((x, i) => `${x} ${r1(ys[i])}`).join("L") + "L1610 154Z";

/** A water tank on two short legs, standing on the roof. */
function tank(x, roof) {
  return (
    cw(x, roof - 2.2, 0.9, 2.2) +
    cw(x + 4.1, roof - 2.2, 0.9, 2.2) +
    `M${r1(x - 0.3)} ${r1(roof - 2.2)}v-4.4q0-1.1 2.8-1.1t2.8 1.1v4.4Z`
  );
}
function dish(x, roof) {
  return (
    cw(x, roof - 3, 0.8, 3) +
    `M${r1(x - 2.4)} ${r1(roof - 3.2)}a2.6 1.5 -30 0 1 4.6 -2.6Z`
  );
}
/** Flat-roofed house; the body continues `sink` units below `ground`.
 * Windows are anticlockwise holes in the clockwise body. */
function house(R, x, w, h, ground, { win = 3, sink = 6, tanks = 0.55, dishes = 0 } = {}) {
  const top = ground - h;
  const p = [cw(x, top, w, h + sink), cw(x - 0.6, top - 1.2, w + 1.2, 1.2)];
  const storeys = Math.max(1, Math.round(h / 11));
  for (let s = 0; s < storeys; s++) {
    const wy = top + 3.2 + s * 11;
    if (wy + win > ground - 2) break;
    const n = Math.max(1, Math.floor((w - 4) / (win < 3 ? 8 : 14)));
    const gap = (w - n * win) / (n + 1);
    for (let i = 0; i < n; i++) p.push(ccw(x + gap + i * (win + gap), wy, win, win));
  }
  if (R() < tanks) p.push(tank(x + 1.5 + R() * Math.max(0.5, w - 8), top - 1.2));
  if (R() < dishes) p.push(dish(x + w - 3, top - 1.2));
  return p.join("");
}
function minaret(x, h) {
  const t = BASE - h;
  return (
    cw(x, t, 4.5, h + 4) +
    cw(x - 2.5, t + 16, 9.5, 2.2) +
    cw(x - 1, t - 4, 6.5, 4) +
    `M${r1(x - 1)} ${r1(t - 4)}L${r1(x + 2.25)} ${r1(t - 14)}L${r1(x + 5.5)} ${r1(t - 4)}Z`
  );
}
function mosque(x) {
  return (
    cw(x, BASE - 18, 28, 22) +
    `M${r1(x + 3)} ${r1(BASE - 18)}a11 9 0 0 1 22 0Z` +
    ccw(x + 11, BASE - 10, 6, 10)
  );
}
function tree(x, h) {
  return (
    cw(x - 0.7, BASE - h + 5, 1.4, h - 1) +
    `M${r1(x - 5)} ${r1(BASE - h + 6)}a5 5.5 0 1 1 10 0a5 5.5 0 1 1 -10 0Z`
  );
}

// ---- layers
const far = ridge(21, 40, 104, 0.7, 2);
const mid = ridge(8, 80, 130, 0.68, 2);

// The village hill: a rounded shoulder near the right end. A low foothill
// at the far left carries a few scattered houses.
const HILL_X = 1330;
const hill = (x) => BASE - 58 * Math.exp(-(((x - HILL_X) / 230) ** 2));
const foothill = (x) => BASE - 16 * Math.exp(-(((x - 40) / 110) ** 2));
const ground = (x) => Math.min(BASE, hill(x), foothill(x));
const hillPath =
  "M-10 154L" + XS.map((x) => `${x} ${r1(ground(x))}`).join("L") + "L1610 154Z";

const R = rng(7);
const near = [];

/** Houses on the flat plain between a and b: varied widths and heights,
 * small irregular gaps (sometimes a tree in a wider one). */
function plain(a, b, { tall = 0.35, gaps = [0, 1, 2, 3, 6] } = {}) {
  let x = a;
  while (x < b - 20) {
    const w = pick(R, [22, 26, 28, 32, 36, 40]);
    const roll = R();
    const h =
      roll < tall
        ? pick(R, [22, 23, 24])
        : roll < tall + 0.06
          ? 33
          : pick(R, [11, 12, 13, 14]);
    near.push(house(R, x, Math.min(w, b - x), h, BASE, { dishes: 0.3 }));
    let gap = pick(R, gaps);
    if (gap >= 6 && R() < 0.5) {
      near.push(tree(x + w + 6, pick(R, [12, 14, 16])));
      gap = 12;
    }
    x += w + gap;
  }
}

/** Houses climbing a slope: each cut into the ground (its downhill corner
 * on the slope), some set back on the roof terrace of the one below. */
function slope(groundFn, a, b, { stack = 0.45 } = {}) {
  let x = a;
  while (x < b) {
    const w = pick(R, [13, 15, 17, 19]);
    const h = pick(R, [9, 10, 11, 12]);
    const g0 = groundFn(x);
    const g1 = groundFn(x + w);
    const g = Math.max(g0, g1); // the lower corner
    near.push(
      house(R, x, w, h, g, { win: 2.4, sink: Math.abs(g0 - g1) + 3, tanks: 0.5 }),
    );
    if (R() < stack && BASE - g > 14) {
      near.push(
        house(R, x + 4, w - 5, pick(R, [8, 9, 10]), g - h - 1.2, {
          win: 2.4,
          sink: 1.5,
          tanks: 0.5,
        }),
      );
    }
    x += w + pick(R, [1, 2, 3]);
  }
}

// Far left: a few scattered houses on the foothill.
slope(foothill, 6, 40, { stack: 0 });
slope(foothill, 70, 108, { stack: 0 });
// Left neighbourhood, with a small minaret further off.
plain(150, 300);
near.push(minaret(306, 44));
plain(318, 420);
near.push(tree(432, 14));
// The town around the mosque: longer and denser.
plain(452, 690, { gaps: [0, 1, 2, 3] });
near.push(mosque(694), minaret(724, 66));
plain(732, 1000, { gaps: [0, 1, 2, 3, 6] });
// The village runs down the hill until it nearly meets the town.
slope(hill, 1018, 1322);

const layer = (cls, d, op) =>
  `<path class="${cls}" fill="currentColor"${op ? ` fill-opacity="${op}"` : ""} d="${d}"/>`;
const content =
  layer("far", ridgePath(far), ".22") +
  layer("mid", ridgePath(mid), ".42") +
  layer("near", hillPath) +
  layer("near", near.join("")) +
  `<rect class="near" fill="currentColor" x="0" y="152" width="${W}" height="8"/>`;
const body = MIRROR ? `<g transform="matrix(-1 0 0 1 ${W} 0)">${content}</g>` : content;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 160" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">${body}</svg>\n`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, svg);
console.log(`${path.relative(ROOT, OUT)}: ${(svg.length / 1024).toFixed(1)} KB`);
