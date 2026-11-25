import type { Event } from "@/features/events/types";

import { applyHomePins, pickNoticeText, visibleNotice } from "../select";
import type { HomeExtras, HomeNotice, HomePin } from "../transport";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const HOUR = 3_600_000;

function event(id: string, overrides: Partial<Event> = {}): Event {
  return {
    id,
    bumelerzeId: null,
    originTime: NOW - 2 * HOUR,
    lat: 35.56,
    lon: 45.43,
    depthKm: 10,
    magnitude: { value: 4.2, type: "mb" },
    placeName: "",
    provenance: {
      provider: "usgs",
      providerId: id,
      fetchedAt: NOW,
      providerUpdatedAt: NOW,
    },
    sig: 0,
    isRegional: true,
    url: "",
    ...overrides,
  };
}

function pin(e: Event, providerIds: string[], endsAt = NOW + HOUR): HomePin {
  return { registryId: `uuid-${e.id}`, event: e, providerIds, endsAt };
}

const notice: HomeNotice = {
  id: "n1",
  kind: "info",
  texts: { en: "Hello", ckb: "سڵاو" },
  startsAt: NOW - HOUR,
  endsAt: NOW + HOUR,
};

describe("visibleNotice", () => {
  const extras: HomeExtras = { notice, pins: [] };
  it("shows a message until its end, by the phone's clock (also offline)", () => {
    expect(visibleNotice(extras, NOW, null)).toBe(notice);
    expect(visibleNotice(extras, NOW + HOUR, null)).toBeNull();
  });
  it("hides the message this person closed, but not a new one (owner choice 2)", () => {
    expect(visibleNotice(extras, NOW, "n1")).toBeNull();
    expect(visibleNotice(extras, NOW, "n0")).toBe(notice);
  });
  it("shows nothing when there is no message", () => {
    expect(visibleNotice({ notice: null, pins: [] }, NOW, null)).toBeNull();
  });
});

describe("pickNoticeText (owner choice 3)", () => {
  it("uses the phone's own language", () => {
    expect(pickNoticeText({ en: "Hello", ckb: "سڵاو" }, "ckb")).toEqual({
      text: "سڵاو",
      language: "ckb",
    });
  });
  it("falls back to English", () => {
    expect(pickNoticeText({ en: "Hello", ckb: "سڵاو" }, "ar")).toEqual({
      text: "Hello",
      language: "en",
    });
  });
  it("then to the first one filled in (Sorani, Kurmanji, Arabic)", () => {
    expect(pickNoticeText({ kmr: "Silav", ar: "مرحبا" }, "ckb")).toEqual({
      text: "Silav",
      language: "kmr",
    });
    expect(pickNoticeText({ ar: "مرحبا" }, "en")).toEqual({
      text: "مرحبا",
      language: "ar",
    });
  });
  it("returns null with no text", () => {
    expect(pickNoticeText({}, "en")).toBeNull();
  });
});

describe("applyHomePins", () => {
  const a = event("us-a", { originTime: NOW - 1 * HOUR });
  const b = event("us-b", { originTime: NOW - 3 * HOUR, lat: 36.2, lon: 44.0 });
  const c = event("us-c", { originTime: NOW - 5 * HOUR, lat: 37.0, lon: 43.0 });

  it("leaves the list alone with no chosen earthquake", () => {
    const out = applyHomePins([a, b], [a, b], { notice: null, pins: [] }, NOW);
    expect(out).toEqual({ chosen: [], rest: [a, b] });
  });

  it("puts a chosen earthquake the feed has at the top, as the feed's copy, and not twice", () => {
    const registry = event("emsc-9", {
      bumelerzeId: "bml2026x01",
      provenance: {
        provider: "emsc",
        providerId: "emsc-9",
        fetchedAt: NOW,
        providerUpdatedAt: NOW,
      },
      lat: b.lat,
      lon: b.lon,
      originTime: b.originTime,
    });
    const out = applyHomePins(
      [a, b, c],
      [a, b, c],
      { notice: null, pins: [pin(registry, ["emsc-9", "us-b"])] },
      NOW,
    );
    expect(out.chosen).toEqual([b]);
    expect(out.rest).toEqual([a, c]);
  });

  it("finds the feed's copy by place and time when the ids differ (merge rule)", () => {
    const registry = event("geofon-1", {
      originTime: c.originTime + 5_000,
      lat: c.lat + 0.1,
      lon: c.lon,
      magnitude: { value: 4.5, type: "mb" },
    });
    const out = applyHomePins(
      [a, b, c],
      [a, b, c],
      { notice: null, pins: [pin(registry, [])] },
      NOW,
    );
    expect(out.chosen).toEqual([c]);
    expect(out.rest).toEqual([a, b]);
  });

  it("draws one the feed lacks (older, smaller or farther away) from the registry row", () => {
    const old = event("us-old", {
      originTime: NOW - 400 * 24 * HOUR,
      bumelerzeId: "bml2025x09",
    });
    // The policy hid c; it is still in the pool and is matched there.
    const out = applyHomePins(
      [a, b, c],
      [a, b],
      { notice: null, pins: [pin(old, ["us-old"]), pin(c, ["us-c"])] },
      NOW,
    );
    expect(out.chosen).toEqual([old, c]);
    expect(out.rest).toEqual([a, b]);
  });

  it("leaves out an ended one and keeps at most three", () => {
    const d = event("us-d", { originTime: NOW - 10 * HOUR, lat: 33.5, lon: 46.0 });
    const pins = [
      pin(a, ["us-a"], NOW - 1),
      pin(b, ["us-b"]),
      pin(c, ["us-c"]),
      pin(d, ["us-d"]),
    ];
    const extra = event("us-e", { originTime: NOW - 20 * HOUR, lat: 38.0, lon: 42.0 });
    const out = applyHomePins(
      [a, b, c, d, extra],
      [a, b, c, d, extra],
      { notice: null, pins: [...pins, pin(extra, ["us-e"])] },
      NOW,
    );
    expect(out.chosen.map((e) => e.id)).toEqual(["us-b", "us-c", "us-d"]);
    expect(out.rest.map((e) => e.id)).toEqual(["us-a", "us-e"]);
  });
});
