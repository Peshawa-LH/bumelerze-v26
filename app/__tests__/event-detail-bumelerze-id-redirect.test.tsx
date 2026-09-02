import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { Event } from "@/features/events";

/**
 * Bumelerze identity is the canonical `/event/[id]` route id (owner
 * directive 2026-09-02: "we sometimes use the USGS ids and the
 * USGS-assigned name for events; we have to fix this... Example:
 * .../event/us6000jlqa uses the USGS id"). A visit via an old provider-id
 * url must `router.replace` to the bml-id url the moment one is known —
 * see `app/event/[id].tsx`'s own header doc comment for the two entry
 * shapes this proves.
 */
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
const mockScreenOptions = jest.fn();
let mockRouteId = "us2000bmcg";

jest.mock("expo-router", () => {
  const actual = jest.requireActual("expo-router");
  return {
    ...actual,
    useRouter: () => ({
      push: mockPush,
      back: jest.fn(),
      replace: mockReplace,
      canGoBack: mockCanGoBack,
    }),
    useLocalSearchParams: () => ({ id: mockRouteId }),
    Stack: Object.assign(() => null, {
      ...actual.Stack,
      Screen: (props: { options?: { title?: string } }) => {
        mockScreenOptions(props.options);
        return null;
      },
    }),
  };
});

function buildEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "us2000bmcg",
    bumelerzeId: null,
    originTime: Date.now() - 5 * 60_000,
    lat: 34.9109,
    lon: 45.9592,
    depthKm: 19,
    magnitude: { value: 7.3, type: "mww" },
    placeName: "Sarpol-e Zahab, Iran",
    provenance: {
      provider: "usgs",
      providerId: "us2000bmcg",
      fetchedAt: Date.now(),
      providerUpdatedAt: Date.now(),
    },
    sig: 730,
    isRegional: true,
    url: "",
    ...overrides,
  };
}

const mockEmptyFeed = {
  events: [] as Event[],
  isOfflineIsh: false,
  isInitialLoading: false,
  isHardError: false,
  dataUpdatedAt: Date.now(),
  skippedCount: 0,
  refetch: jest.fn(),
  isRefreshing: false,
};

let mockRegionEvents: Event[] = [];
let mockResolvedBumelerzeId: string | null = null;
const mockUseBumelerzeId = jest.fn();

jest.mock("@/features/events", () => {
  const actual = jest.requireActual("@/features/events");
  return {
    ...actual,
    useRegionEvents: () => ({ ...mockEmptyFeed, events: mockRegionEvents }),
    useWorldEvents: () => ({ ...mockEmptyFeed, events: [] }),
    useEventById: () => ({ event: null, isLoading: false, isError: false }),
    useEventByBumelerzeId: () => ({ event: null, isLoading: false, isError: false }),
    useBumelerzeId: (...args: unknown[]) => {
      mockUseBumelerzeId(...args);
      return { bumelerzeId: mockResolvedBumelerzeId };
    },
  };
});

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import EventDetailScreen from "../event/[id]";

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  mockCanGoBack.mockReset().mockReturnValue(true);
  mockUseBumelerzeId.mockClear();
  mockResolvedBumelerzeId = null;
  mockRouteId = "us2000bmcg";
  mockRegionEvents = [];
});

afterEach(async () => {
  await cleanup();
});

describe("Event Detail: provider-id -> bml-id redirect", () => {
  it("replaces the url with the bml id instantly via the static curated alias — no network resolution needed", async () => {
    mockRouteId = "us2000bmcg"; // the 2017 Halabja/Sarpol-e Zahab USGS id
    mockRegionEvents = [buildEvent()];

    await renderWithProviders(<EventDetailScreen />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/event/bml20170001");
    });
    // The static alias short-circuits `useBumelerzeId` entirely — no
    // Supabase round trip needed for a curated event.
    expect(mockUseBumelerzeId).toHaveBeenCalledWith(null, false);
  });

  it("replaces the url once useBumelerzeId resolves one for a non-curated provider-id route", async () => {
    mockRouteId = "us7000zzzz"; // not one of the 11 curated events
    mockRegionEvents = [
      buildEvent({
        id: "us7000zzzz",
        provenance: {
          provider: "usgs",
          providerId: "us7000zzzz",
          fetchedAt: Date.now(),
          providerUpdatedAt: Date.now(),
        },
      }),
    ];
    mockResolvedBumelerzeId = "bml20260456";

    await renderWithProviders(<EventDetailScreen />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/event/bml20260456");
    });
  });

  it("never redirects when the route is already a bml id", async () => {
    mockRouteId = "bml20170001";
    mockRegionEvents = [buildEvent()]; // still keyed by provider id — found via the alias lookup

    await renderWithProviders(<EventDetailScreen />);

    // Give any pending effects a chance to run, then confirm no redirect.
    await waitFor(() => {
      expect(mockRegionEvents.length).toBeGreaterThan(0);
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("does not redirect while no bml id has resolved for a provider-id route", async () => {
    mockRouteId = "us7000zzzz";
    mockRegionEvents = [
      buildEvent({
        id: "us7000zzzz",
        provenance: {
          provider: "usgs",
          providerId: "us7000zzzz",
          fetchedAt: Date.now(),
          providerUpdatedAt: Date.now(),
        },
      }),
    ];
    mockResolvedBumelerzeId = null;

    await renderWithProviders(<EventDetailScreen />);

    await waitFor(() => {
      expect(mockUseBumelerzeId).toHaveBeenCalled();
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
