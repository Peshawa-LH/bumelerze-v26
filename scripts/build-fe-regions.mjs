#!/usr/bin/env node
/**
 * Builds the Flinn-Engdahl (F-E) region lookup tables bundled with the app
 * (event naming, D28 decision 1): `src/features/geo/data/fe-regions.generated.ts`.
 *
 * Why this exists: USGS's `place` is bearing-format English prose ("55 km ESE
 * of Kokopo, Papua New Guinea"), so for a far-field event the app derives the
 * F-E region ITSELF from the epicentre. F-E is the standard, closed 757-region
 * geographic scheme (Flinn, Engdahl and Hill 1974; revised by Young, Presgrave,
 * Aichele, Wiens and Flinn 1996, "The Flinn-Engdahl regionalisation scheme: the
 * 1995 revision", Phys. Earth Planet. Inter. 96, 223-297). The tables are the
 * NEIC/USGS-distributed ones (names + a 1-degree quadrilateral grid per
 * hemisphere quadrant); see DATA-SOURCES.md.
 *
 * Usage (then run `npx prettier --write` on the output):
 *   node scripts/build-fe-regions.mjs <dir>
 * where <dir> holds the original table files `names.asc`, `quadsidx.asc`,
 * `nesect.asc`, `nwsect.asc`, `sesect.asc`, `swsect.asc` (the copies shipped in
 * ObsPy's `obspy/geodetics/data/` are byte-identical to the USGS ones).
 *
 * Output encoding (kept tiny, parsed lazily, ~25 KB of source):
 * - `FE_REGION_NAMES_EN[n - 1]`: readable English name of region n (F-E
 *   upper-case abbreviations expanded and sentence-cased here once, so the
 *   runtime never has to).
 * - `FE_GRID_ROWS[quadrant * 91 + floor(abs(lat))]`: one string per latitude
 *   row; each 4-character token is `lonStart` (2 chars, base 36) followed by
 *   the region number (2 chars, base 36). Quadrants are ne, nw, se, sw.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/build-fe-regions.mjs <dir with names.asc ...>");
  process.exit(1);
}

const read = (f) => readFileSync(join(dir, f), "utf8");
const rawNames = read("names.asc")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);
if (rawNames.length !== 757)
  throw new Error(`expected 757 names, got ${rawNames.length}`);

const nums = (f) => read(f).split(/\s+/).filter(Boolean).map(Number);

/** Hand-fixed English for the F-E names that carry abbreviations or typos.
 * Everything else is mechanically sentence-cased (`prettify`). */
const OVERRIDES = {
  4: "Komandorskiye Ostrova region",
  7: "Andreanof Islands, Aleutian Islands",
  35: "Near coast of northern California",
  45: "California-Baja California border region",
  46: "Western Arizona-Sonora border region",
  47: "Off west coast of Baja California",
  53: "Revilla Gigedo Islands region",
  132: "Santiago del Estero Province, Argentina",
  145: "Southern Chile-Argentina border region",
  158: "Off west coast of North Island, New Zealand",
  160: "Off east coast of North Island, New Zealand",
  76: "Off coast of Central America",
  161: "Off west coast of South Island, New Zealand",
  164: "Off east coast of South Island, New Zealand",
  166: "Auckland Islands, New Zealand region",
  190: "New Ireland region, Papua New Guinea",
  192: "New Britain region, Papua New Guinea",
  194: "D'Entrecasteaux Islands region",
  196: "Papua region, Indonesia",
  197: "Near north coast of Papua",
  201: "Papua, Indonesia",
  205: "Near south coast of Papua",
  198: "Ninigo Islands region, Papua New Guinea",
  199: "Admiralty Islands region, Papua New Guinea",
  200: "Near north coast of New Guinea, Papua New Guinea",
  206: "Near south coast of New Guinea, Papua New Guinea",
  207: "Eastern New Guinea region, Papua New Guinea",
  209: "Western Caroline Islands, Micronesia",
  230: "Near south coast of Honshu, Japan",
  233: "Near south coast of western Honshu",
  246: "Southwestern Ryukyu Islands, Japan",
  281: "Tanimbar Islands region, Indonesia",
  305: "Western Xizang-India border region",
  313: "Eastern Xizang-India border region",
  320: "Kyrgyzstan-Xinjiang border region",
  331: "Kazakhstan-Xinjiang border region",
  342: "Turkmenistan-Afghanistan border region",
  344: "Armenia-Azerbaijan-Iran border region",
  357: "Ukraine-Moldova-southwestern Russia region",
  367: "Georgia-Armenia-Turkey border region",
  374: "Jordan-Syria region",
  427: "Mauritius-Reunion region",
  454: "Gulf of St. Lawrence",
  474: "Vermont-New Hampshire region",
  516: "Eastern Arizona-Sonora border region",
  517: "New Mexico-Chihuahua border region",
  561: "Off south coast of northwest Africa",
  603: "Near southeast coast of Australia",
  587: "Off coast of South Africa",
  614: "Eastern Caroline Islands, Micronesia",
  616: "Enewetak Atoll region, Marshall Islands",
  617: "Bikini Atoll region, Marshall Islands",
  650: "Near coast of western Siberia, Russia",
  653: "Near coast of central Siberia, Russia",
  657: "Eastern Russia-northeastern China border region",
  661: "Primor'ye, Russia",
  670: "Near north coast of eastern Siberia",
  674: "St. Lawrence Island, Alaska region",
  679: "Northwest Territories-Nunavut, Canada",
  705: "Off west coast of northern Sumatra",
  717: "Afghanistan-Tajikistan border region",
  719: "Tajikistan-Xinjiang border region",
  732: "East of South Sandwich Islands",
  689: "Chatham Islands, New Zealand region",
  684: "Southern East Pacific Rise",
  688: "East of North Island, New Zealand",
  694: "Central East Pacific Rise",
  730: "Northern East Pacific Rise",
  724: "Baltics-Belarus-northwestern Russia region",
  739: "Azores-Cape St. Vincent Ridge",
  746: "Senegal-Gambia region",
  750: "Cote d'Ivoire",
  753: "Benin-Togo region",
};

/** Words that stay lower-case mid-name; proper nouns get a capital. */
const MINOR = new Set(["of", "off", "and", "the", "del", "da", "de", "near"]);
const PROPER_AFTER_COMMA = true;

function prettify(upper) {
  // Sentence case with proper nouns capitalised: capitalise every word except
  // the minor ones and the generic geographic nouns/directions that F-E uses
  // as running text ("region", "border", "coast", "north", ...).
  const GENERIC = new Set([
    "region",
    "border",
    "coast",
    "north",
    "south",
    "east",
    "west",
    "northern",
    "southern",
    "eastern",
    "western",
    "northeastern",
    "northwestern",
    "southeastern",
    "southwestern",
    "northeast",
    "northwest",
    "southeast",
    "southwest",
    "central",
    "northcentral",
    "off",
  ]);
  const words = upper.toLowerCase().split(" ");
  return words
    .map((w, i) => {
      if (i === 0) return capitalizeWord(w);
      const afterComma = PROPER_AFTER_COMMA && words[i - 1].endsWith(",");
      const bare = w.replace(/[,.]/g, "");
      if (MINOR.has(bare) || (GENERIC.has(bare) && !afterComma)) return w;
      return capitalizeWord(w);
    })
    .join(" ");
}

function capitalizeWord(w) {
  // Hyphenated compounds: capitalise each part ("Iran-Iraq"), except generic
  // trailing nouns ("border region" is a separate word, so only parts here).
  return w
    .split("-")
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join("-");
}

const names = rawNames.map(
  (raw, i) => OVERRIDES[i + 1] ?? prettify(raw.replace(/\s+/g, " ")),
);

// Directions inside hyphenated border names are written "Western Arizona-..."
// in the overrides; a few mechanical names still need generic lower-casing of
// directions that follow a hyphen ("Iran-Iraq border region" is fine as is).

const idx = nums("quadsidx.asc");
if (idx.length !== 4 * 91)
  throw new Error(`quadsidx: expected 364 numbers, got ${idx.length}`);

const QUADS = ["ne", "nw", "se", "sw"];
const tok = (lon, fe) =>
  lon.toString(36).padStart(2, "0") + fe.toString(36).padStart(2, "0");

const rows = [];
let totalRuns = 0;
QUADS.forEach((q, qi) => {
  const sect = nums(`${q}sect.asc`);
  let p = 0;
  for (let lat = 0; lat < 91; lat++) {
    const count = idx[qi * 91 + lat];
    let row = "";
    for (let k = 0; k < count; k++) {
      const lon = sect[p++];
      const fe = sect[p++];
      if (lon > 180 || fe < 1 || fe > 757)
        throw new Error(`bad run ${q} ${lat}: ${lon} ${fe}`);
      row += tok(lon, fe);
      totalRuns++;
    }
    rows.push(row);
  }
  if (p !== sect.length) throw new Error(`${q}sect: consumed ${p} of ${sect.length}`);
});

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "src", "features", "geo", "data", "fe-regions.generated.ts");

const body = `// GENERATED by scripts/build-fe-regions.mjs - do not edit by hand.
// Flinn-Engdahl regionalisation (1995 revision, 757 regions): USGS/NEIC tables
// (Young et al. 1996, PEPI 96, 223-297). ${totalRuns} grid runs. See DATA-SOURCES.md.

/** Readable English name of F-E region \`n\` at index \`n - 1\`. */
export const FE_REGION_NAMES_EN: readonly string[] = ${JSON.stringify(names, null, 2)};

/** 4 quadrants (ne, nw, se, sw) x 91 latitude rows. Each row is a run of
 * 4-char tokens: 2 chars lonStart (base 36) + 2 chars region number (base 36). */
export const FE_GRID_ROWS: readonly string[] = ${JSON.stringify(rows, null, 2)};
`;
writeFileSync(out, body);
console.log(
  `wrote ${out}: ${names.length} names, ${rows.length} rows, ${totalRuns} runs, ${body.length} bytes`,
);
