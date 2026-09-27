/** One row of `assets/stations/live-stations.json` (scripts/build-live-stations.mjs). */
export interface LiveStation {
  /** "NET.STA", e.g. "MP.KIR1". */
  id: string;
  net: string;
  sta: string;
  name: string;
  /** Preferred vertical channel: HHZ where it exists, else BHZ. */
  channel: string;
  sps: number;
  lat: number;
  lon: number;
  elevM: number;
  /** Which FDSN service serves this station's waveforms. */
  service: "earthscope" | "koeri" | "geofon";
  country: string;
  operator: string;
  /** Verbatim credit line shown with the trace. */
  credit: string;
  distanceKmFromErbil: number;
  /** When the catalogue build last found data (24 h probe), or null. */
  lastSeenAt: string | null;
}

export interface LiveStationCatalog {
  builtAt: string;
  reference: { lat: number; lon: number };
  stations: LiveStation[];
}

/** live ≤ 10 min behind (owner, 2026-09-27: "within 10 minutes counts"),
 * recent ≤ 24 h, silent beyond that; unknown until the first fetch. */
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
