import type { Event } from "@/features/events";

import { toEventRegistration } from "../event-registration";

const SAMPLE_EVENT: Event = {
  id: "us1000abcd",
  bumelerzeId: null,
  originTime: 1_700_000_000_000,
  lat: 35.56,
  lon: 45.43,
  depthKm: 10,
  magnitude: { value: 5.4, type: "mww" },
  placeName: "32 km SE of Halabja, Iraq",
  provenance: {
    provider: "usgs",
    providerId: "us1000abcd",
    fetchedAt: 1_700_000_050_000,
    providerUpdatedAt: 1_700_000_010_000,
  },
  sig: 400,
  isRegional: true,
  url: "https://earthquake.usgs.gov/earthquakes/eventpage/us1000abcd",
};

describe("toEventRegistration (pure Event -> EventRegistration mapper)", () => {
  it("maps every field the upsert_event_from_client RPC needs", () => {
    expect(toEventRegistration(SAMPLE_EVENT)).toEqual({
      provider: "usgs",
      providerId: "us1000abcd",
      originTime: 1_700_000_000_000,
      lat: 35.56,
      lon: 45.43,
      depthKm: 10,
      magnitude: 5.4,
      magType: "mww",
      placeName: "32 km SE of Halabja, Iraq",
    });
  });

  it("uses provenance.providerId, not the internal Event.id, for providerId", () => {
    // Today Event.id === provenance.providerId (types.ts's own comment
    // flags this as an implementation detail, not a guarantee) — this test
    // asserts against provenance.providerId specifically so it keeps
    // passing if that equality is ever broken by a future dedup/merge step.
    const merged: Event = { ...SAMPLE_EVENT, id: "internal-merged-uuid" };
    expect(toEventRegistration(merged).providerId).toBe("us1000abcd");
  });
});
