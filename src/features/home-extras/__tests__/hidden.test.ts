import { isSameEarthquake, mergeProviderEvents } from "@/features/events/merge";
import type { Event } from "@/features/events/types";

import {
  findHidden,
  hiddenEntryForEvent,
  indexHidden,
  keptRouteId,
  NO_HIDDEN,
  withoutHidden,
  withoutHiddenPossible,
} from "../hidden";
import type { HiddenEarthquake } from "../transport";

const T = Date.parse("2026-11-26T08:15:00Z");

function event(
  id: string,
  provider: Event["provenance"]["provider"],
  overrides: Partial<Event> = {},
): Event {
  return {
    id,
    bumelerzeId: null,
    originTime: T,
    lat: 35.2,
    lon: 45.9,
    depthKm: 10,
    magnitude: { value: 4.6, type: "mb" },
    placeName: "",
    provenance: { provider, providerId: id, fetchedAt: T, providerUpdatedAt: T },
    sig: 0,
    isRegional: true,
    url: "",
    ...overrides,
  };
}

/** A second card (EMSC's copy, registered as its own earthquake) hidden in
 * favour of the USGS card. */
const secondCard: HiddenEarthquake = {
  bumelerzeId: "bml2026x02",
  providerIds: ["20261126_0000042"],
  reasonKind: "duplicate",
  kept: { bumelerzeId: "bml2026x01", providerIds: ["us7000kept", "gfz2026kept"] },
};
/** A quarry blast USGS published by mistake, hidden as not real. */
const blast: HiddenEarthquake = {
  bumelerzeId: "bml2026x03",
  providerIds: ["us7000blst"],
  reasonKind: "removed",
  kept: null,
};

describe("the hidden list, found by id only (migration 0085)", () => {
  const index = indexHidden([secondCard, blast]);

  it("finds a hidden earthquake by any provider id the registry knows", () => {
    expect(findHidden(index, ["20261126_0000042"])).toBe(secondCard);
    expect(findHidden(index, ["us7000blst"])).toBe(blast);
    expect(hiddenEntryForEvent(index, event("us7000blst", "usgs"))).toBe(blast);
  });

  it("finds it by its Bumelerze id", () => {
    expect(findHidden(index, ["bml2026x03"])).toBe(blast);
    // A registry copy (a shared link, a chosen earthquake) whose own
    // provider id is not in the list is still found by its bml id.
    const fromRegistry = event("some-other-id", "usgs", { bumelerzeId: "bml2026x02" });
    expect(hiddenEntryForEvent(index, fromRegistry)).toBe(secondCard);
  });

  it("checks the card's provenance id too", () => {
    const card = event("feed-row-1", "emsc", {
      provenance: {
        provider: "emsc",
        providerId: "20261126_0000042",
        fetchedAt: T,
        providerUpdatedAt: T,
      },
    });
    expect(hiddenEntryForEvent(index, card)).toBe(secondCard);
  });

  it("never hides the card that stays, though the merge rule calls it the same earthquake", () => {
    const keptCard = event("us7000kept", "usgs");
    const hiddenCopy = event("20261126_0000042", "emsc", { originTime: T + 5_000 });
    // The merge rule would match them: exactly why it must not be used.
    expect(isSameEarthquake(keptCard, hiddenCopy)).toBe(true);
    expect(hiddenEntryForEvent(index, keptCard)).toBeNull();
    expect(withoutHidden([keptCard, hiddenCopy], index)).toEqual([keptCard]);
  });

  it("works after mergeProviderEvents: the merged card keeps only its own ids", () => {
    // USGS and GEOFON copies of the kept earthquake merge into the USGS card;
    // the EMSC copy registered on its own (40 s off) stays a second card.
    const merged = mergeProviderEvents([
      [event("us7000kept", "usgs")],
      [event("20261126_0000042", "emsc", { originTime: T + 40_000 })],
      [event("gfz2026kept", "geofon", { originTime: T + 2_000 })],
    ]);
    expect(merged.map((e) => e.id)).toEqual(["20261126_0000042", "us7000kept"]);
    expect(withoutHidden(merged, index).map((e) => e.id)).toEqual(["us7000kept"]);
  });

  it("leaves everything else alone, and hands back the same list when nothing is hidden", () => {
    const list = [event("us7000aaaa", "usgs"), event("us7000bbbb", "usgs")];
    expect(withoutHidden(list, index)).toEqual(list);
    expect(withoutHidden(list, NO_HIDDEN)).toBe(list);
    expect(withoutHidden(list, indexHidden([]))).toBe(list);
  });

  it("tolerates a missing list (a copy saved by 26.5.0-26.5.1)", () => {
    expect(indexHidden(undefined)).toBe(NO_HIDDEN);
    expect(indexHidden(null)).toBe(NO_HIDDEN);
    expect(findHidden(NO_HIDDEN, ["us7000blst"])).toBeNull();
  });

  it("finds a hidden possible earthquake by its crowd source id", () => {
    const crowd: HiddenEarthquake = {
      bumelerzeId: null,
      providerIds: ["crowd-sy7d-29468400"],
      reasonKind: "removed",
      kept: null,
    };
    const possible = [
      { id: "uuid-1", providerIds: ["crowd-sy7d-29468400"] },
      { id: "uuid-2", providerIds: ["crowd-sy7e-29468400"] },
      // Saved on the device before 26.5.2: no ids, shown as before.
      { id: "uuid-3" },
    ];
    expect(
      withoutHiddenPossible(possible, indexHidden([crowd])).map((p) => p.id),
    ).toEqual(["uuid-2", "uuid-3"]);
    expect(withoutHiddenPossible(possible, NO_HIDDEN)).toBe(possible);
  });
});

describe("keptRouteId: where a link to a hidden second card goes (wording 2.21)", () => {
  it("opens the card that stays by its Bumelerze id", () => {
    expect(keptRouteId(secondCard)).toBe("bml2026x01");
  });

  it("falls back to its first provider id", () => {
    expect(
      keptRouteId({
        ...secondCard,
        kept: { bumelerzeId: null, providerIds: ["us7000kept"] },
      }),
    ).toBe("us7000kept");
  });

  it("has nowhere to go for a removed earthquake", () => {
    expect(keptRouteId(blast)).toBeNull();
    expect(keptRouteId({ ...secondCard, kept: null })).toBeNull();
  });
});
