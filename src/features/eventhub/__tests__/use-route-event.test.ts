import { renderHook } from "@testing-library/react-native";

import type { Event } from "@/features/events";

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
});
