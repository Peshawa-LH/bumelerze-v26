#!/usr/bin/env node
/**
 * Builds assets/stations/live-stations.json — the curated catalogue of
 * open seismic stations the Sensor tab's "Live seismic stations" view
 * shows (research note 2026-09-27: EarthScope, KOERI and GEOFON FDSN
 * services, all open and CORS-enabled).
 *
 * Curation (owner, 2026-09-27: ~40 stations, every Iraqi one even when
 * silent): all of the Iraqi Seismic Observatory (MP); KOERI's KO stations
 * within KO_MAX_KM of Erbil; GE.ARPR and IU.GNI; the nearest few Caucasus
 * stations. Each station is probed for data in the last 24 h so the map
 * can grey the silent ones at first paint; the app re-checks on tap.
 *
 *   node scripts/build-live-stations.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "stations", "live-stations.json");
const ERBIL = { lat: 36.19, lon: 44.01 };
const KO_MAX_KM = 450;
const CAUCASUS_TAKE = 6;
const SERVICES = {
  earthscope: "https://service.earthscope.org/fdsnws",
  koeri: "https://eida.koeri.boun.edu.tr/fdsnws",
  geofon: "https://geofon.gfz.de/fdsnws",
};
const BBOX = "minlatitude=28&maxlatitude=42&minlongitude=36&maxlongitude=52";

function km(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function text(url) {
  const r = await fetch(url, { redirect: "follow" });
  if (r.status === 204) return "";
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

/** FDSN station text (level=channel) → one entry per station with the
 * preferred vertical channel (HHZ over BHZ). */
async function channels(service, query) {
  const body = await text(`${SERVICES[service]}/station/1/query?${query}&channel=HHZ,BHZ&level=channel&format=text&includerestricted=false&endafter=2026-01-01`);
  const byStation = new Map();
  for (const line of body.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const f = line.split("|");
    const [net, sta, , cha, lat, lon, elev] = f;
    const sps = Number(f[14]);
    const key = `${net}.${sta}`;
    const prev = byStation.get(key);
    if (prev && prev.channel === "HHZ") continue;
    byStation.set(key, { id: key, net, sta, channel: cha, lat: Number(lat), lon: Number(lon), elevM: Number(elev), sps, service });
  }
  return byStation;
}

async function names(service, net) {
  const body = await text(`${SERVICES[service]}/station/1/query?network=${net}&level=station&format=text&includerestricted=false`);
  const out = new Map();
  for (const line of body.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const f = line.split("|");
    out.set(`${f[0]}.${f[1]}`, f[5]);
  }
  return out;
}

async function lastSeen(st) {
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 3600 * 1000);
  const url = `${SERVICES[st.service]}/dataselect/1/query?net=${st.net}&sta=${st.sta}&cha=${st.channel}&start=${start.toISOString().slice(0, 19)}&end=${end.toISOString().slice(0, 19)}`;
  try {
    const r = await fetch(url, { method: "GET", redirect: "follow" });
    if (r.status === 204) return null;
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    return buf.byteLength > 0 ? end.toISOString() : null;
  } catch {
    return null;
  }
}

const earth = await channels("earthscope", `${BBOX}&network=MP,IU,GE,A2,A0,AB,GO`);
const ko = await channels("koeri", `${BBOX}&network=KO`);
const nameMaps = new Map();
for (const [service, net] of [["earthscope", "MP"], ["earthscope", "IU"], ["earthscope", "GE"], ["earthscope", "A2"], ["earthscope", "A0"], ["earthscope", "AB"], ["earthscope", "GO"], ["koeri", "KO"]]) {
  nameMaps.set(`${service}:${net}`, await names(service, net));
}
const withName = (st) => ({ ...st, name: nameMaps.get(`${st.service}:${st.net}`)?.get(st.id) ?? st.sta, distanceKmFromErbil: Math.round(km(ERBIL, st)) });

const picked = [];
for (const st of earth.values()) if (st.net === "MP") picked.push({ ...withName(st), country: "IQ", operator: "Iraqi Seismic Observatory", credit: "Iraqi Seismic Observatory via EarthScope" });
for (const st of ko.values()) if (km(ERBIL, st) <= KO_MAX_KM) picked.push({ ...withName(st), country: "TR", operator: "KOERI", credit: "Kandilli Observatory (KOERI) via EIDA" });
{ const gni = earth.get("IU.GNI"); if (gni) picked.push({ ...withName(gni), country: "AM", operator: "IRIS/USGS GSN", credit: "GSN via EarthScope" }); }
// GE.ARPR is served by GEOFON itself (its EarthScope mirror lists no current BH/HH channel).
const geofon = await channels("geofon", `${BBOX}&network=GE`);
nameMaps.set("geofon:GE", await names("geofon", "GE"));
{ const arpr = geofon.get("GE.ARPR"); if (arpr) picked.push({ ...withName(arpr), country: "TR", operator: "GEOFON", credit: "GEOFON (GFZ)" }); }
const caucasus = [...earth.values()].filter((st) => ["A2", "A0", "AB", "GO"].includes(st.net)).sort((a, b) => km(ERBIL, a) - km(ERBIL, b)).slice(0, CAUCASUS_TAKE);
for (const st of caucasus) picked.push({ ...withName(st), country: st.net === "AB" ? "AZ" : st.net === "GO" ? "GE" : "AM", operator: st.net === "AB" ? "RSSC Azerbaijan" : st.net === "GO" ? "NSMC Georgia" : "NSSP Armenia", credit: "via EarthScope" });

for (const st of picked) st.lastSeenAt = await lastSeen(st);
picked.sort((a, b) => a.distanceKmFromErbil - b.distanceKmFromErbil);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ builtAt: new Date().toISOString(), reference: ERBIL, stations: picked }, null, 2) + "\n");
const alive = picked.filter((s) => s.lastSeenAt).length;
console.log(`wrote ${OUT}: ${picked.length} stations (${alive} with data in the last 24 h)`);
for (const s of picked) console.log(`  ${s.id.padEnd(9)} ${String(s.distanceKmFromErbil).padStart(4)} km ${s.lastSeenAt ? "live " : "quiet"} ${s.name}`);
