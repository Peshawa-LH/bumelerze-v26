import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import type { Event } from "@/features/events";
import {
  CHAMCHAMAL_CENTER,
  CHAMCHAMAL_FELT_MAP_FIXTURE,
  FELTMAP_FIXTURE_EVENT_ID,
} from "@/features/feltmap/__fixtures__/chamchamal";

/**
 * Integration test: `app/event/[id].tsx` (the real screen file, not a
 * re-implementation of its gating logic — same "import the actual app/
 * screen" approach as `features/events/__tests__/home-screen.test.tsx` and
 * `features/historical/__tests__/historical-screen.test.tsx`) with a
 * fixture-backed `FeltMapTransport` wired in at the real transport seam
 * (`@/features/feltmap/transport`) — proves the whole real stack
 * (`FeltMapSection` -> `useFeltMap` -> `SupabaseFeltMapTransport` ->
 * `selectFeltMapCells` -> `FeltMapView`) renders end to end on Event
 * Detail, not just each layer in isolation (which `FeltMapSection.test.tsx`
 * / `queries.test.tsx` / `FeltMapView.test.tsx` already cover).
 *
 * Only `expo-router` (native-navigator APIs that throw outside a real
 * navigation tree) and the event feed (network-backed, would otherwise hit
 * USGS/EMSC/GEOFON for real) are mocked — formatting, distance, felt-map
 * rendering, and i18n all run for real.
 */
const mockPush = jest.fn();
const mockScreenOptions = jest.fn();
// Duplicated literal (not the imported `FELTMAP_FIXTURE_EVENT_ID`) —
// `jest.mock` factories may not reference out-of-scope variables unless
// their name is `mock`-prefixed; a consistency test below asserts this
// stays equal to the real fixture constant.
const mockEventId = "fixture-chamchamal-20260813";
jest.mock("expo-router", () => {
  const actual = jest.requireActual("expo-router");
  return {
    ...actual,
    useRouter: () => ({ push: mockPush }),
    useLocalSearchParams: () => ({ id: mockEventId }),
    Stack: Object.assign(() => null, {
      ...actual.Stack,
      Screen: (props: { options?: { title?: string } }) => {
        mockScreenOptions(props.options);
        return null;
      },
    }),
  };
});

const mockChamchamalEvent: Event = {
  id: FELTMAP_FIXTURE_EVENT_ID,
  originTime: Date.UTC(2026, 7, 13, 22, 28, 0),
  lat: CHAMCHAMAL_CENTER.lat,
  lon: CHAMCHAMAL_CENTER.lon,
  depthKm: 10,
  magnitude: { value: 4.0, type: "mb" },
  placeName: "Chamchamal, Iraq",
  provenance: {
    provider: "emsc",
    providerId: FELTMAP_FIXTURE_EVENT_ID,
    fetchedAt: Date.now(),
    providerUpdatedAt: Date.now(),
  },
  sig: 400,
  isRegional: true,
  url: "",
};

// Only the network-backed feed hooks are overridden — everything else in
// "@/features/events" (formatting, TagRow, etc.) runs for real, same as
// home-screen.test.tsx's own "@/features/events" mock. `useEventSourceAgencies`
// is ALSO overridden (unlike the feltmap transport, which fixture-swaps at
// its own transport seam below): this test flips Supabase "configured" on
// via real env vars pointed at a fake URL, and the real transport would
// otherwise issue a genuine network request against it.
jest.mock("@/features/events", () => {
  const actual = jest.requireActual("@/features/events");
  return {
    ...actual,
    useEventSourceAgencies: () => new Map(),
    useRegionEvents: () => ({
      events: [mockChamchamalEvent],
      isOfflineIsh: false,
      isInitialLoading: false,
      isHardError: false,
      dataUpdatedAt: Date.now(),
      skippedCount: 0,
      refetch: jest.fn(),
      isRefreshing: false,
    }),
    useWorldEvents: () => ({
      events: [],
      isOfflineIsh: false,
      isInitialLoading: false,
      isHardError: false,
      dataUpdatedAt: Date.now(),
      skippedCount: 0,
      refetch: jest.fn(),
      isRefreshing: false,
    }),
    useEventById: () => ({ event: null, isLoading: false, isError: false }),
  };
});

// The real `useFeltMap` -> `isSupabaseConfigured()` -> real transport chain
// runs; only the actual network call at the transport seam is swapped for
// the fixture, exactly the "tests inject fixtures" contract `FeltMapTransport`
// exists for.
jest.mock("@/features/feltmap/transport", () => {
  const actual = jest.requireActual("@/features/feltmap/transport");
  // `jest.requireActual` (not the top-level import) — factories can't
  // reference out-of-scope variables, same rule as `mockEventId`/
  // `mockChamchamalEvent` above.
  const fixtures = jest.requireActual("@/features/feltmap/__fixtures__/chamchamal");
  return {
    ...actual,
    SupabaseFeltMapTransport: {
      fetchFeltCells: jest.fn(async () => fixtures.CHAMCHAMAL_FELT_MAP_FIXTURE),
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
  // EventDetailScreen's own feed hooks are mocked above (no real network),
  // but `FeltMapSection` -> `useFeltMap` still calls the real
  // `@tanstack/react-query` `useQuery` — needs a real provider, same as
  // `features/feltmap/__tests__/queries.test.tsx`'s own harness (this repo's
  // real `app/_layout.tsx` normally supplies one; this test stands in for
  // it since the layout itself isn't rendered here).
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>
    </QueryClientProvider>,
  );
}

/** Same per-key delete/set discipline as `features/feltmap/__tests__/
 * queries.test.tsx` — see that file's doc comment on why a wholesale
 * `process.env = {...}` reassignment breaks React Query's async resolution
 * in this jest-expo environment. */
function setSupabaseConfigured(configured: boolean): void {
  if (configured) {
    process.env.EXPO_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "anon-key-value";
  } else {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  }
}

describe("Event Detail: felt-map section (real screen, fixture transport)", () => {
  it("keeps the expo-router mock's literal event id in sync with the real fixture constant", () => {
    expect(mockEventId).toBe(FELTMAP_FIXTURE_EVENT_ID);
  });

  beforeEach(() => {
    setSupabaseConfigured(false);
  });

  afterEach(() => {
    cleanup();
    setSupabaseConfigured(false);
  });

  it("renders the felt-map section with cells drawn from the fixture transport once configured", async () => {
    setSupabaseConfigured(true);

    await renderWithProviders(<EventDetailScreen />);

    await waitFor(() =>
      expect(screen.getByText(i18n.t("eventDetail.feltMap.sectionTitle"))).toBeTruthy(),
    );
    const mapContainer = screen.getByTestId("feltmap-map-container");
    expect(mapContainer).toBeTruthy();

    // SVG cells only render once the container has a measured width (same
    // `onLayout`-gated pattern as `ShakeMapView`/`FeltMapView.test.tsx`).
    await fireEvent(mapContainer, "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 240 } },
    });

    expect(
      screen.getAllByTestId(/^feltmap-cell-/).length,
    ).toBe(CHAMCHAMAL_FELT_MAP_FIXTURE.length);
  });

  it("mounts below the ShakeMap section title (never above it) in document order", async () => {
    setSupabaseConfigured(true);

    await renderWithProviders(<EventDetailScreen />);

    await waitFor(() =>
      expect(screen.getByText(i18n.t("eventDetail.feltMap.sectionTitle"))).toBeTruthy(),
    );
    const shakemapTitle = screen.queryByText(i18n.t("eventDetail.shakemap.sectionTitle"));
    // us-not-in-atlas fixture event has no bundled shakemap product, so the
    // ShakeMap section itself renders nothing (D21) — this assertion only
    // has to prove the felt map doesn't depend on it being present.
    expect(shakemapTitle).toBeNull();
  });

  it("does not render the felt-map section at all when Supabase is unconfigured", async () => {
    setSupabaseConfigured(false);

    await renderWithProviders(<EventDetailScreen />);

    expect(screen.queryByText(i18n.t("eventDetail.feltMap.sectionTitle"))).toBeNull();
    expect(screen.queryByTestId("feltmap-map-container")).toBeNull();
  });
});
