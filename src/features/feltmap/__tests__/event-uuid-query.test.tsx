/**
 * Asking the registry again for an event's id (the felt map, the Event hub
 * and its pill are keyed by it). Found 2026-10-22: after a failed lookup
 * (offline), pulling the hub down to refresh re-read the hub but never the
 * lookup, so the hub, its pill and the felt map stayed missing until a
 * restart. Only the registry call is mocked.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import React from "react";

import type { Event } from "@/features/events/types";

import { eventUuidQueryKey, refetchEventUuidIfMissing } from "../event-uuid-query";
import { useEventUuidResult } from "../use-event-uuid";

const mockLookUp = jest.fn();

jest.mock("@/features/shakemap/live-transport", () => ({
  lookUpEventUuidForEvent: (event: unknown) => mockLookUp(event),
}));

const REGISTRY_ID = "11111111-1111-4111-8111-111111111111";

function event(providerId: string): Event {
  return {
    id: providerId,
    bumelerzeId: null,
    originTime: Date.UTC(2026, 9, 20, 8, 0, 0),
    lat: 35.56,
    lon: 45.43,
    depthKm: 10,
    magnitude: { value: 4.4, type: "mb" },
    placeName: "Sulaymaniyah, Iraq",
    provenance: {
      provider: "usgs",
      providerId,
      fetchedAt: Date.now(),
      providerUpdatedAt: Date.now(),
    },
    sig: 300,
    isRegional: true,
    url: "",
  };
}

function setUp(quake: Event) {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: 0, retryDelay: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return {
    client,
    hook: renderHook(() => useEventUuidResult(quake), { wrapper: Wrapper }),
  };
}

beforeEach(() => {
  mockLookUp.mockReset();
});

describe("eventUuidQueryKey", () => {
  it("is the key the lookup is kept under", () => {
    expect(eventUuidQueryKey(event("us_key"))).toEqual(["event-uuid", "usgs", "us_key"]);
  });
});

describe("refetchEventUuidIfMissing", () => {
  it("asks the registry again after a failed lookup, and the id arrives", async () => {
    const quake = event("us_failed_then_asked");
    mockLookUp.mockRejectedValue(new TypeError("Network request failed"));
    const { client, hook } = setUp(quake);
    const { result } = await hook;
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.uuid).toBeNull();
    const askedBefore = mockLookUp.mock.calls.length;

    mockLookUp.mockResolvedValue(REGISTRY_ID);
    await act(async () => {
      await refetchEventUuidIfMissing(client, quake);
    });

    expect(mockLookUp.mock.calls.length).toBeGreaterThan(askedBefore);
    await waitFor(() => expect(result.current.uuid).toBe(REGISTRY_ID));
  });

  it("asks again after an answer of 'no id'", async () => {
    const quake = event("us_no_id_then_asked");
    mockLookUp.mockResolvedValue(null);
    const { client, hook } = setUp(quake);
    const { result } = await hook;
    await waitFor(() => expect(mockLookUp).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isPending).toBe(false));

    mockLookUp.mockResolvedValue(REGISTRY_ID);
    await act(async () => {
      await refetchEventUuidIfMissing(client, quake);
    });

    expect(mockLookUp).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.uuid).toBe(REGISTRY_ID));
  });

  it("never asks again once the id is known (it never changes)", async () => {
    const quake = event("us_known");
    mockLookUp.mockResolvedValue(REGISTRY_ID);
    const { client, hook } = setUp(quake);
    const { result } = await hook;
    await waitFor(() => expect(result.current.uuid).toBe(REGISTRY_ID));

    await act(async () => {
      await refetchEventUuidIfMissing(client, quake);
    });

    expect(mockLookUp).toHaveBeenCalledTimes(1);
  });

  it("does nothing, and never fails, for an event no screen looked up", async () => {
    const client = new QueryClient();
    await expect(
      refetchEventUuidIfMissing(client, event("us_never_looked_up")),
    ).resolves.toBeUndefined();
    expect(mockLookUp).not.toHaveBeenCalled();
  });
});
