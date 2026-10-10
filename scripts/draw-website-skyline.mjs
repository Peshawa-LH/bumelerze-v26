#!/usr/bin/env node
// Draws website-src/partials/svg/skyline.svg: the skyline above the site
// footer. Flat silhouettes in three layers, each a class so CSS can tint it
// (far / mid / near, all fill="currentColor" by default):
//   far   Zagros ridges
//   mid   foothills, rising on the right into a steep Hawraman mountain
//   near  the Erbil citadel on its mound, and a stepped Hawraman village
//         climbing the mountain: flat-roofed stone houses stacked so one
//         roof is the yard of the house above, small square windows,
//         rooftop water tanks, a minaret at the foot of the slope.
// Deterministic (seeded), so re-running gives the same file.
//
//   node scripts/draw-website-skyline.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "website-src", "partials", "svg", "skyline.svg");

const FAR =
  "M-10 152L-10 52 0 58 10 67 20 75 30 78 40 84 50 85 60 82 70 81 80 77 90 76 100 75 110 79 120 80 130 84 140 88 150 90 160 91 170 93 180 90 190 92 200 95 210 100 220 102 230 109 240 112 250 115 260 117 270 116 280 118 290 115 300 115 310 111 320 109 330 111 340 109 350 107 360 102 370 100 380 93 390 86 400 76 410 68 420 62 430 58 440 59 450 61 460 66 470 69 480 71 490 71 500 71 510 70 520 66 530 65 540 67 550 71 560 74 570 79 580 79 590 79 600 78 610 75 620 68 630 65 640 68 650 68 660 76 670 84 680 91 690 96 700 101 710 106 720 106 730 110 740 109 750 112 760 112 770 114 780 117 790 116 800 118 810 119 820 116 830 114 840 109 850 102 860 96 870 93 880 91 890 87 900 88 910 84 920 82 930 80 940 75 950 70 960 67 970 66 980 68 990 72 1000 75 1010 80 1020 82 1030 80 1040 79 1050 73 1060 65 1070 61 1080 58 1090 59 1100 60 1110 62 1120 68 1130 69 1140 71 1150 73 1160 72 1170 73 1180 76 1190 83 1200 89 1210 97 1220 107 1230 113 1240 114 1250 115 1260 117 1270 116 1280 115 1290 115 1300 114 1310 114 1320 113 1330 112 1340 112 1350 110 1360 106 1370 103 1380 95 1390 88 1400 85 1410 82 1420 80 1430 84 1440 87 1450 89 1460 89 1470 91 1480 87 1490 83 1500 77 1510 75 1520 71 1530 73 1540 73 1550 72 1560 71 1570 70 1580 66 1590 60 1600 52 1610 48L1610 152Z";
const CITADEL =
  "M332 152C368 148 368 110 392 96L392 81L414 81L414 84L428 84L428 84L458 84L458 74L460 74L460 46L457 46L457 42L460 42L464 30L468 42L471 42L471 46L468 46L468 74L472 74L472 84L490 84L490 84L516 84L516 77L537 77L537 60L537 55L542.1 55L542.1 60L547.2 60L547.2 55L552.3 55L552.3 60L557.4 60L557.4 55L562.6 55L562.6 60L567.7 60L567.7 55L572.8 55L572.8 60L577.9 60L577.9 55L583 55L583 60L583 84L613 84L613 84L643 84L643 84L669 84L669 74L683 74L683 79L701 79L701 84L728 84L728 96C752 110 752 148 788 152ZM396 86h4v5h-4ZM406 86h4v5h-4ZM432 89h4v5h-4ZM450 89h4v5h-4ZM476 89h4v5h-4ZM482 89h4v5h-4ZM494 89h4v5h-4ZM508 89h4v5h-4ZM520 82h4v5h-4ZM529 82h4v5h-4ZM617 89h4v5h-4ZM635 89h4v5h-4ZM687 84h4v5h-4ZM693 84h4v5h-4ZM705 89h4v5h-4ZM720 89h4v5h-4ZM552 94V80A8 8 0 0 1 568 80V94L569 94L590 152L530 152L551 94Z";
const LEFT_HILLS = [
  [-10, 132],
  [0, 136],
  [10, 138],
  [20, 140],
  [30, 142],
  [40, 145],
  [50, 146],
  [60, 147],
  [70, 146],
  [80, 144],
  [90, 141],
  [100, 141],
  [110, 143],
  [120, 143],
  [130, 143],
  [140, 143],
  [150, 142],
  [160, 142],
  [170, 142],
  [180, 142],
  [190, 142],
  [200, 139],
  [210, 133],
  [220, 125],
  [230, 116],
  [240, 112],
  [250, 112],
  [260, 114],
  [270, 114],
  [280, 114],
  [290, 115],
  [300, 119],
  [310, 127],
  [320, 134],
  [330, 139],
  [340, 142],
  [350, 142],
  [360, 142],
  [370, 141],
  [380, 142],
  [390, 144],
  [400, 144],
  [410, 144],
  [420, 142],
  [430, 142],
  [440, 141],
  [450, 143],
  [460, 147],
  [470, 147],
  [480, 146],
  [490, 145],
  [500, 141],
  [510, 139],
  [520, 136],
  [530, 133],
  [540, 129],
  [550, 124],
  [560, 116],
  [570, 108],
  [580, 105],
  [590, 110],
  [600, 118],
  [610, 125],
  [620, 128],
  [630, 130],
  [640, 130],
  [650, 134],
  [660, 137],
  [670, 140],
  [680, 142],
  [690, 141],
  [700, 140],
  [710, 137],
  [720, 138],
  [730, 141],
  [740, 144],
  [750, 146],
  [760, 145],
  [770, 145],
  [780, 146],
  [790, 145],
  [800, 147],
  [810, 147],
  [820, 145],
  [830, 142],
  [840, 137],
  [850, 128],
  [860, 123],
];

let seed = 7;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const r1 = (n) => Math.round(n * 10) / 10;

// mid: foothills, then the mountain (base 880, peak 1450) and its far side.
const BASE = 152;
const slope = (x) => BASE - (x - 880) * 0.25; // the village's mountain face
const mid = [[-10, BASE], ...LEFT_HILLS];
for (let x = 870; x <= 1450; x += 10) {
  const y = x < 880 ? 121 : Math.min(121, slope(x) - 8 - rand() * 5);
  mid.push([x, r1(y)]);
}
for (let x = 1460; x <= 1610; x += 10)
  mid.push([x, r1(18 + (x - 1450) * 0.32 + rand() * 4)]);
mid.push([1610, BASE]);
const midPath = "M" + mid.map(([x, y]) => `${x} ${y}`).join("L") + "Z";

// near: the village. Houses are clockwise rectangles, windows and doors
// anticlockwise ones, so with the nonzero rule each opening is a hole.
const cw = (x, y, w, h) => `M${r1(x)} ${r1(y)}h${r1(w)}v${r1(h)}h${r1(-w)}Z`;
const ccw = (x, y, w, h) => `M${r1(x)} ${r1(y)}v${r1(h)}h${r1(w)}v${r1(-h)}Z`;
const parts = [];
const ROW = 14;
for (let k = 0; k < 7; k++) {
  const a = 860 + 56 * k;
  const b = a + 150 - (k > 4 ? 30 : 0);
  const nextA = 860 + 56 * (k + 1);
  const yBottom = BASE - k * ROW;
  // the terrace wall the row stands on, so the houses read as one block
  parts.push(cw(a, yBottom - 3, b - a - 8, 3));
  let x = a;
  while (x < b - 12) {
    const w = 18 + Math.floor(rand() * 13);
    const h = ROW;
    const top = yBottom - h;
    parts.push(cw(x, top, Math.min(w, b - x), h));
    // parapet lip
    parts.push(cw(x - 0.8, top - 1.4, Math.min(w, b - x) + 1.6, 1.4));
    // small square windows, sometimes a door
    const nWin = w > 24 ? 2 : 1;
    for (let i = 0; i < nWin; i++) parts.push(ccw(x + 4 + i * 9, top + 4, 3.6, 3.6));
    if (rand() < 0.3 && k === 0) parts.push(ccw(x + w - 8, top + 5, 4, h - 5));
    // a water tank on roofs left open as the terrace of the row above
    if (x + w < nextA && rand() < 0.6) {
      const tx = x + 3 + rand() * (w - 10);
      parts.push(cw(tx, top - 8, 6, 6.6));
      parts.push(cw(tx + 0.8, top - 1.4, 0.9, 0.1));
    }
    x += w + 2 + Math.floor(rand() * 3);
  }
}
// minaret and a small mosque at the foot of the slope
parts.push(cw(838, 76, 6, BASE - 76));
parts.push(cw(834.5, 96, 13, 3));
parts.push(cw(836.5, 70, 9, 6));
parts.push("M836.5 70L841 58L845.5 70Z");
parts.push(cw(812, 126, 26, BASE - 126));
parts.push("M814 126a11 9 0 0 1 22 0Z");
parts.push(ccw(822, 136, 6, 16));
const village = parts.join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 160" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false"><path class="far" fill="currentColor" fill-opacity=".22" d="${FAR}"/><path class="mid" fill="currentColor" fill-opacity=".42" d="${midPath}"/><path class="near" fill="currentColor" fill-rule="evenodd" d="${CITADEL}"/><path class="near" fill="currentColor" d="${village}"/><rect class="near" fill="currentColor" x="0" y="152" width="1600" height="8"/></svg>\n`;
fs.writeFileSync(OUT, svg);
console.log(`${path.relative(ROOT, OUT)}: ${(svg.length / 1024).toFixed(1)} KB`);
