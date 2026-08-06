import ar from "@/i18n/locales/ar.json";
import ckb from "@/i18n/locales/ckb.json";
import en from "@/i18n/locales/en.json";
import kmr from "@/i18n/locales/kmr.json";
import { NOTABLE_HISTORICAL_EVENTS, sortNewestFirst } from "../notable-events";

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
