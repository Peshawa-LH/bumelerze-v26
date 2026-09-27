#!/usr/bin/env node
/**
 * Connection check for every station in assets/stations/live-stations.json:
 * asks each station's FDSN service for the last ten minutes, times the
 * answer, decodes it and reports how far behind real time the newest
 * sample is. Run it whenever the Live stations view looks wrong.
 *
 *   node scripts/check-live-stations.mjs
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
};
const WINDOW_MIN = Number(process.argv[2] ?? 10);

async function probe(st) {
  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_MIN * 60_000);
  const url = `${BASE[st.service]}/dataselect/1/query?net=${st.net}&sta=${st.sta}&cha=${st.channel}&start=${start.toISOString().slice(0, 19)}&end=${end.toISOString().slice(0, 19)}`;
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
  rows.push({ id: st.id, service: st.service, ...r });
  const tier = r.lag_s === null ? "  -  " : r.lag_s <= 600 ? "LIVE " : "delay";
  console.log(`${st.id.padEnd(9)} ${st.service.padEnd(10)} ${String(r.status).padStart(3)} ${String(r.ms).padStart(6)} ms ${String(r.bytes).padStart(8)} B  lag ${r.lag_s === null ? "   - " : String(r.lag_s).padStart(5)} s  ${tier}  ${r.note}`);
}
const live = rows.filter((r) => r.lag_s !== null && r.lag_s <= 600).length;
const any = rows.filter((r) => r.lag_s !== null).length;
console.log(`\n${rows.length} stations: ${live} live (<=10 min), ${any} with data in the last ${WINDOW_MIN} min, ${rows.filter((r) => r.status === 0 || r.status >= 400).length} errors/timeouts`);
