/**
 * Curated Historical View (lite) dataset — spec-v1.md §4.7: "list of seeded
 * historical + notable regional events... each linking to its (seeded)
 * shakemap in Event Detail." This is deliberately a small, hand-picked,
 * bundled list (not a live ComCat query) — the whole point of "lite" scope
 * (D11) is that this screen renders instantly offline; Event Detail's
 * existing `byId` deep-link path (features/events/queries.ts `useEventById`)
 * and `ShakeMapSection` do the live-data/shakemap work when the device has
 * connectivity.
 *
 * Every `id` below is a real USGS ComCat/fdsnws event id, individually
 * verified with a live `fdsnws/event/1/query?eventid=...` request during
 * this build (2026-08-06) — see the phase-3-historical wave notes for the
 * verification transcript. Do not add an id to this list without the same
 * verification; a wrong id would silently 404 (or worse, resolve to the
 * wrong earthquake) on Event Detail.
 *
 * `lat`/`lon` are the event's own epicenter (not a city) so `placeLine()`
 * (features/geo/place-line.ts) builds the localized "{distance} {direction}
 * of {city}, {region}" phrase from the bundled gazetteer at render time —
 * deliberately no stored English place string as the primary value (only
 * `placeName`, the required `placeLine` far-fallback for the two
 * Kahramanmaraş events, which sit ~450-590 km from the nearest gazetteer
 * city, past `NEAREST_CITY_FALLBACK_THRESHOLD_KM` — same fallback rule
 * every far-world event already uses elsewhere in the app).
 *
 * `noteKey` resolves to `historical.notes.<noteKey>` in the i18n catalogs —
 * one factual, non-dramatic line per event (PROJECT.md/vision.md trust
 * principle: no drama, no casualty numbers, just what/where/when context).
 */

export interface NotableHistoricalEvent {
  /** USGS ComCat/fdsnws event id — kept as this dataset's stable engine-
   * facing key (an engine script parses this file by regex for `id:` and
   * `magnitude:`/`lat:`/`lon:`, so this key is never renamed) and as
   * `Event Detail`'s `useEventById` cold-start fallback key when
   * `bumelerzeId` below can't be resolved. It is NO LONGER what
   * `/event/[id]` pushes for navigation — see `bumelerzeId`. */
  id: string;
  /** Canonical Bumelerze event id ("bml id" — migration 0025/0026),
   * verified against the live database for all eleven curated events
   * (owner directive 2026-09-02: "we cannot replicate their id or event
   * names" — USGS ids/names are provenance only, never our identity
   * surface). This is what `/event/[id]` pushes and what the header shows;
   * `id` above stays the fallback fetch key only. */
  bumelerzeId: string;
  /** Origin year, UTC — used for the list's newest-first ordering and the
   * row's localized year display. Kept as a plain field (not derived from
   * `originTime`) so the dataset stays trivially human-checkable. */
  year: number;
  /** Origin time, UTC ms — exact tie-break for same-year events (the 2023
   * Kahramanmaraş doublet) so ordering is deterministic, not just by year. */
  originTime: number;
  /** Moment magnitude (or the best-available USGS magnitude for
   * pre-instrumental/ISC-GEM entries — see `magnitudeType`). */
  magnitude: number;
  /** USGS `magType` for the record above (documentation only; the UI
   * displays the bare numeral via `events.magnitudeDisplay`, same as the
   * live feed, which likewise doesn't surface magType to users). */
  magnitudeType: string;
  lat: number;
  lon: number;
  /** `placeLine`'s required far-fallback string (features/geo/place-line.ts
   * `PlaceLineEvent.placeName`) — only rendered for events beyond the
   * gazetteer's 300 km localization radius (today: the two Kahramanmaraş
   * events). Every in-region event resolves through the gazetteer instead
   * and never reaches this string. */
  placeName: string;
  /** Suffix into `historical.notes.*` in the i18n catalogs. */
  noteKey: string;
  /** Optional `placeLine`'s `placeNameKey` override — only set for events
   * beyond `NEAREST_CITY_FALLBACK_THRESHOLD_KM` from every gazetteer city
   * (today: the 2023 Kahramanmaraş doublet, ~450-590 km away), where
   * `placeLine` would otherwise fall back to the raw English `placeName`
   * above. Suffix into `historical.places.*` in the i18n catalogs
   * (update-plan-2026-08.md §1.4 — no English leakage on this screen). */
  placeNameKey?: string;
}

/**
 * Chronological (oldest-first) source order — purely for human readability
 * while curating; the screen re-sorts newest-first per spec-v1.md §4.7's
 * "list ordered newest-first" instruction (see app/historical.tsx).
 */
export const NOTABLE_HISTORICAL_EVENTS: readonly NotableHistoricalEvent[] = [
  {
    id: "iscgem899464",
    bumelerzeId: "bml19440001",
    year: 1944,
    originTime: Date.UTC(1944, 6, 17, 10, 53, 49),
    magnitude: 5.99,
    magnitudeType: "mw",
    lat: 36.024,
    lon: 43.291,
    placeName: "Al-Hamdaniya, Iraq",
    noteKey: "hamdaniya1944",
  },
  {
    id: "iscgem898547",
    bumelerzeId: "bml19460001",
    year: 1946,
    originTime: Date.UTC(1946, 7, 17, 23, 37, 40),
    magnitude: 5.75,
    magnitudeType: "mw",
    lat: 35.666,
    lon: 46.107,
    placeName: "Baynjiwayn, Iraq",
    noteKey: "baynjiwayn1946",
  },
  {
    id: "iscgem884317",
    bumelerzeId: "bml19580001",
    year: 1958,
    originTime: Date.UTC(1958, 4, 5, 5, 21, 34),
    magnitude: 5.53,
    magnitudeType: "mw",
    lat: 35.644,
    lon: 44.668,
    placeName: "Jamjamal, Iraq",
    noteKey: "jamjamal1958",
  },
  {
    id: "iscgem839648",
    bumelerzeId: "bml19670001",
    year: 1967,
    originTime: Date.UTC(1967, 0, 11, 11, 20, 45),
    magnitude: 6.1,
    magnitudeType: "mw",
    lat: 34.052,
    lon: 45.708,
    placeName: "Mandali, Iraq",
    noteKey: "mandali1967",
  },
  {
    id: "usp0001bb6",
    bumelerzeId: "bml19800001",
    year: 1980,
    originTime: Date.UTC(1980, 11, 18, 12, 34, 15),
    magnitude: 5.8,
    magnitudeType: "ms",
    lat: 36.009,
    lon: 44.67,
    placeName: "Koysinceq (Koya), Iraq",
    noteKey: "koysinceq1980",
  },
  {
    id: "usp0004uk3",
    bumelerzeId: "bml19910001",
    year: 1991,
    originTime: Date.UTC(1991, 6, 24, 9, 45, 41),
    magnitude: 5.5,
    magnitudeType: "mw",
    lat: 36.52,
    lon: 44.066,
    placeName: "Aqrah, Iraq",
    noteKey: "aqrah1991",
  },
  {
    id: "us2000bmcg",
    bumelerzeId: "bml20170001",
    year: 2017,
    originTime: Date.UTC(2017, 10, 12, 18, 18, 17),
    magnitude: 7.3,
    magnitudeType: "mww",
    lat: 34.9109,
    lon: 45.9592,
    placeName: "Sarpol-e Zahab, Iran",
    noteKey: "halabja2017",
  },
  {
    id: "us1000ghda",
    bumelerzeId: "bml20180001",
    year: 2018,
    originTime: Date.UTC(2018, 7, 25, 18, 13, 25),
    magnitude: 6.0,
    magnitudeType: "mww",
    lat: 34.6111,
    lon: 46.2422,
    placeName: "Javanrud, Iran",
    noteKey: "javanrud2018",
  },
  {
    id: "us1000hwdw",
    bumelerzeId: "bml20180002",
    year: 2018,
    originTime: Date.UTC(2018, 10, 25, 18, 17, 32),
    magnitude: 6.3,
    magnitudeType: "mww",
    lat: 34.3609,
    lon: 45.7443,
    placeName: "Sarpol-e Zahab, Iran",
    noteKey: "sarpolEZahab2018",
  },
  {
    id: "us6000jllz",
    bumelerzeId: "bml20230001",
    year: 2023,
    originTime: Date.UTC(2023, 1, 6, 1, 17, 34),
    magnitude: 7.8,
    magnitudeType: "mww",
    lat: 37.2256,
    lon: 37.0143,
    placeName: "Pazarcık, Kahramanmaraş, Türkiye",
    noteKey: "pazarcik2023",
    placeNameKey: "historical.places.pazarcik2023",
  },
  {
    id: "us6000jlqa",
    bumelerzeId: "bml20230002",
    year: 2023,
    originTime: Date.UTC(2023, 1, 6, 10, 24, 48),
    magnitude: 7.5,
    magnitudeType: "mww",
    lat: 38.0106,
    lon: 37.1962,
    placeName: "Elbistan, Kahramanmaraş, Türkiye",
    noteKey: "elbistan2023",
    placeNameKey: "historical.places.elbistan2023",
  },
] as const;

/** Newest-first, per spec-v1.md §4.7 — the single sort the screen needs. */
export function sortNewestFirst(
  events: readonly NotableHistoricalEvent[],
): NotableHistoricalEvent[] {
  return [...events].sort((a, b) => b.originTime - a.originTime);
}

/**
 * `bumelerzeId -> provider id` alias map — the ONLY thing a bml-id
 * `/event/[id]` visit for one of these 11 curated events needs to reach its
 * bundled Atlas shakemap entry (`shakemap/atlas/index.ts`, generated,
 * unavoidably still keyed by provider id) without a network round trip.
 * Built once, module scope — this dataset is a small compile-time constant,
 * never re-created per render. Also used, in reverse spirit, by
 * `app/event/[id].tsx`'s cache lookup ("find the event in the cached feeds
 * by bumelerzeId or by alias").
 */
export const NOTABLE_PROVIDER_ID_BY_BUMELERZE_ID: ReadonlyMap<string, string> = new Map(
  NOTABLE_HISTORICAL_EVENTS.map((event) => [event.bumelerzeId, event.id]),
);

/** Reverse of the map above — `provider id -> bumelerzeId` — for the "old
 * link/notification carries a provider id" resolution direction. */
export const NOTABLE_BUMELERZE_ID_BY_PROVIDER_ID: ReadonlyMap<string, string> = new Map(
  NOTABLE_HISTORICAL_EVENTS.map((event) => [event.id, event.bumelerzeId]),
);
