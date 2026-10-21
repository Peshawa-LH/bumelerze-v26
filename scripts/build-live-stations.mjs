#!/usr/bin/env node
/**
 * Builds assets/stations/live-stations.json — the curated catalogue of
 * open seismic stations the Sensor tab's "Live seismic stations" view
 * shows (research note 2026-09-27: EarthScope, KOERI and GEOFON FDSN
 * services, all open and CORS-enabled).
 *
 * Curation (owner, 2026-09-27: ~40 stations, every Iraqi one even when
 * silent): all of the Iraqi Seismic Observatory (MP); KOERI's KO stations
 * within KO_MAX_KM of Hawler; GE.ARPR and IU.GNI; the nearest few Caucasus
 * stations; and the one Raspberry Shake of the Kurdistan Educational Seismic
 * Observatory, at Tishk International University in Hawler (owner,
 * 2026-10-21). Each station is probed for data in the last hour so the map
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
  raspberryshake: "https://data.raspberryshake.org/fdsnws",
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

/** Raspberry Shake's server answers only the long parameter names (`net=`
 * gives 404) and is asked for the location code too; the app builds the
 * same URLs (src/features/stations/trace-transport.ts). */
function dataselectUrl(st, start, end) {
  const t = (d) => d.toISOString().slice(0, 19);
  if (st.service === "raspberryshake") {
    return `${SERVICES[st.service]}/dataselect/1/query?network=${st.net}&station=${st.sta}&location=${st.loc}&channel=${st.channel}&starttime=${t(start)}&endtime=${t(end)}`;
  }
  return `${SERVICES[st.service]}/dataselect/1/query?net=${st.net}&sta=${st.sta}&cha=${st.channel}&start=${t(start)}&end=${t(end)}`;
}

/** One Raspberry Shake channel's current epoch (the metadata line with no
 * end time), coordinates rounded to 5 decimals (~1 m; the service reports
 * float noise such as 36.16216216216216). */
async function raspberryShake(net, sta, loc, cha) {
  const body = await text(`${SERVICES.raspberryshake}/station/1/query?network=${net}&station=${sta}&location=${loc}&channel=${cha}&level=channel&format=text`);
  const lines = body.split("\n").filter((line) => line && !line.startsWith("#"));
  const current = lines.find((line) => line.split("|")[16] === "") ?? lines[lines.length - 1];
  if (!current) throw new Error(`no metadata for ${net}.${sta}`);
  const f = current.split("|");
  const round5 = (v) => Math.round(Number(v) * 1e5) / 1e5;
  return { id: `${net}.${sta}`, net, sta, loc, channel: cha, lat: round5(f[4]), lon: round5(f[5]), elevM: Number(f[6]), sps: Number(f[14]), service: "raspberryshake" };
}

async function lastSeen(st) {
  const end = new Date();
  const start = new Date(end.getTime() - 60 * 60 * 1000);
  const url = dataselectUrl(st, start, end);
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
// KESO: the Kurdistan Educational Seismic Observatory's Raspberry Shake 4D,
// hosted by Tishk International University (owner, 2026-10-21). EHZ is its
// velocity geophone (ENE/ENN/ENZ are the accelerometer). Its public archive
// runs ~30 min behind real time. Only this one Raspberry Shake: the data
// licence (https://raspberryshake.org/license/) asks for no "network"-style
// page of other people's Shakes.
{
  const keso = await raspberryShake("AM", "R079D", "00", "EHZ");
  picked.push({ ...keso, name: "Hawler, TIU", distanceKmFromErbil: Math.round(km(ERBIL, keso)), country: "IQ", operator: "Kurdistan Educational Seismic Observatory, Tishk International University", credit: "Kurdistan Educational Seismic Observatory via Raspberry Shake, S.A.", host: "tiu" });
}
for (const st of caucasus) picked.push({ ...withName(st), country: st.net === "AB" ? "AZ" : st.net === "GO" ? "GE" : "AM", operator: st.net === "AB" ? "RSSC Azerbaijan" : st.net === "GO" ? "NSMC Georgia" : "NSSP Armenia", credit: "via EarthScope" });

for (const st of picked) st.lastSeenAt = await lastSeen(st);
picked.sort((a, b) => a.distanceKmFromErbil - b.distanceKmFromErbil);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ builtAt: new Date().toISOString(), reference: ERBIL, stations: picked }, null, 2) + "\n");
const alive = picked.filter((s) => s.lastSeenAt).length;
console.log(`wrote ${OUT}: ${picked.length} stations (${alive} with data in the last 24 h)`);
for (const s of picked) console.log(`  ${s.id.padEnd(9)} ${String(s.distanceKmFromErbil).padStart(4)} km ${s.lastSeenAt ? "live " : "quiet"} ${s.name}`);
