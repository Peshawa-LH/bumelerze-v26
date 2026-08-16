#!/usr/bin/env node
/**
 * Copies maplibre-gl's worker-thread bundle (and the shared chunk it
 * imports) from node_modules into public/, so Expo's web build serves them
 * as real static files in BOTH environments:
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
 * Runs on `npm install`/`npm ci` (see package.json's "postinstall") so the
 * copy is always in sync with whatever maplibre-gl version is installed.
 * Not committed to git (see .gitignore) — a checked-in copy would silently
 * drift out of sync the next time maplibre-gl is upgraded.
 */
const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..", "node_modules", "maplibre-gl", "dist");
const OUT_DIR = path.join(__dirname, "..", "public");

const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.warn("[sync-maplibre-worker] maplibre-gl not installed, skipping");
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const file of FILES) {
    const srcPath = path.join(SRC_DIR, file);
    const outPath = path.join(OUT_DIR, file);
    // Strips the trailing `//# sourceMappingURL=...` comment: we don't ship
    // the matching .map files (they're large and dev-tooling-only), and an
    // unstripped comment just means one extra harmless 404 in devtools.
    const code = fs
      .readFileSync(srcPath, "utf8")
      .replace(/\n\/\/# sourceMappingURL=.*$/, "\n");
    fs.writeFileSync(outPath, code);
  }

  console.log(`[sync-maplibre-worker] copied ${FILES.join(", ")} to public/`);
}

main();
