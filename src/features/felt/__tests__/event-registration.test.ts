import type { Event } from "@/features/events";
import { placeLine } from "@/features/geo/place-line";
import i18n from "@/i18n";

import { registrationPlaceName, toEventRegistration } from "../event-registration";

const SAMPLE_EVENT: Event = {
  id: "us1000abcd",
  bumelerzeId: null,
  originTime: 1_700_000_000_000,
  lat: 35.56,
  lon: 45.43,
  depthKm: 10,
  magnitude: { value: 5.4, type: "mww" },
  placeName: "IRAQ",
  provenance: {
    provider: "emsc",
    providerId: "20231114_0000042",
    fetchedAt: 1_700_000_050_000,
    providerUpdatedAt: 1_700_000_010_000,
  },
  sig: 400,
  isRegional: true,
  url: "https://www.emsc-csem.org/Earthquake/earthquake.php?id=1",
};

describe("toEventRegistration (pure Event -> EventRegistration mapper)", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("maps every field the upsert_event_from_client RPC needs", () => {
    expect(toEventRegistration(SAMPLE_EVENT)).toEqual({
      provider: "emsc",
      providerId: "20231114_0000042",
      originTime: 1_700_000_000_000,
      lat: 35.56,
      lon: 45.43,
      depthKm: 10,
      magnitude: 5.4,
      magType: "mww",
      placeName: registrationPlaceName(SAMPLE_EVENT),
    });
  });

  it("uses provenance.providerId, not the internal Event.id, for providerId", () => {
    // Today Event.id === provenance.providerId (types.ts's own comment
    // flags this as an implementation detail, not a guarantee) — this test
    // asserts against provenance.providerId specifically so it keeps
    // passing if that equality is ever broken by a future dedup/merge step.
    const merged: Event = { ...SAMPLE_EVENT, id: "internal-merged-uuid" };
    expect(toEventRegistration(merged).providerId).toBe("20231114_0000042");
  });

  it("carries the app's own place line, never the agency's raw region (review A-20)", () => {
    const { placeName } = toEventRegistration(SAMPLE_EVENT);
    expect(placeName).not.toBe("IRAQ");
    // The same line every screen shows, without the invisible bidi isolates
    // the on-screen line carries round its numerals.
    expect(placeName).toBe(
      placeLine(SAMPLE_EVENT, "en", i18n.getFixedT("en")).replace(/[⁦-⁩]/g, ""),
    );
    expect(placeName).toBe("0.0 km N of Slemani, Kurdistan (Iraq)");
    expect(placeName).not.toMatch(/[⁦-⁩]/);
    expect(placeName.length).toBeLessThanOrEqual(200); // the server's limit
  });

  it("the place line is English whatever language the reporter uses (one shared registry)", async () => {
    const english = registrationPlaceName(SAMPLE_EVENT);
    await i18n.changeLanguage("ckb");
    expect(registrationPlaceName(SAMPLE_EVENT)).toBe(english);
    expect(english).not.toMatch(/[؀-ۿ]/);
  });
});
