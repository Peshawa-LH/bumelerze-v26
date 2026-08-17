#!/usr/bin/env node
/**
 * Builds the Kurdish place-names dataset from OpenStreetMap (update-plan
 * §4.7 Part 1) — the fix for the owner's most-repeated map complaint: below
 * roughly a dozen hand-checked gazetteer cities (`src/features/geo/
 * gazetteer.ts`), the app has no Sorani place names at all, because the
 * OpenMapTiles vector-tile schema both basemap providers use has no `ckb`
 * name field (verified against upstream `openmaptiles.yaml`, see
 * `own-labels.ts`'s doc comment). OpenStreetMap itself DOES carry `name:ckb`
 * (Sorani) and often `name:ku` (Kurmanji) tags, contributed by Kurdish
 * mappers — this script extracts them into a dataset the app owns and
 * bundles, via the public Overpass API.
 *
 * Usage:
 *   export PATH="/opt/homebrew/bin:$PATH"
 *   node scripts/build-kurdish-places.mjs [--force]
 *
 * `--force` re-queries Overpass even if a cached raw response already
 * exists for the current bbox (see CACHE_PATH below) — the default run
 * always prefers the cache, so re-running this script to tweak tiering,
 * dedup, or output shape never re-hits Overpass's shared public servers.
 *
 * Reads its query area from THIS APP'S OWN `REGION_BBOX`
 * (`src/features/events/config.ts`) rather than a second hardcoded bbox —
 * extracted by a small regex read of that file's source (the same
 * "read a source-of-truth constant out of its real module" approach
 * `generate-assets.js` already uses for the brand palette), so the two
 * bboxes can never drift apart.
 *
 * Writes two JSON assets under `src/features/geo/data/`:
 *   - `kurdish-places-core.json`     tier 1-2 (city/town/suburb) — small,
 *     statically imported, always bundled.
 *   - `kurdish-places-villages.json` tier 3 (village/hamlet) — the bulk of
 *     the dataset, meant to be loaded lazily (dynamic `import()`, same
 *     "not paid for until the Map tab is opened" pattern `map.web.tsx`
 *     already uses for `maplibre-gl` itself) — see `own-labels.ts`.
 *
 * LICENSING (not a nicety — see `DATA-SOURCES.md` §4): this dataset is a
 * derived extract of OpenStreetMap data, which is licensed under the Open
 * Database License (ODbL). Redistributing it (including as JSON committed
 * to this app's public source tree) requires attribution — already wired
 * into the map's on-screen attribution control via `own-labels.ts`'s
 * `OWN_LABELS_ATTRIBUTION` — and, under ODbL's share-alike term, keeps this
 * specific extracted dataset itself under ODbL too. Do not silently change
 * that without updating `DATA-SOURCES.md`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REGION_CONFIG_FILE = path.join(ROOT, "src/features/events/config.ts");
const CACHE_DIR = path.join(ROOT, "scripts/.cache");
const CACHE_PATH = path.join(CACHE_DIR, "kurdish-places-overpass-raw.json");
const OUT_DIR = path.join(ROOT, "src/features/geo/data");
const CORE_OUT_PATH = path.join(OUT_DIR, "kurdish-places-core.json");
const VILLAGES_OUT_PATH = path.join(OUT_DIR, "kurdish-places-villages.json");

// Sequential, not parallel — "be a good Overpass citizen". The main
// instance can be busy at the DB-open level independent of any rate limit
// (observed live 2026-08-17: `Dispatcher_Client::request_read_and_idx::
// timeout`); falling through to the community mirror rather than hammering
// the same instance is the documented, polite way to handle that.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];

const QUERY_TIMEOUT_S = 180;
const FETCH_TIMEOUT_MS = (QUERY_TIMEOUT_S + 20) * 1000;
const MIRROR_BACKOFF_MS = 5000;

// Place types worth a label at all (event-pipeline scale, not "every named
// point in OSM") — OpenStreetMap's own `place=*` value set, in descending
// size order.
const PLACE_TYPES = ["city", "town", "village", "suburb", "hamlet"];

/** OSM `place` tag -> this dataset's render tier. City stands alone (tier
 * 1, always shown, mirrors the gazetteer's uniform city treatment); town
 * and suburb share tier 2 (moderate zoom); village and hamlet share tier 3
 * (close zoom only, and the only tier this script drops entries from by
 * language coverage — see `shipTier3` below). Kept here, not inferred from
 * `PLACE_TYPES`'s order, so the mapping is explicit and reviewable. */
const TIER_BY_PLACE = {
  city: 1,
  town: 2,
  suburb: 2,
  village: 3,
  hamlet: 3,
};

function readRegionBbox() {
  const src = readFileSync(REGION_CONFIG_FILE, "utf8");
  const block = src.match(/export const REGION_BBOX = \{([\s\S]*?)\} as const;/);
  if (!block) {
    throw new Error(
      `Could not find "export const REGION_BBOX = {...} as const" in ${REGION_CONFIG_FILE} — ` +
        "config.ts shape changed, update the regex in build-kurdish-places.mjs.",
    );
  }
  const body = block[1];
  const pick = (key) => {
    const m = body.match(new RegExp(`${key}:\\s*(-?[0-9.]+)`));
    if (!m) {
      throw new Error(`REGION_BBOX block has no "${key}" field — ${REGION_CONFIG_FILE}`);
    }
    return Number(m[1]);
  };
  return {
    minLat: pick("minLat"),
    maxLat: pick("maxLat"),
    minLon: pick("minLon"),
    maxLon: pick("maxLon"),
  };
}

/** Overpass QL, one HTTP request: nodes+ways for each of `PLACE_TYPES`
 * carrying at least one of the three Kurdish/Arabic name tags we care
 * about, unioned in a single query block (still one round trip — the
 * "one query" the wave brief asks for is about request COUNT, not
 * statement count). `out center tags` resolves a `center` lat/lon for way
 * results (villages/suburbs are sometimes mapped as a boundary way, not a
 * point) alongside every tag, in one pass. */
function buildOverpassQuery(bbox) {
  const placeAlt = PLACE_TYPES.join("|");
  const bboxClause = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  const nameKeys = ["name:ckb", "name:ku", "name:ar"];
  const statements = nameKeys
    .flatMap((key) => [
      `  node["place"~"^(${placeAlt})$"]["${key}"];`,
      `  way["place"~"^(${placeAlt})$"]["${key}"];`,
    ])
    .join("\n");
  return `[out:json][timeout:${QUERY_TIMEOUT_S}][bbox:${bboxClause}];\n(\n${statements}\n);\nout center tags;\n`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Tries each mirror in `OVERPASS_ENDPOINTS`, in order, one attempt each
 * (no same-mirror retry loop — a mirror that's busy/rate-limited gets one
 * try, then the next mirror gets a turn, which is both faster in practice
 * and less hammering than retrying the same struggling instance). Honors
 * `Retry-After` on a 429 by waiting it out before trying the NEXT mirror,
 * rather than ignoring it. */
async function fetchFromOverpass(query) {
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      console.log(`[build-kurdish-places] querying ${endpoint} ...`);
      const res = await fetch(endpoint, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Overpass's own usage guidelines ask for an identifiable
          // User-Agent; some endpoints also 406 a request with none/a
          // generic one (observed live 2026-08-17 against the default
          // Node `fetch` UA).
          "User-Agent": "bumelerze-kurdish-places-builder/1.0 (https://bumelerze.com)",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status === 504) {
        const retryAfterS =
          Number(res.headers.get("retry-after")) || MIRROR_BACKOFF_MS / 1000;
        console.warn(
          `[build-kurdish-places] ${endpoint} returned ${res.status}, waiting ${retryAfterS}s before trying the next mirror`,
        );
        await sleep(retryAfterS * 1000);
        lastError = new Error(`${endpoint} rate-limited (${res.status})`);
        continue;
      }
      if (!res.ok) {
        lastError = new Error(`${endpoint} returned HTTP ${res.status}`);
        console.warn(`[build-kurdish-places] ${lastError.message}, trying next mirror`);
        await sleep(MIRROR_BACKOFF_MS);
        continue;
      }
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        // Overpass returns an HTML error page (not JSON) for its own
        // internal "too busy" condition — treat exactly like a failed
        // mirror rather than crashing on the JSON.parse.
        lastError = new Error(`${endpoint} returned a non-JSON response (server busy)`);
        console.warn(`[build-kurdish-places] ${lastError.message}, trying next mirror`);
        await sleep(MIRROR_BACKOFF_MS);
        continue;
      }
      if (!Array.isArray(json.elements)) {
        lastError = new Error(`${endpoint} returned JSON with no "elements" array`);
        continue;
      }
      console.log(
        `[build-kurdish-places] ${endpoint} OK — ${json.elements.length} raw elements`,
      );
      return json;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      console.warn(
        `[build-kurdish-places] ${endpoint} failed: ${String(err)}, trying next mirror`,
      );
      await sleep(MIRROR_BACKOFF_MS);
    }
  }
  throw lastError ?? new Error("All Overpass endpoints failed");
}

function cacheKeyFor(bbox, query) {
  return createHash("sha256")
    .update(JSON.stringify({ bbox, query }))
    .digest("hex")
    .slice(0, 16);
}

async function loadRawOverpassResult(bbox, force) {
  const query = buildOverpassQuery(bbox);
  const key = cacheKeyFor(bbox, query);

  if (!force && existsSync(CACHE_PATH)) {
    const cached = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
    if (cached.cacheKey === key) {
      console.log(
        `[build-kurdish-places] using cached Overpass response (${cached.elements.length} elements, fetched ${cached.fetchedAt}) — pass --force to re-query`,
      );
      return cached.elements;
    }
    console.log(
      "[build-kurdish-places] cache exists but bbox/query changed, re-querying",
    );
  }

  let result;
  try {
    result = await fetchFromOverpass(query);
  } catch (err) {
    if (existsSync(CACHE_PATH)) {
      console.warn(
        `[build-kurdish-places] Overpass fetch failed (${String(err)}) — falling back to stale cache rather than failing the build`,
      );
      return JSON.parse(readFileSync(CACHE_PATH, "utf8")).elements;
    }
    throw err;
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(
    CACHE_PATH,
    JSON.stringify({
      cacheKey: key,
      bbox,
      fetchedAt: new Date().toISOString(),
      elements: result.elements,
    }),
  );
  return result.elements;
}

// ---------------------------------------------------------------------------
// Normalize raw Overpass elements into working records.
// ---------------------------------------------------------------------------

function toWorkingRecord(element) {
  const tags = element.tags ?? {};
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (lat === undefined || lon === undefined) {
    return null;
  }
  const place = tags.place;
  if (!TIER_BY_PLACE[place]) {
    return null;
  }
  const names = {};
  if (tags["name:ckb"]) names.ckb = tags["name:ckb"];
  if (tags["name:ku"]) names.kmr = tags["name:ku"];
  if (tags["name:ar"]) names.ar = tags["name:ar"];
  if (tags.name) names.name = tags.name; // kept through dedup only; dropped before shipping (see compactRecord)
  return {
    osmType: element.type,
    id: `${element.type === "node" ? "n" : "w"}${element.id}`,
    lat,
    lon,
    place,
    names,
  };
}

// ---------------------------------------------------------------------------
// Dedup: the same physical settlement is very often mapped BOTH as a point
// node and a boundary way (each independently carrying `place=`+name tags),
// which the raw Overpass result returns as two separate elements at nearly
// the same coordinate. Verified live against the 2026-08-17 extract: exact
// duplicates like this exist (e.g. a village mapped as both `n2479369819`
// and `w303702850`, identical Sorani name, ~50m apart). Grid-bucketed
// haversine + exact-name-match merge, union-find so >2-way duplicate
// clusters collapse correctly in one pass.
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_000;

/** Standalone haversine copy (not imported from `events/distance.ts`) —
 * this is a one-off Node build script outside the app's TS module graph
 * (plain ESM, no ts-node/tsx in this project's toolchain), not app runtime
 * code; the formula itself is the same standard great-circle distance the
 * app's own `haversineDistanceKm` implements. */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const DEDUP_GRID_CELL_DEG = 0.01; // ~1.1km — bucket width, not the match radius itself
const DEDUP_MAX_DISTANCE_M = 500;

function namesShareAValue(a, b) {
  return ["ckb", "kmr", "ar", "name"].some((k) => a[k] && b[k] && a[k] === b[k]);
}

function dedupRecords(records) {
  const grid = new Map();
  const gridKey = (gx, gy) => `${gx}:${gy}`;
  records.forEach((r, i) => {
    const gx = Math.floor(r.lat / DEDUP_GRID_CELL_DEG);
    const gy = Math.floor(r.lon / DEDUP_GRID_CELL_DEG);
    const key = gridKey(gx, gy);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });

  const parent = records.map((_, i) => i);
  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  records.forEach((r, i) => {
    const gx = Math.floor(r.lat / DEDUP_GRID_CELL_DEG);
    const gy = Math.floor(r.lon / DEDUP_GRID_CELL_DEG);
    const neighbors = new Set();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const idx of grid.get(gridKey(gx + dx, gy + dy)) ?? []) {
          neighbors.add(idx);
        }
      }
    }
    for (const j of neighbors) {
      if (j <= i) continue;
      const other = records[j];
      if (TIER_BY_PLACE[r.place] !== TIER_BY_PLACE[other.place]) continue;
      if (haversineMeters(r.lat, r.lon, other.lat, other.lon) > DEDUP_MAX_DISTANCE_M)
        continue;
      if (!namesShareAValue(r.names, other.names)) continue;
      union(i, j);
    }
  });

  const groups = new Map();
  records.forEach((_, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  });

  const merged = [];
  for (const idxs of groups.values()) {
    const members = idxs.map((i) => records[i]);
    // Prefer a node's coordinate/id as canonical (a point is a more precise
    // "where the label goes" than a way's computed centroid), but UNION
    // every member's names (way-tagged names applied first, node-tagged
    // names applied last so they win on any actual conflict) so a
    // merge never loses a language a node happened not to carry.
    const canonical = members.find((m) => m.osmType === "node") ?? members[0];
    const names = {};
    for (const m of members) {
      if (m === canonical) continue;
      Object.assign(names, m.names);
    }
    Object.assign(names, canonical.names);
    merged.push({ ...canonical, names });
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Script quality guard: a `name:ku` (Kurmanji) value is only credible if
// it's actually Latin-script (the Hawar alphabet Kurmanji is written in) —
// verified live against the 2026-08-17 extract that a real minority of
// `name:ku` tags are byte-identical (or near-identical) copies of the
// Arabic-script `name`/`name:ar` value, almost entirely on small villages
// near/south of Baghdad (Anbar/Diyala, well outside any Kurdish-populated
// area), e.g. `n2482521373`'s `name:ku` = `"عرب الشيخ جميل المضعن"` — plainly
// a mistagged bulk-import artifact, not a real Kurmanji exonym, unlike the
// LEGITIMATE Latin-script Kurmanji exonyms this same dataset has for major
// non-Kurdish cities (Baghdad -> "Bexda", Fallujah -> "Feluce", Tikrit ->
// "Tikrît" — real, attested Kurdish exonyms, kept as-is). Mirrored the
// other direction for `name:ckb` (Sorani, always Arabic-based script — a
// value with NO Arabic-script characters at all is equally suspicious, a
// rarer but real pattern in the same extract). Rejected values are DROPPED
// from the shipped record (falls back to whatever other language fields
// survive) rather than kept-but-wrong; counts are reported so this is
// visible, not silently fixed.
// ---------------------------------------------------------------------------

const ARABIC_SCRIPT_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

function applyScriptQualityGuard(records) {
  let rejectedKmr = 0;
  let rejectedCkb = 0;
  const guarded = records.map((r) => {
    const names = { ...r.names };
    if (names.kmr && ARABIC_SCRIPT_RE.test(names.kmr)) {
      delete names.kmr;
      rejectedKmr += 1;
    }
    if (names.ckb && !ARABIC_SCRIPT_RE.test(names.ckb)) {
      delete names.ckb;
      rejectedCkb += 1;
    }
    return { ...r, names };
  });
  return { guarded, rejectedKmr, rejectedCkb };
}

// ---------------------------------------------------------------------------
// Language-coverage report (Part 3 — computed on the full deduped,
// quality-guarded set, before tier 3's language-based drop below, so the
// report is honest about what OSM actually has, not just what ships).
// ---------------------------------------------------------------------------

function languageBucket(names) {
  if (names.ckb || names.kmr) return "ckbOrKmr";
  if (names.ar) return "arOnly";
  return "none";
}

function buildCoverageReport(records) {
  const byPlace = {};
  for (const place of PLACE_TYPES) {
    byPlace[place] = { ckbOrKmr: 0, arOnly: 0, none: 0 };
  }
  for (const r of records) {
    byPlace[r.place][languageBucket(r.names)] += 1;
  }
  return byPlace;
}

// ---------------------------------------------------------------------------
// Shipped output: tier 1-2 shipped regardless of language coverage (small,
// and every real city/town is worth having a point for even Arabic-only);
// tier 3 (village/hamlet) shipped ONLY when it carries a real Kurdish name
// (`ckb` or `kmr`) — an Arabic-only hamlet adds no NEW value over the
// basemap's own existing `name:ar` coalesce (`labels.ts`) and tier 3 is by
// far the largest population, so this is where "keep it small" actually
// bites. Counts for the dropped Arabic-only/no-name tier-3 places are still
// in the coverage report above — nothing is silently thrown away from the
// gap report, only from the shipped bundle.
// ---------------------------------------------------------------------------

function compactRecord(record) {
  const names = {};
  if (record.names.ckb) names.ckb = record.names.ckb;
  if (record.names.kmr) names.kmr = record.names.kmr;
  if (record.names.ar) names.ar = record.names.ar;
  return {
    id: record.id,
    lat: Math.round(record.lat * 10_000) / 10_000,
    lon: Math.round(record.lon * 10_000) / 10_000,
    tier: TIER_BY_PLACE[record.place],
    names,
  };
}

function sortDeterministically(records) {
  return [...records].sort(
    (a, b) =>
      a.tier - b.tier || a.lat - b.lat || a.lon - b.lon || a.id.localeCompare(b.id),
  );
}

function byteSize(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function gzipSize(value) {
  return gzipSync(Buffer.from(JSON.stringify(value), "utf8")).length;
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function main() {
  const force = process.argv.includes("--force");
  const bbox = readRegionBbox();
  console.log(
    `[build-kurdish-places] REGION_BBOX from events/config.ts: lat ${bbox.minLat}..${bbox.maxLat}, lon ${bbox.minLon}..${bbox.maxLon}`,
  );

  const rawElements = await loadRawOverpassResult(bbox, force);
  const working = rawElements.map(toWorkingRecord).filter((r) => r !== null);
  console.log(
    `[build-kurdish-places] ${working.length} raw place elements after tag filtering`,
  );

  const deduped = dedupRecords(working);
  console.log(
    `[build-kurdish-places] ${deduped.length} places after node/way dedup (removed ${working.length - deduped.length})`,
  );

  const { guarded, rejectedKmr, rejectedCkb } = applyScriptQualityGuard(deduped);
  console.log(
    `[build-kurdish-places] script quality guard: dropped ${rejectedKmr} name:ku values that were Arabic-script (not real Kurmanji) and ${rejectedCkb} name:ckb values with no Arabic-script characters at all`,
  );

  const coverage = buildCoverageReport(guarded);

  // `languageBucket(...) !== "none"` on tier 1-2 too, not just tier 3 —
  // the script quality guard above can leave a record with an EMPTY
  // `names` object (e.g. a record whose only name field was a rejected
  // Arabic-script `name:ku`), and a place with zero valid names in any
  // language must never ship regardless of tier.
  const tier1And2 = guarded.filter(
    (r) => TIER_BY_PLACE[r.place] <= 2 && languageBucket(r.names) !== "none",
  );
  const tier3WithKurdishName = guarded.filter(
    (r) => TIER_BY_PLACE[r.place] === 3 && languageBucket(r.names) === "ckbOrKmr",
  );

  const core = sortDeterministically(tier1And2.map(compactRecord));
  const villages = sortDeterministically(tier3WithKurdishName.map(compactRecord));

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(CORE_OUT_PATH, JSON.stringify(core));
  writeFileSync(VILLAGES_OUT_PATH, JSON.stringify(villages));

  console.log(
    "\n[build-kurdish-places] ---- Language coverage (all deduped OSM places, not just shipped) ----",
  );
  for (const place of PLACE_TYPES) {
    const c = coverage[place];
    const total = c.ckbOrKmr + c.arOnly + c.none;
    console.log(
      `  ${place.padEnd(8)} total ${String(total).padStart(6)}  ckb/kmr ${String(c.ckbOrKmr).padStart(5)}  ar-only ${String(c.arOnly).padStart(5)}  none ${String(c.none).padStart(4)}`,
    );
  }

  console.log("\n[build-kurdish-places] ---- Shipped output ----");
  console.log(
    `  ${path.relative(ROOT, CORE_OUT_PATH)}: ${core.length} places, ${formatKb(byteSize(core))} (gzip ${formatKb(gzipSize(core))})`,
  );
  console.log(
    `  ${path.relative(ROOT, VILLAGES_OUT_PATH)}: ${villages.length} places, ${formatKb(byteSize(villages))} (gzip ${formatKb(gzipSize(villages))})`,
  );
  console.log(
    `  dropped from tier 3 (village/hamlet) for having no ckb/kmr name: ${guarded.filter((r) => TIER_BY_PLACE[r.place] === 3).length - tier3WithKurdishName.length}`,
  );
}

main().catch((err) => {
  console.error("[build-kurdish-places] FAILED:", err);
  process.exitCode = 1;
});
