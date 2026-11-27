import { renderHook } from "@testing-library/react-native";

import type { Event } from "@/features/events";
import { indexHidden, NO_HIDDEN, type HiddenIndex } from "@/features/home-extras";

import { useRouteEvent } from "../use-route-event";

const mockFeed = jest.fn();
const mockByBumelerzeId = jest.fn();
const mockById = jest.fn();

jest.mock("@/features/events", () => ({
  ...jest.requireActual("@/features/events"),
  useRegionEvents: () => mockFeed(),
  useWorldEvents: () => mockFeed(),
  useEventByBumelerzeId: (id: string | undefined, enabled: boolean) =>
    mockByBumelerzeId(id, enabled),
  useEventById: (id: string | undefined, enabled: boolean) => mockById(id, enabled),
}));

// The earthquakes hidden for everyone (migration 0085), from the list Home
// keeps on the device; a real `useQuery` hook, so mocked here.
const mockHidden: { current: HiddenIndex } = { current: NO_HIDDEN };
jest.mock("@/features/home-extras", () => ({
  ...jest.requireActual("@/features/home-extras"),
  useHiddenEarthquakes: () => mockHidden.current,
}));

const BML_ID = "bml2026026e";
const PROVIDER_ID = "us7000abcd";

function makeEvent(id: string, bumelerzeId: string | null): Event {
  return {
    id,
    bumelerzeId,
    originTime: 1_760_000_000_000,
    lat: 35.9,
    lon: 45.8,
    depthKm: 10,
    magnitude: { value: 4.4, type: "mb" },
    placeName: "Baneh, Iran",
    provenance: {
      provider: "usgs",
      providerId: id,
      fetchedAt: 1_760_000_100_000,
      providerUpdatedAt: 1_760_000_050_000,
    },
    sig: 300,
    isRegional: true,
    url: "",
  };
}

const LOADING_FEED = { events: [], isInitialLoading: true };
/** A direct lookup that answers whenever it is allowed to run. */
function lookupAnswering(event: Event) {
  return (_id: string | undefined, enabled: boolean) => ({
    event: enabled ? event : null,
    isLoading: false,
    isError: false,
  });
}

/**
 * A shared link opened with no saved list must not wait for the region and
 * world feeds before its own lookup (2026-10-21: GEOFON hung, the feeds took
 * their full 8 s, and `/e/<bml id>` showed "Loading event…" for ~9 s).
 */
describe("useRouteEvent", () => {
  beforeEach(() => {
    mockFeed.mockReset();
    mockByBumelerzeId.mockReset();
    mockById.mockReset();
    mockHidden.current = NO_HIDDEN;
  });

  it("looks a bml link up straight away while the feeds are still loading", async () => {
    const event = makeEvent(PROVIDER_ID, BML_ID);
    mockFeed.mockReturnValue(LOADING_FEED);
    mockByBumelerzeId.mockImplementation(lookupAnswering(event));
    mockById.mockImplementation(lookupAnswering(event));

    const { result } = await renderHook(() => useRouteEvent(BML_ID));

    expect(result.current.event).toBe(event);
    expect(result.current.isLoading).toBe(false);
  });

  it("looks a provider-id link up straight away while the feeds are still loading", async () => {
    const event = makeEvent(PROVIDER_ID, null);
    mockFeed.mockReturnValue(LOADING_FEED);
    mockByBumelerzeId.mockImplementation(lookupAnswering(event));
    mockById.mockImplementation(lookupAnswering(event));

    const { result } = await renderHook(() => useRouteEvent(PROVIDER_ID));

    expect(result.current.event).toBe(event);
    expect(result.current.isLoading).toBe(false);
  });

  it("makes no lookup when the saved feed already has the event (in-app navigation)", async () => {
    const event = makeEvent(PROVIDER_ID, BML_ID);
    mockFeed.mockReturnValue({ events: [event], isInitialLoading: false });
    mockByBumelerzeId.mockImplementation(lookupAnswering(event));
    mockById.mockImplementation(lookupAnswering(event));

    const { result } = await renderHook(() => useRouteEvent(BML_ID));

    expect(result.current.event).toBe(event);
    expect(mockByBumelerzeId).not.toHaveBeenCalledWith(BML_ID, true);
    expect(mockById).not.toHaveBeenCalledWith(expect.anything(), true);
  });

  describe("hidden earthquakes (migration 0085)", () => {
    const secondCard = {
      bumelerzeId: "bml2026x02",
      providerIds: ["20261126_0000042"],
      reasonKind: "duplicate" as const,
      kept: { bumelerzeId: BML_ID, providerIds: [PROVIDER_ID] },
    };

    it("knows a hidden id from the route alone, before any lookup answers", async () => {
      mockHidden.current = indexHidden([secondCard]);
      mockFeed.mockReturnValue(LOADING_FEED);
      mockByBumelerzeId.mockReturnValue({ event: null, isLoading: true, isError: false });
      mockById.mockReturnValue({ event: null, isLoading: true, isError: false });

      const byBml = await renderHook(() => useRouteEvent("bml2026x02"));
      expect(byBml.result.current.hidden).toBe(secondCard);
      const byProvider = await renderHook(() => useRouteEvent("20261126_0000042"));
      expect(byProvider.result.current.hidden).toBe(secondCard);
    });

    it("finds it by the resolved event's own ids too", async () => {
      // A provider id the hidden list does not name, resolving to a registry
      // event whose bml id it does.
      const event = makeEvent("emsc-other", "bml2026x02");
      mockHidden.current = indexHidden([secondCard]);
      mockFeed.mockReturnValue({ events: [], isInitialLoading: false });
      mockById.mockImplementation(lookupAnswering(event));
      mockByBumelerzeId.mockImplementation(lookupAnswering(event));

      const { result } = await renderHook(() => useRouteEvent("emsc-other"));
      expect(result.current.event).toBe(event);
      expect(result.current.hidden).toBe(secondCard);
    });

    it("never marks the card that stays", async () => {
      const kept = makeEvent(PROVIDER_ID, BML_ID);
      mockHidden.current = indexHidden([secondCard]);
      mockFeed.mockReturnValue({ events: [kept], isInitialLoading: false });
      mockById.mockImplementation(lookupAnswering(kept));
      mockByBumelerzeId.mockImplementation(lookupAnswering(kept));

      const { result } = await renderHook(() => useRouteEvent(BML_ID));
      expect(result.current.event).toBe(kept);
      expect(result.current.hidden).toBeNull();
    });
  });
});
