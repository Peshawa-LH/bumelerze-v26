#!/usr/bin/env node
/**
 * Bumelerze brand-asset regeneration script.
 *
 * Single source of truth for the app's visual identity: the owner's
 * finished logo package at
 * `assets/Bumelerze-App-Visual-Assets/08-Logo_Package/` (README.md there:
 * "SVG files are the source of truth") — a two-peak Zagros mountain profile
 * flowing into a seismic pulse, ending in a gold endpoint dot. This script
 * reads that package's master SVGs and design tokens directly (no
 * hand-copied hex, no hand-copied path data) and rasterizes every Expo
 * asset deterministically with `sharp`. No image-generation model is used
 * anywhere in this pipeline.
 *
 * This mark replaces the older "concentric rings" placeholder mark that
 * shipped before the logo package existed.
 *
 * Usage:
 *   export PATH="/opt/homebrew/bin:$PATH"   # ensure node/npm are on PATH
 *   node scripts/generate-assets.js         # or: npm run generate:assets
 *
 * Writes:
 *   assets/brand/adaptive-icon-mark.svg             (ivory+gold mark, safe-zone fitted, transparent)
 *   assets/brand/adaptive-icon-mark-monochrome.svg  (pure-white mark, safe-zone fitted, transparent)
 *   assets/images/icon.png                          1024x1024, OPAQUE (iOS)
 *   assets/images/android-icon-foreground.png       1024x1024, transparent
 *   assets/images/android-icon-monochrome.png       432x432,  transparent, pure white
 *   assets/images/notification-icon.png             96x96,    transparent, pure white
 *   assets/images/splash-icon.png                   512x512,  transparent (ivory + gold)
 *   assets/images/favicon.png                       48x48,    OPAQUE
 *
 * IMPORTANT — brand split (see assets/brand/README.md's "brand-red-vs-app-red
 * split" for the reasoning behind the choice below, not repeated here):
 * these outputs are BRAND surfaces (icon/splash/favicon) and use the logo
 * package's full palette (Signal Red field, Warm Ivory mark, Endpoint Gold
 * dot). The app's in-product semantic colors (src/theme/palette.ts —
 * intensityRamp, damageGradePalette, actionRed, status.danger) are a
 * SEPARATE, untouched palette; this script never reads or writes them.
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const LOGO_DIR = path.join(ROOT, "assets/Bumelerze-App-Visual-Assets/08-Logo_Package");
const LOGO_SVG_DIR = path.join(LOGO_DIR, "SVG");
const LOGO_TOKENS_FILE = path.join(LOGO_DIR, "Design-Tokens/bumelerze-colors.json");
const BRAND_DIR = path.join(ROOT, "assets/brand");
const IMAGES_DIR = path.join(ROOT, "assets/images");

// ---------------------------------------------------------------------------
// 1. Load the brand palette straight from the logo package's own machine-
//    readable tokens — the exact same file the website and app.config.ts
//    read, so there is exactly one place these six hex values live.
// ---------------------------------------------------------------------------

function loadLogoColors() {
  const json = JSON.parse(fs.readFileSync(LOGO_TOKENS_FILE, "utf8"));
  const pick = (key) => {
    const entry = json.colors[key];
    if (!entry || !entry.hex) {
      throw new Error(`${LOGO_TOKENS_FILE}: missing colors["${key}"].hex`);
    }
    return entry.hex;
  };
  return {
    signalRed: pick("signal-red"),
    warmIvory: pick("warm-ivory"),
    endpointGold: pick("endpoint-gold"),
    wordmarkInk: pick("wordmark-ink"),
    approvedNavy: pick("approved-navy"),
  };
}

// app.config.ts itself `fs.readFileSync`s this same JSON at config-eval
// time (Expo config files run under plain Node, so this is safe) and reads
// `android.adaptiveIcon.backgroundColor` / the splash `backgroundColor`s
// straight off it — see app.config.ts's `logoColors` — so there is no
// second hand-copied hex for this script to ever drift out of sync with.

// ---------------------------------------------------------------------------
// 2. Read the master symbol geometry (mountain + seismic-pulse silhouette +
//    gold endpoint dot) straight out of the package's own SVG — never
//    hand-copied path data. `bumelerze-symbol-color.svg` is the "symbol
//    only, transparent field" master (brand-guidelines.md's "Symbol only"
//    version); every mark-only asset below (Android adaptive-icon
//    foreground, monochrome icon, notification icon, splash) is this same
//    geometry, recolored and safe-zone-fitted.
// ---------------------------------------------------------------------------

function loadSymbolGeometry() {
  const file = path.join(LOGO_SVG_DIR, "bumelerze-symbol-color.svg");
  const svg = fs.readFileSync(file, "utf8");
  const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const symbolPath = svg.match(/<path d="([^"]+)"/);
  const dot = svg.match(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/);
  if (!viewBox || !symbolPath || !dot) {
    throw new Error(`${file}: could not extract viewBox/path/circle — source SVG shape changed.`);
  }
  return {
    vbWidth: Number(viewBox[1]),
    vbHeight: Number(viewBox[2]),
    pathD: symbolPath[1],
    dot: { cx: Number(dot[1]), cy: Number(dot[2]), r: Number(dot[3]) },
  };
}

// Renders the raw symbol (path + dot, transparent field, no recoloring) at
// a fixed high resolution and scans the alpha channel for its true pixel
// bounding box — measured, not eyeballed, so the safe-zone fit below is
// exact even if the source artwork's geometry changes in a future package
// version.
async function measureSymbolBBox(geometry) {
  const RENDER_WIDTH = 2320; // 4x the 580-unit viewBox width — plenty of precision
  const renderHeight = Math.round((RENDER_WIDTH / geometry.vbWidth) * geometry.vbHeight);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${RENDER_WIDTH}" height="${renderHeight}" viewBox="0 0 ${geometry.vbWidth} ${geometry.vbHeight}">
  <path d="${geometry.pathD}" fill="#000000"/>
  <circle cx="${geometry.dot.cx}" cy="${geometry.dot.cy}" r="${geometry.dot.r}" fill="#000000"/>
</svg>`;
  const { data, info } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let minX = info.width;
  let minY = info.height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const alpha = data[(y * info.width + x) * info.channels + 3];
      if (alpha > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    throw new Error("measureSymbolBBox: no opaque pixels found — geometry extraction is broken.");
  }

  const scale = RENDER_WIDTH / geometry.vbWidth;
  const toUnits = (px) => px / scale;
  const bbox = {
    minX: toUnits(minX),
    minY: toUnits(minY),
    maxX: toUnits(maxX),
    maxY: toUnits(maxY),
  };
  bbox.cx = (bbox.minX + bbox.maxX) / 2;
  bbox.cy = (bbox.minY + bbox.maxY) / 2;
  bbox.halfDiagonal = Math.hypot((bbox.maxX - bbox.minX) / 2, (bbox.maxY - bbox.minY) / 2);
  return bbox;
}

// ---------------------------------------------------------------------------
// 3. Build a "mark only" SVG (path + dot, arbitrary fill colors) centered
//    on an NxN canvas and scaled so its measured bounding-box half-diagonal
//    equals `targetRadius` — the general-purpose safe-zone-fit used by the
//    Android adaptive-icon foreground, the monochrome icon, the
//    notification icon, and the splash centerpiece.
// ---------------------------------------------------------------------------

function buildFittedSymbolSvg({ canvas, geometry, bbox, targetRadius, fillColor, dotColor }) {
  const scale = targetRadius / bbox.halfDiagonal;
  const tx = canvas / 2 - bbox.cx * scale;
  const ty = canvas / 2 - bbox.cy * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}">
  <!-- Bumelerze mark, fitted from assets/Bumelerze-App-Visual-Assets/08-Logo_Package/SVG/bumelerze-symbol-color.svg. -->
  <!-- GENERATED by scripts/generate-assets.js — do not hand-edit, re-run the script. -->
  <g transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${scale.toFixed(6)})">
    <path d="${geometry.pathD}" fill="${fillColor}"/>
    <circle cx="${geometry.dot.cx}" cy="${geometry.dot.cy}" r="${geometry.dot.r}" fill="${dotColor}"/>
  </g>
</svg>
`;
}

// Android's adaptive-icon safe zone: every launcher mask (circle, squircle,
// rounded square, teardrop...) guarantees only the central 66%-diameter
// circle stays visible — i.e. a radius of 33% of the canvas. Reused at
// whatever canvas size a given output needs (1024 for the foreground, 432
// for the monochrome icon, 96 for the notification icon) so the check is
// scale-invariant.
const SAFE_ZONE_RADIUS_FRACTION = 0.33;
// How much of that safe radius the mark's fitted half-diagonal should
// reach — large enough to read clearly, with real margin left over so nothing
// clips under any mask shape or during the OS's own icon-mask animation.
const SAFE_ZONE_FILL_FRACTION = 0.92;
// Splash has no launcher mask at all — give the mark more presence.
const SPLASH_FILL_FRACTION = 0.42;

// After rendering, re-measure the ACTUAL output pixels (not just trust the
// arithmetic above) and fail loudly if any opaque/anti-aliased pixel falls
// outside the safe-zone circle — the same "measure, don't assume" rigor as
// `measureSymbolBBox`.
async function assertWithinSafeZone(filePath, canvas) {
  const safeRadius = canvas * SAFE_ZONE_RADIUS_FRACTION;
  const center = canvas / 2;
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let maxDistance = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const alpha = data[(y * info.width + x) * info.channels + 3];
      if (alpha > 10) {
        const d = Math.hypot(x - center, y - center);
        if (d > maxDistance) maxDistance = d;
      }
    }
  }
  if (maxDistance > safeRadius) {
    throw new Error(
      `${filePath}: mark reaches ${maxDistance.toFixed(1)}px from center, ` +
        `outside the ${safeRadius.toFixed(1)}px Android adaptive-icon safe zone.`,
    );
  }
  console.log(
    `[assets]   safe-zone check OK: ${path.relative(ROOT, filePath)} reaches ${maxDistance.toFixed(1)}px, ` +
      `budget ${safeRadius.toFixed(1)}px (margin ${(safeRadius - maxDistance).toFixed(1)}px).`,
  );
}

// ---------------------------------------------------------------------------
// 4. Rasterize + validate (unchanged rigor from the previous pipeline).
// ---------------------------------------------------------------------------

async function renderOpaque(svgString, size, backgroundHex, destPath) {
  const buf = Buffer.from(svgString);
  const img = sharp(buf).resize(size, size).flatten({ background: backgroundHex }).png();
  await img.toFile(destPath);
  const meta = await sharp(destPath).metadata();
  if (meta.width !== size || meta.height !== size) {
    throw new Error(`${destPath}: expected ${size}x${size}, got ${meta.width}x${meta.height}`);
  }
  if (meta.hasAlpha) {
    throw new Error(`${destPath}: expected an OPAQUE PNG (no alpha channel) but hasAlpha=true.`);
  }
  console.log(`[assets] wrote ${path.relative(ROOT, destPath)} (${size}x${size}, opaque)`);
}

async function renderTransparent(svgString, size, destPath, { verifyPureWhite = false } = {}) {
  const buf = Buffer.from(svgString);
  await sharp(buf).resize(size, size).png().toFile(destPath);
  const meta = await sharp(destPath).metadata();
  if (meta.width !== size || meta.height !== size) {
    throw new Error(`${destPath}: expected ${size}x${size}, got ${meta.width}x${meta.height}`);
  }
  if (!meta.hasAlpha) {
    throw new Error(`${destPath}: expected a transparent PNG but hasAlpha=false.`);
  }
  if (verifyPureWhite) {
    await assertPureWhiteSilhouette(destPath);
  }
  console.log(`[assets] wrote ${path.relative(ROOT, destPath)} (${size}x${size}, transparent)`);
}

// Android notification icons (and the monochrome adaptive icon) must be a
// pure-white silhouette on a transparent field — any non-white opaque pixel
// renders as solid black/gray in the status bar (a previously-fixed
// store-rejection bug; this check exists so it can't regress). Checks every
// pixel.
async function assertPureWhiteSilhouette(filePath) {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a > 0 && (r !== 255 || g !== 255 || b !== 255)) {
      throw new Error(
        `${filePath}: non-white pixel found at RGBA(${r},${g},${b},${a}) — ` +
          "silhouette must be pure white on every opaque/anti-aliased pixel.",
      );
    }
  }
  console.log(`[assets]   verified pure-white silhouette: ${path.relative(ROOT, filePath)}`);
}

async function main() {
  const colors = loadLogoColors();
  console.log(
    `[assets] brand palette from ${path.relative(ROOT, LOGO_TOKENS_FILE)}: ` +
      `signalRed=${colors.signalRed} warmIvory=${colors.warmIvory} endpointGold=${colors.endpointGold} ` +
      `approvedNavy=${colors.approvedNavy}`,
  );

  const geometry = loadSymbolGeometry();
  const bbox = await measureSymbolBBox(geometry);
  console.log(
    `[assets] measured symbol bbox: ${bbox.minX.toFixed(1)},${bbox.minY.toFixed(1)} → ` +
      `${bbox.maxX.toFixed(1)},${bbox.maxY.toFixed(1)} (half-diagonal ${bbox.halfDiagonal.toFixed(1)})`,
  );

  fs.mkdirSync(BRAND_DIR, { recursive: true });
  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  // --- iOS / generic app icon — full-bleed master from the package itself,
  // rendered at exactly the size it was authored for (1024). MUST be
  // opaque: the App Store rejects an icon with an alpha channel.
  const squareIconSvg = fs.readFileSync(path.join(LOGO_SVG_DIR, "bumelerze-app-icon-square.svg"), "utf8");
  await renderOpaque(squareIconSvg, 1024, colors.signalRed, path.join(IMAGES_DIR, "icon.png"));

  // --- Web favicon — the package's dedicated favicon master, same
  // treatment (opaque, small).
  const faviconSvg = fs.readFileSync(path.join(LOGO_SVG_DIR, "bumelerze-favicon.svg"), "utf8");
  await renderOpaque(faviconSvg, 48, colors.signalRed, path.join(IMAGES_DIR, "favicon.png"));

  // --- Android adaptive-icon foreground — ivory mark + gold dot only,
  // transparent field, safe-zone fitted. `adaptiveIcon.backgroundColor` in
  // app.config.ts (signalRed) supplies the red field, so together this
  // reproduces the same look as the round/square icon under every launcher
  // mask shape.
  const foregroundSvg = buildFittedSymbolSvg({
    canvas: 1024,
    geometry,
    bbox,
    targetRadius: 1024 * SAFE_ZONE_RADIUS_FRACTION * SAFE_ZONE_FILL_FRACTION,
    fillColor: colors.warmIvory,
    dotColor: colors.endpointGold,
  });
  fs.writeFileSync(path.join(BRAND_DIR, "adaptive-icon-mark.svg"), foregroundSvg);
  const foregroundPath = path.join(IMAGES_DIR, "android-icon-foreground.png");
  await renderTransparent(foregroundSvg, 1024, foregroundPath);
  await assertWithinSafeZone(foregroundPath, 1024);

  // --- Android themed/monochrome adaptive icon (Android 13+) — same
  // safe-zone fit, pure white (mark AND dot — the OS tints this layer
  // itself, so no color survives here regardless).
  const monochromeSvgAt = (canvas) =>
    buildFittedSymbolSvg({
      canvas,
      geometry,
      bbox,
      targetRadius: canvas * SAFE_ZONE_RADIUS_FRACTION * SAFE_ZONE_FILL_FRACTION,
      fillColor: "#FFFFFF",
      dotColor: "#FFFFFF",
    });
  const monochromeSvg1024 = monochromeSvgAt(1024);
  fs.writeFileSync(path.join(BRAND_DIR, "adaptive-icon-mark-monochrome.svg"), monochromeSvg1024);
  const monochromePath = path.join(IMAGES_DIR, "android-icon-monochrome.png");
  await renderTransparent(monochromeSvgAt(432), 432, monochromePath, { verifyPureWhite: true });
  await assertWithinSafeZone(monochromePath, 432);

  // --- Android status-bar notification icon — pure white silhouette,
  // small. Same fitted geometry as the monochrome icon, different canvas.
  const notificationPath = path.join(IMAGES_DIR, "notification-icon.png");
  await renderTransparent(monochromeSvgAt(96), 96, notificationPath, { verifyPureWhite: true });
  await assertWithinSafeZone(notificationPath, 96);

  // --- Splash centerpiece — ivory mark + gold dot (no launcher-mask
  // constraint, so a larger fill fraction than the adaptive-icon layers).
  // Composited at runtime over expo-splash-screen's backgroundColor: Signal
  // Red for the light splash, Approved Navy for the dark splash — both
  // chosen in brand-guidelines.md specifically as backgrounds the ivory
  // mark reads clearly against ("Reversed logo: use the ivory version on
  // navy or another sufficiently dark background"), so one asset serves
  // both variants.
  const splashSvg = buildFittedSymbolSvg({
    canvas: 512,
    geometry,
    bbox,
    targetRadius: 512 * SPLASH_FILL_FRACTION,
    fillColor: colors.warmIvory,
    dotColor: colors.endpointGold,
  });
  await renderTransparent(splashSvg, 512, path.join(IMAGES_DIR, "splash-icon.png"));

  console.log("[assets] done.");
}

main().catch((err) => {
  console.error("[assets] FAILED:", err.message);
  process.exit(1);
});
