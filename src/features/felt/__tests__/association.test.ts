import type { Event } from "@/features/events";
import { resolveHomeFeltAssociation } from "../association";

/**
 * Home-pill event-association rule (wave brief point 4 / scope item 6):
 * "associated to the most recent regional event within the last hour if one
 * exists, else stored unassociated".
 */

const NOW = 1_700_000_000_000;

function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: "evt-default",
    bumelerzeId: null,
    originTime: NOW,
    lat: 36.19,
    lon: 44.01,
    depthKm: 10,
    magnitude: { value: 4.0, type: "mb" },
    placeName: "Erbil, Iraq",
    provenance: {
      provider: "usgs",
      providerId: "evt-default",
      fetchedAt: NOW,
      providerUpdatedAt: NOW,
    },
    sig: 300,
    isRegional: true,
    url: "https://earthquake.usgs.gov/earthquakes/eventpage/evt-default",
    ...overrides,
  };
}

describe("resolveHomeFeltAssociation", () => {
  it("returns null when there are no events at all", () => {
    expect(resolveHomeFeltAssociation([], NOW)).toBeNull();
  });

  it("returns null when the only events are non-regional (world catalog)", () => {
    const events = [
      makeEvent({ id: "world-1", isRegional: false, originTime: NOW - 60_000 }),
    ];
    expect(resolveHomeFeltAssociation(events, NOW)).toBeNull();
  });

  it("associates to a regional event felt 5 minutes ago", () => {
    const events = [makeEvent({ id: "regional-1", originTime: NOW - 5 * 60_000 })];
    expect(resolveHomeFeltAssociation(events, NOW)).toBe("regional-1");
  });

  it("associates to a regional event right at the 1-hour boundary (inclusive)", () => {
    const events = [makeEvent({ id: "boundary", originTime: NOW - 60 * 60_000 })];
    expect(resolveHomeFeltAssociation(events, NOW)).toBe("boundary");
  });

  it("returns null (unassociated) once a regional event is just over an hour old", () => {
    const events = [makeEvent({ id: "too-old", originTime: NOW - 60 * 60_000 - 1 })];
    expect(resolveHomeFeltAssociation(events, NOW)).toBeNull();
  });

  it("picks the MOST RECENT regional event when several qualify", () => {
    const events = [
      makeEvent({ id: "older", originTime: NOW - 50 * 60_000 }),
      makeEvent({ id: "newest", originTime: NOW - 2 * 60_000 }),
      makeEvent({ id: "middle", originTime: NOW - 20 * 60_000 }),
    ];
    expect(resolveHomeFeltAssociation(events, NOW)).toBe("newest");
  });

  it("ignores a non-regional event even if it is the most recent one overall", () => {
    const events = [
      makeEvent({ id: "regional-old", originTime: NOW - 40 * 60_000, isRegional: true }),
      makeEvent({ id: "world-newest", originTime: NOW - 1_000, isRegional: false }),
    ];
    expect(resolveHomeFeltAssociation(events, NOW)).toBe("regional-old");
  });

  it("treats a future-dated event (clock skew) as not qualifying", () => {
    const events = [makeEvent({ id: "future", originTime: NOW + 60_000 })];
    expect(resolveHomeFeltAssociation(events, NOW)).toBeNull();
  });

  it("defaults `now` to the current clock when not supplied", () => {
    const events = [makeEvent({ id: "just-now", originTime: Date.now() })];
    expect(resolveHomeFeltAssociation(events)).toBe("just-now");
  });
});
