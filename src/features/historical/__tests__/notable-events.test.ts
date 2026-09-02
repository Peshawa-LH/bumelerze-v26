import ar from "@/i18n/locales/ar.json";
import ckb from "@/i18n/locales/ckb.json";
import en from "@/i18n/locales/en.json";
import kmr from "@/i18n/locales/kmr.json";
import {
  NOTABLE_BUMELERZE_ID_BY_PROVIDER_ID,
  NOTABLE_HISTORICAL_EVENTS,
  NOTABLE_PROVIDER_ID_BY_BUMELERZE_ID,
  sortNewestFirst,
} from "../notable-events";

/**
 * Dataset integrity checks for the curated Historical View (lite) list
 * (spec-v1.md §4.7 wave brief, point 5). Every id in this dataset was
 * individually verified against a live USGS fdsnws `eventid` query during
 * this build — these tests guard the *shape* invariants (uniqueness,
 * roughly-regional coordinates, note-key i18n coverage), not the
 * scientific IDs themselves, which is a human (Peshawa) review task.
 */
describe("NOTABLE_HISTORICAL_EVENTS", () => {
  it("is a non-trivial curated list, per the 'lite' scope (~8-12 events)", () => {
    expect(NOTABLE_HISTORICAL_EVENTS.length).toBeGreaterThanOrEqual(8);
    expect(NOTABLE_HISTORICAL_EVENTS.length).toBeLessThanOrEqual(12);
  });

  it("has unique USGS event ids", () => {
    const ids = NOTABLE_HISTORICAL_EVENTS.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has every id shaped like a real ComCat/fdsnws event id (network prefix + code)", () => {
    for (const event of NOTABLE_HISTORICAL_EVENTS) {
      expect(event.id).toMatch(/^[a-z0-9]+$/);
      expect(event.id.length).toBeGreaterThanOrEqual(8);
    }
  });

  it("keeps every event inside a generous Iraq/Zagros/East-Anatolian sanity bbox", () => {
    // Wide enough to cover the Kahramanmaraş doublet (lon ~37) through the
    // Iran border events (lon ~46) without being so loose it'd let a
    // data-entry error (wrong hemisphere, transposed lat/lon) slip through.
    for (const event of NOTABLE_HISTORICAL_EVENTS) {
      expect(event.lat).toBeGreaterThanOrEqual(30);
      expect(event.lat).toBeLessThanOrEqual(42);
      expect(event.lon).toBeGreaterThanOrEqual(35);
      expect(event.lon).toBeLessThanOrEqual(50);
    }
  });

  it("has a plausible year for every event (1900-present, per the §4.7 framing)", () => {
    const currentYear = new Date().getUTCFullYear();
    for (const event of NOTABLE_HISTORICAL_EVENTS) {
      expect(event.year).toBeGreaterThanOrEqual(1900);
      expect(event.year).toBeLessThanOrEqual(currentYear);
    }
  });

  it("has a magnitude in a plausible felt-earthquake range", () => {
    for (const event of NOTABLE_HISTORICAL_EVENTS) {
      expect(event.magnitude).toBeGreaterThanOrEqual(5.0);
      expect(event.magnitude).toBeLessThanOrEqual(9.0);
    }
  });

  it("has a `year` that agrees with `originTime`'s UTC year", () => {
    for (const event of NOTABLE_HISTORICAL_EVENTS) {
      const utcYear = new Date(event.originTime).getUTCFullYear();
      expect(utcYear).toBe(event.year);
    }
  });

  it("has a non-empty placeName fallback for every event", () => {
    for (const event of NOTABLE_HISTORICAL_EVENTS) {
      expect(event.placeName.length).toBeGreaterThan(0);
    }
  });

  it("has a noteKey that resolves to a real string in all four locale catalogs", () => {
    const catalogs = { en, ckb, kmr, ar } as const;
    for (const event of NOTABLE_HISTORICAL_EVENTS) {
      for (const catalog of Object.values(catalogs)) {
        const notes = (catalog as { historical: { notes: Record<string, string> } })
          .historical.notes;
        expect(typeof notes[event.noteKey]).toBe("string");
        expect(notes[event.noteKey]?.length).toBeGreaterThan(0);
      }
    }
  });

  it("has no unused note keys in the catalog (every catalog note is referenced by some event)", () => {
    const noteKeysInDataset = new Set(
      NOTABLE_HISTORICAL_EVENTS.map((event) => event.noteKey),
    );
    const catalogNoteKeys = Object.keys(en.historical.notes);
    expect(new Set(catalogNoteKeys)).toEqual(noteKeysInDataset);
  });

  it("has a localized event NAME (historical.eventNames.<noteKey>) in all four locale catalogs, for every event (update-plan-2026-08.md §1.4)", () => {
    const catalogs = { en, ckb, kmr, ar } as const;
    for (const event of NOTABLE_HISTORICAL_EVENTS) {
      for (const catalog of Object.values(catalogs)) {
        const eventNames = (
          catalog as { historical: { eventNames: Record<string, string> } }
        ).historical.eventNames;
        expect(typeof eventNames[event.noteKey]).toBe("string");
        expect(eventNames[event.noteKey]?.length).toBeGreaterThan(0);
      }
    }
  });

  it("has no unused eventName keys in the catalog (every catalog eventName is referenced by some event)", () => {
    const noteKeysInDataset = new Set(
      NOTABLE_HISTORICAL_EVENTS.map((event) => event.noteKey),
    );
    const catalogEventNameKeys = Object.keys(en.historical.eventNames);
    expect(new Set(catalogEventNameKeys)).toEqual(noteKeysInDataset);
  });

  it("only sets placeNameKey for events beyond the gazetteer's fallback radius (today: the 2023 Kahramanmaraş doublet), and every placeNameKey resolves in all four locale catalogs", () => {
    const catalogs = { en, ckb, kmr, ar } as const;
    const eventsWithPlaceNameKey = NOTABLE_HISTORICAL_EVENTS.filter(
      (event) => event.placeNameKey !== undefined,
    );
    expect(eventsWithPlaceNameKey.map((event) => event.id).sort()).toEqual(
      ["us6000jllz", "us6000jlqa"].sort(),
    );

    for (const event of eventsWithPlaceNameKey) {
      const suffix = event.placeNameKey?.replace("historical.places.", "");
      expect(suffix).toBeTruthy();
      for (const catalog of Object.values(catalogs)) {
        const places = (catalog as { historical: { places: Record<string, string> } })
          .historical.places;
        expect(typeof places[suffix as string]).toBe("string");
        expect(places[suffix as string]?.length).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * Bumelerze identity (owner directive 2026-09-02: "we sometimes use the
 * USGS ids and the USGS-assigned name for events; we have to fix this...
 * we cannot replicate their id or event names"). Verified mapping against
 * the live database — see the task brief this wave shipped from.
 */
describe("NOTABLE_HISTORICAL_EVENTS bumelerzeId mapping", () => {
  const EXPECTED_MAPPING: Readonly<Record<string, string>> = {
    iscgem899464: "bml19440001",
    iscgem898547: "bml19460001",
    iscgem884317: "bml19580001",
    iscgem839648: "bml19670001",
    usp0001bb6: "bml19800001",
    usp0004uk3: "bml19910001",
    us2000bmcg: "bml20170001",
    us1000ghda: "bml20180001",
    us1000hwdw: "bml20180002",
    us6000jllz: "bml20230001",
    us6000jlqa: "bml20230002",
  };

  it("has exactly the verified bml id for every one of the 11 curated events", () => {
    expect(NOTABLE_HISTORICAL_EVENTS).toHaveLength(Object.keys(EXPECTED_MAPPING).length);
    for (const event of NOTABLE_HISTORICAL_EVENTS) {
      expect(event.bumelerzeId).toBe(EXPECTED_MAPPING[event.id]);
    }
  });

  it("has unique bml ids (one per physical event, migration 0008's own uniqueness rule)", () => {
    const bmlIds = NOTABLE_HISTORICAL_EVENTS.map((event) => event.bumelerzeId);
    expect(new Set(bmlIds).size).toBe(bmlIds.length);
  });

  it("has every bml id shaped like a canonical Bumelerze id (bml + 4-digit year + base-36 suffix)", () => {
    for (const event of NOTABLE_HISTORICAL_EVENTS) {
      expect(event.bumelerzeId).toMatch(/^bml\d{4}[0-9a-z]{4,}$/);
    }
  });

  it("builds a complete, bijective provider-id <-> bml-id alias map", () => {
    expect(NOTABLE_PROVIDER_ID_BY_BUMELERZE_ID.size).toBe(NOTABLE_HISTORICAL_EVENTS.length);
    expect(NOTABLE_BUMELERZE_ID_BY_PROVIDER_ID.size).toBe(NOTABLE_HISTORICAL_EVENTS.length);
    for (const event of NOTABLE_HISTORICAL_EVENTS) {
      expect(NOTABLE_PROVIDER_ID_BY_BUMELERZE_ID.get(event.bumelerzeId)).toBe(event.id);
      expect(NOTABLE_BUMELERZE_ID_BY_PROVIDER_ID.get(event.id)).toBe(event.bumelerzeId);
    }
  });
});

describe("sortNewestFirst", () => {
  it("orders events by originTime descending, without mutating the input", () => {
    const sorted = sortNewestFirst(NOTABLE_HISTORICAL_EVENTS);

    expect(sorted).toHaveLength(NOTABLE_HISTORICAL_EVENTS.length);
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      if (previous && current) {
        expect(previous.originTime).toBeGreaterThanOrEqual(current.originTime);
      }
    }

    // Original array order is untouched (source data stays chronological,
    // oldest-first, for human readability while curating).
    expect(NOTABLE_HISTORICAL_EVENTS[0]?.id).toBe("iscgem899464");
  });

  it("puts the most recent event (2023 Kahramanmaraş doublet) first, larger shock first", () => {
    const sorted = sortNewestFirst(NOTABLE_HISTORICAL_EVENTS);
    expect(sorted[0]?.id).toBe("us6000jlqa"); // Elbistan — later same-day shock
    expect(sorted[1]?.id).toBe("us6000jllz"); // Pazarcık — earlier same-day, larger
  });
});
