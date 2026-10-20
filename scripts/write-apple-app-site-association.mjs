#!/usr/bin/env node
/*
 * The apple-app-site-association file for app.bumelerze.com (iOS).
 *
 * With it (and the Associated Domains entitlement the iOS build gets from
 * EXPO_APPLE_TEAM_ID in app.config.ts):
 * - applinks: a link to one of the app's shareable pages opens the installed
 *   iPhone app instead of Safari (the app reads it in app/+native-intent.tsx);
 *   every other address (the start page, static files, /data/...) stays on
 *   the web;
 * - webcredentials: passwords saved for app.bumelerze.com are offered in the
 *   app's sign-in, and the other way round.
 *
 * It needs the Apple Developer Team ID, which does not exist yet, so
 * scripts/build-app-web.sh calls this only when APPLE_TEAM_ID is set.
 *
 *   node scripts/write-apple-app-site-association.mjs <outDir> <teamId>
 *       writes <outDir>/.well-known/apple-app-site-association and adds its
 *       JSON content type to <outDir>/_headers (Cloudflare Pages)
 *   node scripts/write-apple-app-site-association.mjs --print <teamId>
 *       prints the file only
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** `ios.bundleIdentifier` in app.config.ts. */
export const BUNDLE_ID = "org.bumelerze.app";

export const AASA_PATH = ".well-known/apple-app-site-association";

/**
 * The shareable pages (src/config/urls.ts): the short event link, the event
 * page and its hub, public profiles, and the family join link (its code and
 * key are in the query, which any value matches).
 */
export const APP_LINK_COMPONENTS = [
  { "/": "/e/*", comment: "Shared earthquake links" },
  { "/": "/event/*", comment: "Earthquake pages" },
  { "/": "/event-hub/*", comment: "Event hubs" },
  { "/": "/u/*", comment: "Public profiles" },
  { "/": "/home/join", comment: "Family join links" },
];

/** The rule Cloudflare Pages reads from _headers: Apple expects JSON. */
export const AASA_HEADERS_RULE = `\n/${AASA_PATH}\n  Content-Type: application/json\n`;

/** A Team ID is ten capital letters and digits. */
export function isTeamId(value) {
  return typeof value === "string" && /^[A-Z0-9]{10}$/.test(value);
}

export function buildAppleAppSiteAssociation(teamId) {
  if (!isTeamId(teamId)) {
    throw new Error(`not an Apple Team ID (ten capital letters and digits): ${teamId}`);
  }
  const appId = `${teamId}.${BUNDLE_ID}`;
  return {
    applinks: {
      details: [{ appIDs: [appId], components: APP_LINK_COMPONENTS }],
    },
    webcredentials: { apps: [appId] },
  };
}

export function serialize(teamId) {
  return `${JSON.stringify(buildAppleAppSiteAssociation(teamId), null, 2)}\n`;
}

export function writeAppleAppSiteAssociation(outDir, teamId) {
  const text = serialize(teamId);
  const file = path.join(outDir, AASA_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  fs.appendFileSync(path.join(outDir, "_headers"), AASA_HEADERS_RULE);
  return file;
}

function main(argv) {
  const [first, second] = argv;
  if (first === "--print" && second) {
    process.stdout.write(serialize(second));
    return 0;
  }
  if (first && second) {
    if (!fs.existsSync(path.join(first, "_headers"))) {
      throw new Error(`${first}/_headers is missing: export the app first`);
    }
    const file = writeAppleAppSiteAssociation(first, second);
    console.log(`write-apple-app-site-association: wrote ${file}`);
    return 0;
  }
  console.error(
    "usage: write-apple-app-site-association.mjs <outDir> <teamId> | --print <teamId>",
  );
  return 2;
}

const isCli =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`write-apple-app-site-association: ${error.message}`);
    process.exitCode = 1;
  }
}
