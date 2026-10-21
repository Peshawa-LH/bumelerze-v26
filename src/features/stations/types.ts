/** One row of `assets/stations/live-stations.json` (scripts/build-live-stations.mjs). */
export interface LiveStation {
  /** "NET.STA", e.g. "MP.KIR1". */
  id: string;
  net: string;
  sta: string;
  name: string;
  /** FDSN location code, when the service needs it named ("00" for the
   * Raspberry Shake); the other services are asked without one. */
  loc?: string;
  /** Preferred vertical channel: HHZ where it exists, else BHZ; EHZ (the
   * geophone) on a Raspberry Shake. */
  channel: string;
  sps: number;
  lat: number;
  lon: number;
  elevM: number;
  /** Which FDSN service serves this station's waveforms. */
  service: "earthscope" | "koeri" | "geofon" | "raspberryshake";
  country: string;
  operator: string;
  /** Verbatim credit line shown with the trace. */
  credit: string;
  /** Who hosts the instrument, when that is credited too: the key of a
   * localised line under `stations.hostedBy` (e.g. "tiu"). */
  host?: string;
  distanceKmFromErbil: number;
  /** When the catalogue build last found data (24 h probe), or null. */
  lastSeenAt: string | null;
}

export interface LiveStationCatalog {
  builtAt: string;
  reference: { lat: number; lon: number };
  stations: LiveStation[];
}

/** live ≤ 10 min behind (owner, 2026-09-27: "within 10 minutes counts";
 * ≤ 60 min for a Raspberry Shake, whose public archive runs ~30 min behind,
 * see `freshness.ts`), recent ≤ 24 h, silent beyond that; unknown until the
 * first fetch. */
export type StationFreshness = "live" | "recent" | "silent" | "unknown";

/** Decoded vertical-channel trace: raw counts, evenly sampled. */
export interface StationTrace {
  stationId: string;
  channel: string;
  sps: number;
  /** Unix ms of `samples[0]`. */
  startMs: number;
  /** Unix ms of the last sample. */
  endMs: number;
  samples: number[];
}
