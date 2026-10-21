#!/usr/bin/env node
/**
 * Connection check for every station in assets/stations/live-stations.json:
 * asks each station's FDSN service for the last ten minutes, times the
 * answer, decodes it and reports how far behind real time the newest
 * sample is. Run it whenever the Live stations view looks wrong.
 * A Raspberry Shake is asked for at least the last hour and counts as live
 * within an hour (its public archive runs ~30 min behind; the app's
 * freshness.ts), every other station within ten minutes.
 *
 *   node scripts/check-live-stations.mjs [minutes]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

globalThis.HTMLElement = class {};
globalThis.customElements = { define() {}, get() { return undefined; } };
globalThis.document = { createElement() { return {}; } };
const sp = await import("seisplotjs");

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, "..", "assets", "stations", "live-stations.json"), "utf8"));
const BASE = {
  earthscope: "https://service.earthscope.org/fdsnws",
  koeri: "https://eida.koeri.boun.edu.tr/fdsnws",
  geofon: "https://geofon.gfz.de/fdsnws",
  raspberryshake: "https://data.raspberryshake.org/fdsnws",
};
const WINDOW_MIN = Number(process.argv[2] ?? 10);
const LIVE_S = { raspberryshake: 3600 };
const liveS = (st) => LIVE_S[st.service] ?? 600;

/** The app's URLs (trace-transport.ts): long parameter names and the
 * location code for Raspberry Shake, whose server 404s on `net=`. */
function dataselectUrl(st, start, end) {
  const t = (d) => d.toISOString().slice(0, 19);
  if (st.service === "raspberryshake") {
    return `${BASE[st.service]}/dataselect/1/query?network=${st.net}&station=${st.sta}&location=${st.loc}&channel=${st.channel}&starttime=${t(start)}&endtime=${t(end)}`;
  }
  return `${BASE[st.service]}/dataselect/1/query?net=${st.net}&sta=${st.sta}&cha=${st.channel}&start=${t(start)}&end=${t(end)}`;
}

async function probe(st) {
  const end = new Date();
  const minutes = st.service === "raspberryshake" ? Math.max(WINDOW_MIN, 60) : WINDOW_MIN;
  const start = new Date(end.getTime() - minutes * 60_000);
  const url = dataselectUrl(st, start, end);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(45_000) });
    const ms = Date.now() - t0;
    if (r.status === 204) return { status: 204, ms, bytes: 0, lag_s: null, note: "no data in window" };
    if (!r.ok) return { status: r.status, ms, bytes: 0, lag_s: null, note: "error" };
    const buf = await r.arrayBuffer();
    let lag_s = null, sps = null, n = 0;
    try {
      const recs = sp.miniseed.parseDataRecords(buf);
      const seis = sp.miniseed.seismogramPerChannel(recs);
      let latest = 0;
      for (const s of seis) { for (const seg of s.segments) { latest = Math.max(latest, seg.endTime.toMillis()); n += seg.y.length; sps = seg.sampleRate; } }
      lag_s = latest ? Math.round((Date.now() - latest) / 1000) : null;
    } catch (e) { return { status: r.status, ms, bytes: buf.byteLength, lag_s: null, note: `decode failed: ${e.message}` }; }
    return { status: r.status, ms, bytes: buf.byteLength, lag_s, note: `${n} samples @${sps} sps` };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, bytes: 0, lag_s: null, note: e.name === "TimeoutError" ? "timeout 45 s" : e.message };
  }
}

const rows = [];
for (const st of catalog.stations) {
  const r = await probe(st);
  rows.push({ id: st.id, service: st.service, live_s: liveS(st), ...r });
  const tier = r.lag_s === null ? "  -  " : r.lag_s <= liveS(st) ? "LIVE " : "delay";
  console.log(`${st.id.padEnd(9)} ${st.service.padEnd(14)} ${String(r.status).padStart(3)} ${String(r.ms).padStart(6)} ms ${String(r.bytes).padStart(8)} B  lag ${r.lag_s === null ? "   - " : String(r.lag_s).padStart(5)} s  ${tier}  ${r.note}`);
}
const live = rows.filter((r) => r.lag_s !== null && r.lag_s <= r.live_s).length;
const any = rows.filter((r) => r.lag_s !== null).length;
console.log(`\n${rows.length} stations: ${live} live (<=10 min; Raspberry Shake <=60 min), ${any} with data in the last ${WINDOW_MIN} min (Raspberry Shake: ${Math.max(WINDOW_MIN, 60)} min), ${rows.filter((r) => r.status === 0 || r.status >= 400).length} errors/timeouts`);
