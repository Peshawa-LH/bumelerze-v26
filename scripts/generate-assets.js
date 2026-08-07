#!/usr/bin/env node
/**
 * Bumelerze brand-asset regeneration script.
 *
 * Single source of truth for the app's visual identity: the "concentric
 * rings" epicenter mark (design-language.md §6, "Brand shake motif" /
 * "Map marker system"). Reads the CURRENT brand hue straight out of
 * `src/theme/palette.ts` (still flagged owner-review there — see
 * assets/brand/README.md) so the whole asset set regenerates from one
 * command the moment that hue is finalized. No image-generation model is
 * used anywhere in this pipeline: every pixel comes from the SVG paths
 * below, rasterized deterministically by `sharp` (Node bindings around
 * libvips/resvg).
 *
 * Usage:
 *   export PATH="/opt/homebrew/bin:$PATH"   # node/npm on PATH
 *   node scripts/generate-assets.js
 *
 * Writes:
 *   assets/brand/icon.svg                       (master mark, opaque field)
 *   assets/brand/mark.svg                        (mark only, transparent)
 *   assets/images/icon.png                       1024x1024, OPAQUE (iOS)
 *   assets/images/android-icon-foreground.png    1024x1024, transparent
 *   assets/images/android-icon-monochrome.png    432x432,  transparent, pure white
 *   assets/images/notification-icon.png          96x96,    transparent, pure white
 *   assets/images/splash-icon.png                512x512,  transparent
 *   assets/images/favicon.png                    48x48,    OPAQUE
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const PALETTE_FILE = path.join(ROOT, "src/theme/palette.ts");
const BRAND_DIR = path.join(ROOT, "assets/brand");
const IMAGES_DIR = path.join(ROOT, "assets/images");

// ---------------------------------------------------------------------------
// 1. Pull the brand hue straight from the theme tokens (no hand-copied hex).
// ---------------------------------------------------------------------------

function extractBrandColors() {
  const src = fs.readFileSync(PALETTE_FILE, "utf8");
  const brandBlock = src.match(/export const brand = \{([\s\S]*?)\} as const;/);
  if (!brandBlock) {
    throw new Error(
      `Could not find "export const brand = {...}" in ${PALETTE_FILE} — ` +
        "palette.ts shape changed, update the regex in generate-assets.js.",
    );
  }
  const light = brandBlock[1].match(/primaryLight:\s*"(#[0-9A-Fa-f]{6})"/);
  const dark = brandBlock[1].match(/primaryDark:\s*"(#[0-9A-Fa-f]{6})"/);
  if (!light || !dark) {
    throw new Error("Could not extract primaryLight/primaryDark hex from palette.ts brand block.");
  }
  return { primaryLight: light[1], primaryDark: dark[1] };
}

// ---------------------------------------------------------------------------
// 2. The mark itself: an off-center epicenter dot with four concentric
//    rings, radii/stroke-widths increasingly spaced and thinner outward
//    (attenuating wavefront). All geometry lives in a 1024x1024 canvas so
//    every raster size below is just "render this SVG at size N", never a
//    second-generation downsample.
//
//    Geometry is chosen so the WHOLE mark (dot + outer ring edge) sits
//    inside the Android adaptive-icon safe-zone circle: radius 338 centered
//    on (512, 512) (66% of a 108dp/1024px foreground canvas) — see the
//    containment check in `assertSafeZone()` below, which fails loudly if
//    anyone edits these numbers without re-checking.
// ---------------------------------------------------------------------------

const CANVAS = 1024;
const SAFE_ZONE_CENTER = { x: 512, y: 512 };
const SAFE_ZONE_RADIUS = CANVAS * 0.33; // 66% diameter -> 33% radius

const MARK = {
  cx: 452,
  cy: 464,
  dotRadius: 16,
  rings: [
    { r: 48, sw: 36 },
    { r: 104, sw: 29 },
    { r: 168, sw: 24 },
    { r: 238, sw: 21 },
  ],
};

// Icon-artwork legibility floor (task brief): no stroke thinner than 2% of
// canvas width.
const MIN_STROKE = CANVAS * 0.02;

function assertDesignConstraints() {
  for (const ring of MARK.rings) {
    if (ring.sw < MIN_STROKE) {
      throw new Error(
        `Ring stroke ${ring.sw}px is thinner than the 2% legibility floor (${MIN_STROKE}px).`,
      );
    }
  }
  const outer = MARK.rings[MARK.rings.length - 1];
  const offset = Math.hypot(MARK.cx - SAFE_ZONE_CENTER.x, MARK.cy - SAFE_ZONE_CENTER.y);
  const extent = offset + outer.r + outer.sw / 2;
  if (extent > SAFE_ZONE_RADIUS) {
    throw new Error(
      `Mark extends ${extent.toFixed(1)}px from safe-zone center, ` +
        `exceeding the ${SAFE_ZONE_RADIUS.toFixed(1)}px adaptive-icon safe zone. ` +
        "Shrink the offset or outer ring before regenerating.",
    );
  }
  console.log(
    `[assets] safe-zone check OK: mark extends ${extent.toFixed(1)}px, ` +
      `budget ${SAFE_ZONE_RADIUS.toFixed(1)}px ` +
      `(margin ${(SAFE_ZONE_RADIUS - extent).toFixed(1)}px).`,
  );
}

function markGroup(color) {
  const rings = MARK.rings
    .map(
      (ring) =>
        `  <circle cx="${MARK.cx}" cy="${MARK.cy}" r="${ring.r}" fill="none" ` +
        `stroke="${color}" stroke-width="${ring.sw}"/>`,
    )
    .join("\n");
  return `${rings}\n  <circle cx="${MARK.cx}" cy="${MARK.cy}" r="${MARK.dotRadius}" fill="${color}"/>`;
}

function buildIconSvg(fieldColor) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <!-- Bumelerze master mark: concentric-rings epicenter motif (design-language.md §6). -->
  <!-- GENERATED by scripts/generate-assets.js — do not hand-edit, re-run the script. -->
  <rect width="${CANVAS}" height="${CANVAS}" fill="${fieldColor}"/>
${markGroup("#FFFFFF")}
</svg>
`;
}

function buildMarkSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <!-- Bumelerze mark only, transparent field: adaptive-icon foreground, -->
  <!-- Android monochrome icon, notification silhouette, splash centerpiece. -->
  <!-- GENERATED by scripts/generate-assets.js — do not hand-edit, re-run the script. -->
${markGroup("#FFFFFF")}
</svg>
`;
}

// Renders `svgString` (whose root <svg> has width/height=CANVAS) directly at
// `size` pixels by swapping the root width/height before rasterizing, so
// resvg/libvips renders the vector paths natively at the target resolution
// instead of rasterizing once at 1024 and box-resampling down (softer).
function svgAtSize(svgString, size) {
  return svgString
    .replace(`width="${CANVAS}"`, `width="${size}"`)
    .replace(`height="${CANVAS}"`, `height="${size}"`);
}

// ---------------------------------------------------------------------------
// 3. Rasterize + validate.
// ---------------------------------------------------------------------------

async function renderOpaque(svgString, size, backgroundHex, destPath) {
  const buf = Buffer.from(svgAtSize(svgString, size));
  const img = sharp(buf).flatten({ background: backgroundHex }).png();
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
  const buf = Buffer.from(svgAtSize(svgString, size));
  await sharp(buf).png().toFile(destPath);
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
// renders as solid black/gray in the status bar. Check every pixel.
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
  const { primaryLight, primaryDark } = extractBrandColors();
  console.log(`[assets] brand hue from palette.ts: primaryLight=${primaryLight} primaryDark=${primaryDark}`);
  console.log("[assets] NOTE: this hue is still flagged owner-review (design-language.md §3) —");
  console.log("[assets] rerun this script after it's finalized, that's the only step required.");

  assertDesignConstraints();

  fs.mkdirSync(BRAND_DIR, { recursive: true });
  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const iconSvg = buildIconSvg(primaryLight);
  const markSvg = buildMarkSvg();

  fs.writeFileSync(path.join(BRAND_DIR, "icon.svg"), iconSvg);
  fs.writeFileSync(path.join(BRAND_DIR, "mark.svg"), markSvg);
  console.log("[assets] wrote assets/brand/icon.svg and assets/brand/mark.svg");

  // iOS/app icon — MUST be opaque (App Store rejects alpha in the icon).
  await renderOpaque(iconSvg, 1024, primaryLight, path.join(IMAGES_DIR, "icon.png"));

  // Android adaptive-icon foreground — transparent, mark only, safe-zone verified above.
  await renderTransparent(markSvg, 1024, path.join(IMAGES_DIR, "android-icon-foreground.png"));

  // Android themed/monochrome adaptive icon (Android 13+) — pure white silhouette.
  await renderTransparent(markSvg, 432, path.join(IMAGES_DIR, "android-icon-monochrome.png"), {
    verifyPureWhite: true,
  });

  // Android status-bar notification icon — pure white silhouette, small.
  await renderTransparent(markSvg, 96, path.join(IMAGES_DIR, "notification-icon.png"), {
    verifyPureWhite: true,
  });

  // Splash centerpiece — transparent, composited over app.config.ts's
  // splash backgroundColor (brand hue, light + dark variants).
  await renderTransparent(markSvg, 512, path.join(IMAGES_DIR, "splash-icon.png"));

  // Web favicon — small, opaque (browser tabs), same composition as the app icon.
  await renderOpaque(iconSvg, 48, primaryLight, path.join(IMAGES_DIR, "favicon.png"));

  console.log("[assets] done.");
}

main().catch((err) => {
  console.error("[assets] FAILED:", err.message);
  process.exit(1);
});
