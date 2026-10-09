#!/usr/bin/env node
// Prepares the images the website ships (website/img/**) from their masters.
// Run by hand when a master changes, then commit the output; the page build
// (scripts/build-website.mjs) never touches images.
//
//   node scripts/build-website-assets.mjs [--external <dir>]
//
// Repo-internal masters (always processed): the felt-intensity cartoons
// 01-06 and the six safety illustrations, from assets/artwork/.
//
// External masters (only with --external): the site figures and the app
// screenshots, produced outside this repository. <dir> must contain
// figures/ (cast-all.webp, cast-family.webp, catalog-map-*.webp,
// shakemap-*.webp, og-image.png, seismic-line.svg, skyline.svg, vc-bar.svg)
// and screens/ (<screen>-<lang>.webp, 780x1688). The SVGs are copied into
// website-src/partials/svg/ because the build inlines them.
//
// Marketing rules baked in here, not left to whoever runs this:
//  - felt cartoons: ONLY levels 01-06 (no damage/destruction levels);
//  - safety: only correct-advice images, never a safety-dont-* file.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "website", "img");
const LANGS = ["en", "ckb", "kmr", "ar"];

/** Screens the site shows, by phone-frame slot. Swap a name here (and in
 * website-src/pages/index.html) to show a different app screen. */
export const SITE_SCREENS = ["home", "home-dark", "safe", "hub"];

export const FELT_LEVELS = ["01", "02", "03", "04", "05", "06"];

export const SAFETY_IMAGES = [
  "safety-secure-water-tank",
  "safety-secure-gas-cylinder",
  "safety-cover-head-neck",
  "safety-drop-cover-hold",
  "safety-emergency-kit",
  "safety-family-plan",
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function webp(src, dest, width, quality = 74, height) {
  ensureDir(path.dirname(dest));
  const resizeOpts = height ? { width, height, fit: "cover" } : { width };
  await sharp(src).resize(resizeOpts).webp({ quality, effort: 6 }).toFile(dest);
  const { size } = fs.statSync(dest);
  console.log(`${path.relative(ROOT, dest)}  ${(size / 1024).toFixed(1)} KB`);
}

async function internal() {
  for (const level of FELT_LEVELS) {
    await webp(
      path.join(ROOT, "assets/artwork/felt", `level-${level}.webp`),
      path.join(OUT, "felt", `level-${level}.webp`),
      240,
      72,
    );
  }
  for (const name of SAFETY_IMAGES) {
    if (name.startsWith("safety-dont-")) {
      throw new Error(`${name}: "don't" images are never shown as advice`);
    }
    await webp(
      path.join(ROOT, "assets/artwork/safety", `${name}.webp`),
      path.join(OUT, "safety", `${name}.webp`),
      320,
      72,
    );
  }
}

async function external(dir) {
  const fig = (name) => path.join(dir, "figures", name);
  await webp(fig("cast-all.webp"), path.join(OUT, "cast-all-800.webp"), 800, 74);
  await webp(fig("cast-all.webp"), path.join(OUT, "cast-all-1400.webp"), 1400, 72);
  await webp(fig("cast-family.webp"), path.join(OUT, "cast-family.webp"), 600, 74);
  for (const theme of ["light", "dark"]) {
    // Already compressed at the right sizes upstream; copied as-is.
    for (const suffix of ["", "@2x"]) {
      const name = `catalog-map-${theme}${suffix}.webp`;
      ensureDir(OUT);
      fs.copyFileSync(fig(name), path.join(OUT, name));
    }
    await webp(
      fig(`shakemap-${theme}.webp`),
      path.join(OUT, `shakemap-${theme}.webp`),
      1000,
      80,
    );
  }
  fs.copyFileSync(fig("vc-bar.svg"), path.join(OUT, "vc-bar.svg"));
  // Open Graph image: JPEG for the widest crawler and messenger support.
  await sharp(fig("og-image.png"))
    .jpeg({ quality: 84, mozjpeg: true })
    .toFile(path.join(ROOT, "website", "og-image.jpg"));
  const svgDir = path.join(ROOT, "website-src", "partials", "svg");
  ensureDir(svgDir);
  for (const name of ["seismic-line.svg", "skyline.svg"]) {
    fs.copyFileSync(fig(name), path.join(svgDir, name));
  }
  for (const screen of SITE_SCREENS) {
    for (const lang of LANGS) {
      let src = path.join(dir, "screens", `${screen}-${lang}.webp`);
      if (!fs.existsSync(src)) {
        console.warn(`missing ${screen}-${lang}.webp, using the English screen`);
        src = path.join(dir, "screens", `${screen}-en.webp`);
      }
      await webp(src, path.join(OUT, "screens", `${screen}-${lang}.webp`), 540, 76);
    }
  }
}

const extIdx = process.argv.indexOf("--external");
await internal();
if (extIdx !== -1) {
  const dir = process.argv[extIdx + 1];
  if (!dir) throw new Error("--external needs a directory");
  await external(path.resolve(dir));
}
