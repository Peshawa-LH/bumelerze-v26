import type { Event } from "@/features/events/types";
import { parseIntensityContours } from "@/features/shakemap/contours";

import bandsIa from "./bml202602ia.bands_mi.json";

/** A small earthquake near Urmia (real Bumelerze Atlas event bml202602ia). */
export const URMIA_EVENT: Event = {
  id: "gfz2026tksc",
  bumelerzeId: "bml202602ia",
  originTime: Date.parse("2026-10-05T12:59:41.760Z"),
  lat: 38.2751,
  lon: 45.1871,
  depthKm: 10,
  magnitude: { value: 3.2, type: "Mw" },
  placeName: "NORTHWESTERN IRAN",
  provenance: {
    provider: "geofon",
    providerId: "gfz2026tksc",
    fetchedAt: Date.parse("2026-10-05T13:10:00Z"),
    providerUpdatedAt: Date.parse("2026-10-05T13:08:00Z"),
  },
  sig: 160,
  isRegional: true,
  url: "https://geofon.gfz.de/",
};

export const URMIA_CONTOURS = parseIntensityContours(bandsIa);

/** A moderate earthquake inside the Kurdistan Region, for the no-shakemap card. */
export const SULAIMANI_EVENT: Event = {
  ...URMIA_EVENT,
  id: "us7000test",
  bumelerzeId: "bml202699zz",
  lat: 35.5608,
  lon: 45.4329,
  magnitude: { value: 4.6, type: "mb" },
  provenance: { ...URMIA_EVENT.provenance, provider: "usgs", providerId: "us7000test" },
};
