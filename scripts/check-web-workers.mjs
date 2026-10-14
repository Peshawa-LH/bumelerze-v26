#!/usr/bin/env node
// Fails the web build when a Web Worker file would miss a module.
//
// A worker file (expo-sqlite's SQLite worker behind the offline catalogue)
// runs on its own and can only use the modules inside it. Expo's web
// splitter can move a module the worker shares with a screen into the
// shared __common file, which the worker never loads; the catalogue then
// breaks with "Requiring unknown module" (index.js explains the fix). This
// checks every worker-*.js file: each module it requires must be defined in
// the same file.
//
// Usage: node scripts/check-web-workers.mjs dist-app
import fs from "node:fs";
import path from "node:path";

const dir = path.join(process.argv[2] ?? "dist-app", "_expo/static/js/web");
let failed = false;
for (const file of fs.readdirSync(dir).filter((name) => /^worker-.*\.js$/.test(name))) {
  const code = fs.readFileSync(path.join(dir, file), "utf8");
  const defined = new Set();
  const required = new Set();
  // Each module ends with "},<id>,[<dependency ids>]".
  for (const match of code.matchAll(/\},(\d+),\[([\d,]*)\]/g)) {
    defined.add(match[1]);
    for (const dep of match[2].split(",").filter(Boolean)) required.add(dep);
  }
  const missing = [...required].filter((id) => !defined.has(id));
  if (defined.size === 0 || missing.length > 0) {
    failed = true;
    console.error(
      `check-web-workers: ${file} misses module(s) ${missing.join(", ") || "(none found at all)"}.` +
        " Require the package those modules come from in index.js (web branch); see the comment there.",
    );
  }
}
if (failed) {
  process.exit(1);
}
console.log("check-web-workers: every worker file has all its modules");
