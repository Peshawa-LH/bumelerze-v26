#!/usr/bin/env node
// Drift check for the edge functions (security audit CI-09, A2.4).
//
// Each live function is a thin wrapper that imports its code from GitHub at a
// pinned commit. Read the pins with the Supabase MCP (`get_edge_function`; the
// commit is in the wrapper's raw.githubusercontent.com URL), then run:
//
//   node scripts/check-function-pins.mjs send-alerts=<sha> ingest-events=<sha> \
//     aggregate-felt-cells=<sha> purge-home-photos=<sha>
//
// For each function it compares the function's folder and supabase/functions/
// _shared at the pinned commit with the same paths at HEAD (normally main
// after a merge). Prints "in sync" or the files that differ, and exits 1 on
// any drift or on a commit that is not on origin/main.
import { execFileSync } from "node:child_process";

const FUNCTIONS = ["send-alerts", "ingest-events", "aggregate-felt-cells", "purge-home-photos"];
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const pins = new Map();
for (const arg of process.argv.slice(2)) {
  const match = /^([a-z-]+)=([0-9a-f]{7,40})$/.exec(arg);
  if (!match || !FUNCTIONS.includes(match[1])) {
    console.error(`usage: name=<commit> for ${FUNCTIONS.join(", ")} (got "${arg}")`);
    process.exit(2);
  }
  pins.set(match[1], match[2]);
}
if (pins.size === 0) {
  console.error(`usage: node scripts/check-function-pins.mjs ${FUNCTIONS.map((f) => `${f}=<sha>`).join(" ")}`);
  process.exit(2);
}

let drift = false;
for (const [name, sha] of pins) {
  let onMain = true;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "origin/main"], { stdio: "ignore" });
  } catch {
    onMain = false;
  }
  const changed = git("diff", "--name-only", sha, "HEAD", "--", `supabase/functions/${name}`, "supabase/functions/_shared")
    .split("\n")
    .filter((f) => f && !f.includes("/__tests__/") && !f.endsWith("README.md"));
  if (!onMain) {
    drift = true;
    console.log(`${name}: pinned ${sha.slice(0, 8)} is not on origin/main`);
  } else if (changed.length > 0) {
    drift = true;
    console.log(`${name}: DRIFT, pinned ${sha.slice(0, 8)} differs from HEAD in ${changed.join(", ")}`);
  } else {
    console.log(`${name}: in sync (pinned ${sha.slice(0, 8)})`);
  }
}
process.exit(drift ? 1 : 0);
