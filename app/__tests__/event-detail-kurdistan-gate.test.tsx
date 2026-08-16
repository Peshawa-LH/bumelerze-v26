import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import type { Event } from "@/features/events";

/**
 * Kurdistan gate (D26 item 5): the persistent felt-report pill only appears
 * on Event Detail for a REGIONAL event — a world-only event gets no report
 * entry point there (Home's own pill is unaffected; it's only ever shown
 * associated to a regional event in the first place,
 * `resolveHomeFeltAssociation`). Same "render the real screen file" pattern
 * as `event-detail-feltmap.test.tsx`.
 */
const mockPush = jest.fn();
const mockScreenOptions = jest.fn();
const mockEventId = "gate-test-event-1";
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

function buildEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: mockEventId,
    originTime: Date.now() - 5 * 60_000,
    lat: 35.56,
    lon: 45.43,
    depthKm: 10,
    magnitude: { value: 4.2, type: "mb" },
    placeName: "Slemani, Iraq",
    provenance: {
      provider: "usgs",
      providerId: mockEventId,
      fetchedAt: Date.now(),
      providerUpdatedAt: Date.now(),
    },
    sig: 420,
    isRegional: true,
    url: "",
    ...overrides,
  };
}

let mockEvent: Event = buildEvent();

jest.mock("@/features/events", () => {
  const actual = jest.requireActual("@/features/events");
  return {
    ...actual,
    useRegionEvents: () => ({
      events: [mockEvent],
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

describe("Event Detail: Kurdistan gate on the felt-report pill (D26 item 5)", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the felt-report pill for a regional event", async () => {
    mockEvent = buildEvent({ isRegional: true });

    await renderWithProviders(<EventDetailScreen />);

    expect(screen.getByRole("button", { name: i18n.t("felt.pill.label") })).toBeTruthy();
  });

  it("hides the felt-report pill for a non-regional (world-only) event", async () => {
    mockEvent = buildEvent({
      isRegional: false,
      lat: 35.6,
      lon: 139.7,
      placeName: "Tokyo, Japan",
    });

    await renderWithProviders(<EventDetailScreen />);

    expect(screen.queryByRole("button", { name: i18n.t("felt.pill.label") })).toBeNull();
  });
});
