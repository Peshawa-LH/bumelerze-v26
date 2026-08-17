#!/usr/bin/env node
/**
 * Copies maplibre-gl's worker-thread bundle (and the shared chunk it
 * imports), PLUS the RTL text-shaping plugin script, from node_modules into
 * public/, so Expo's web build serves them as real static files in BOTH
 * environments:
 *   - `npx expo start --web` (the dev server serves the public/ directory
 *     verbatim, at the origin root);
 *   - the production export (public/ is copied byte-for-byte into the
 *     export output root, so it lands next to index.html under whatever
 *     base path the export is served from, e.g. Netlify's /app/).
 *
 * Why this exists at all: maplibre-gl 6.x has no bundler-friendly
 * "workerClass"/CSP-worker option — that pattern existed in older
 * mapbox-gl-derived versions and was removed (verified by reading the
 * installed package's own source: `src/util/web_worker.ts` only exposes
 * `config.WORKER_URL` / `setWorkerUrl()`, and always instantiates a real
 * `new Worker(url, { type: "module" })`). So the worker's JS has to exist
 * as an actual served file at a URL Metro never manages — Metro only knows
 * about modules reached through static/dynamic `import`, never about a
 * runtime string passed to the real browser `Worker` constructor.
 *
 * `maplibre-gl-worker.mjs` itself `import`s `./maplibre-gl-shared.mjs` as a
 * real (unbundled) browser ES module specifier, resolved relative to its
 * own URL at request time — both files must be copied side by side or the
 * worker fails to load with a module-resolution error.
 *
 * The RTL plugin (`@mapbox/mapbox-gl-rtl-text`) is the same story for a
 * different reason: maplibre-gl 6.x ships NO rtl-text plugin of its own
 * (verified — `node_modules/maplibre-gl/dist` has no `*rtl*` file at all,
 * unlike some older docs/examples that assume mapbox-gl vendors one) — it's
 * a genuinely separate npm package (added as a dependency, see
 * package.json), and `Map.setRTLTextPlugin(url, lazy)` (called from
 * `map.web.tsx`, before map creation) needs that script served at a real
 * URL too, for exactly the same Metro-doesn't-manage-runtime-string-URLs
 * reason as the worker bundle above. The worker thread loads it via a
 * fetch+eval path for non-`.mjs` URLs (read from the installed package's own
 * `loadScript` in `maplibre-gl-worker-dev.mjs`), so the plugin's UMD/IIFE
 * `dist/mapbox-gl-rtl-text.js` file can be copied byte-for-byte with no
 * `.mjs` conversion needed.
 *
 * Runs on `npm install`/`npm ci` (see package.json's "postinstall") so the
 * copy is always in sync with whatever maplibre-gl/rtl-text-plugin versions
 * are installed. Not committed to git (see .gitignore) — a checked-in copy
 * would silently drift out of sync the next time either package is
 * upgraded.
 */
const fs = require("fs");
const path = require("path");

const MAPLIBRE_SRC_DIR = path.join(__dirname, "..", "node_modules", "maplibre-gl", "dist");
const RTL_PLUGIN_SRC_DIR = path.join(
  __dirname,
  "..",
  "node_modules",
  "@mapbox",
  "mapbox-gl-rtl-text",
  "dist",
);
const OUT_DIR = path.join(__dirname, "..", "public");

const MAPLIBRE_FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];
const RTL_PLUGIN_FILES = ["mapbox-gl-rtl-text.js"];

/** Copies `file` from `srcDir` to `OUT_DIR`, stripping the trailing
 * `//# sourceMappingURL=...` comment: we don't ship the matching .map files
 * (they're large and dev-tooling-only), and an unstripped comment just means
 * one extra harmless 404 in devtools. */
function copyStripped(srcDir, file) {
  const srcPath = path.join(srcDir, file);
  const outPath = path.join(OUT_DIR, file);
  const code = fs
    .readFileSync(srcPath, "utf8")
    .replace(/\n\/\/# sourceMappingURL=.*$/, "\n");
  fs.writeFileSync(outPath, code);
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (fs.existsSync(MAPLIBRE_SRC_DIR)) {
    for (const file of MAPLIBRE_FILES) {
      copyStripped(MAPLIBRE_SRC_DIR, file);
    }
    console.log(`[sync-maplibre-worker] copied ${MAPLIBRE_FILES.join(", ")} to public/`);
  } else {
    console.warn("[sync-maplibre-worker] maplibre-gl not installed, skipping");
  }

  if (fs.existsSync(RTL_PLUGIN_SRC_DIR)) {
    for (const file of RTL_PLUGIN_FILES) {
      copyStripped(RTL_PLUGIN_SRC_DIR, file);
    }
    console.log(`[sync-maplibre-worker] copied ${RTL_PLUGIN_FILES.join(", ")} to public/`);
  } else {
    console.warn(
      "[sync-maplibre-worker] @mapbox/mapbox-gl-rtl-text not installed, skipping",
    );
  }
}

main();
