#!/usr/bin/env node
// One-off: place names for EMSC events that were created without one
// (review finding D-11: 61 events of 2026-08-24 .. 2026-09-06, backfilled on
// 2026-09-19 with an empty payload, so nothing in the database can fill
// them). Fetches each event from the EMSC FDSN event service and prints an
// idempotent SQL file; it never touches the database itself. The lead
// reviews the SQL and applies it in the SQL editor.
//
// Usage:
//   node scripts/ops/backfill-emsc-places.mjs ids.json > places.sql
//   node scripts/ops/backfill-emsc-places.mjs ids.json --with-payload --delay-ms 250 --out places.sql
//
// ids.json: a JSON array of provider_event_ids ("20260824_0000123", EMSC's
// unid, which is what event_source_records.provider_event_id holds for
// provider emsc), or the SQL editor's JSON download of
//   select s.provider_event_id from public.events e
//     join public.event_source_records s on s.event_id = e.event_id
//    where s.provider = 'emsc' and (e.place is null or btrim(e.place) = '');
// (an array of objects with a provider_event_id key).
//
// Output, per id: one update of events.place (joined through the emsc
// source record; only where the place is still empty) and one of the
// source record's parsed_place (so a later derivation keeps the name).
// --with-payload also fills raw_payload with the fetched GeoJSON feature,
// only where it is still '{}'. Unknown ids (EMSC answers 204) and events
// without a region name become full-line comments.
//
// SQL rules of this repo's one-line apply step: full-line comments only,
// ASCII only (non-ASCII becomes a U&'' literal), no question marks.
// Polite to EMSC: one request at a time, 200 ms apart by default.

import { readFileSync, writeFileSync } from "node:fs";

const EMSC_URL = "https://www.seismicportal.eu/fdsnws/event/1/query";

function usage(message) {
  process.stderr.write(`backfill-emsc-places: ${message}\n`);
  process.stderr.write(
    "usage: node scripts/ops/backfill-emsc-places.mjs ids.json [--out file.sql] [--delay-ms 200] [--with-payload]\n",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const options = { input: null, out: null, delayMs: 200, withPayload: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      options.out = argv[++i] ?? usage("--out needs a file name");
    } else if (arg === "--delay-ms") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value < 0) usage("--delay-ms needs a number");
      options.delayMs = value;
    } else if (arg === "--with-payload") {
      options.withPayload = true;
    } else if (arg.startsWith("--")) {
      usage(`unknown option ${arg}`);
    } else if (options.input === null) {
      options.input = arg;
    } else {
      usage("one input file only");
    }
  }
  if (options.input === null) usage("an ids.json file is needed");
  return options;
}

/** Accepts ["id", ...] or [{ provider_event_id: "id" }, ...]; keeps order, drops duplicates. */
export function readIds(json) {
  const data = JSON.parse(json);
  if (!Array.isArray(data)) throw new Error("ids.json must hold a JSON array");
  const ids = [];
  for (const entry of data) {
    const id =
      typeof entry === "string"
        ? entry
        : entry &&
            typeof entry === "object" &&
            typeof entry.provider_event_id === "string"
          ? entry.provider_event_id
          : null;
    if (id === null) throw new Error(`unreadable entry: ${JSON.stringify(entry)}`);
    const trimmed = id.trim();
    if (!/^[0-9A-Za-z_.-]{1,64}$/.test(trimmed))
      throw new Error(`not an EMSC event id: ${id}`);
    if (!ids.includes(trimmed)) ids.push(trimmed);
  }
  return ids;
}

/** A SQL string literal: plain '...' for ASCII, U&'...' with \XXXX escapes otherwise. */
export function sqlLiteral(value) {
  if (/^[\x20-\x7e]*$/.test(value)) {
    return `'${value.replace(/'/g, "''")}'`;
  }
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0);
    if (char === "'") out += "''";
    else if (char === "\\") out += "\\\\";
    else if (code >= 0x20 && code <= 0x7e) out += char;
    else if (code <= 0xffff) out += `\\${code.toString(16).padStart(4, "0")}`;
    else out += `\\+${code.toString(16).padStart(6, "0")}`;
  }
  return `U&'${out}'`;
}

/** The region name of one EMSC GeoJSON feature, or null. */
export function placeOf(feature) {
  const region = feature?.properties?.flynn_region;
  if (typeof region !== "string") return null;
  const trimmed = region.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The SQL for one event; `feature` null means EMSC does not know the id. */
export function statementsFor(id, feature, { withPayload = false } = {}) {
  const idLit = sqlLiteral(id);
  if (feature === null) {
    return [`-- ${id}: not found at EMSC (204), nothing to do`];
  }
  const place = placeOf(feature);
  if (place === null) {
    return [`-- ${id}: EMSC lists no region name, nothing to do`];
  }
  const placeLit = sqlLiteral(place);
  const lines = [
    `update public.events e set place = ${placeLit} from public.event_source_records s where s.event_id = e.event_id and s.provider = 'emsc' and s.provider_event_id = ${idLit} and (e.place is null or btrim(e.place) = '');`,
    `update public.event_source_records set parsed_place = ${placeLit} where provider = 'emsc' and provider_event_id = ${idLit} and (parsed_place is null or btrim(parsed_place) = '');`,
  ];
  if (withPayload) {
    const payload = JSON.stringify(feature);
    lines.push(
      `update public.event_source_records set raw_payload = ${sqlLiteral(payload)}::jsonb where provider = 'emsc' and provider_event_id = ${idLit} and raw_payload = '{}'::jsonb;`,
    );
  }
  return lines;
}

async function fetchFeature(id) {
  const url = `${EMSC_URL}?eventid=${encodeURIComponent(id)}&format=json`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`${id}: EMSC answered ${response.status}`);
  const text = await response.text();
  if (text.trim() === "") return null;
  const data = JSON.parse(text);
  // eventid= answers a single Feature; a collection is tolerated too.
  if (data?.type === "FeatureCollection") return data.features?.[0] ?? null;
  return data?.type === "Feature" ? data : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const ids = readIds(readFileSync(options.input, "utf8"));
  const lines = [
    `-- EMSC place names for ${ids.length} events, fetched ${new Date().toISOString()}`,
    "-- by scripts/ops/backfill-emsc-places.mjs (review finding D-11). Idempotent:",
    "-- each statement only fills a value that is still empty.",
  ];
  let filled = 0;
  let missing = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    if (i > 0) await sleep(options.delayMs);
    let feature;
    try {
      feature = await fetchFeature(id);
    } catch (error) {
      lines.push(
        `-- ${id}: fetch failed (${error instanceof Error ? error.message : String(error)}), run again for this id`,
      );
      missing += 1;
      continue;
    }
    const statements = statementsFor(id, feature, { withPayload: options.withPayload });
    if (statements[0].startsWith("--")) missing += 1;
    else filled += 1;
    lines.push(...statements);
    process.stderr.write(
      `${i + 1}/${ids.length} ${id} ${feature ? (placeOf(feature) ?? "(no region)") : "(not found)"}\n`,
    );
  }
  lines.push(`-- done: ${filled} with a place, ${missing} without`);
  const sql = lines.join("\n") + "\n";
  if (options.out) {
    writeFileSync(options.out, sql);
    process.stderr.write(`wrote ${options.out}\n`);
  } else {
    process.stdout.write(sql);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    process.stderr.write(
      `backfill-emsc-places: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
