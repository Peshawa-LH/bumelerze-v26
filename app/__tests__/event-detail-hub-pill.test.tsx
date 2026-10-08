import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import type { Event } from "@/features/events";

/**
 * The "Who felt it?" pill on the real event page: present next to (not instead
 * of) the felt-report pill for a recent regional event, absent for a world
 * event, and it opens the hub with the event's route id.
 */
const mockPush = jest.fn();
const mockEventId = "hub-pill-event-1";
jest.mock("expo-router", () => {
  const actual = jest.requireActual("expo-router");
  return {
    ...actual,
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
    useLocalSearchParams: () => ({ id: mockEventId }),
    Stack: Object.assign(() => null, { ...actual.Stack, Screen: () => null }),
  };
});

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/feltmap/use-event-uuid", () => ({
  useEventUuid: () => "uuid-1",
  useEventUuidResult: () => ({ uuid: "uuid-1", isPending: false }),
}));
jest.mock("@/features/eventhub/transport", () => ({
  ...jest.requireActual("@/features/eventhub/transport"),
  SupabaseEventHubTransport: {
    fetchSummary: async () => ({
      reports: 0,
      people: 0,
      levels: {},
      firstReportAt: null,
      comments: 0,
    }),
  },
}));

function buildEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: mockEventId,
    bumelerzeId: null,
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
  const feed = (events: Event[]) => ({
    events,
    isOfflineIsh: false,
    isInitialLoading: false,
    isHardError: false,
    dataUpdatedAt: 0,
    skippedCount: 0,
    refetch: jest.fn(),
    isRefreshing: false,
  });
  return {
    ...actual,
    useEventSourceAgencies: () => new Map(),
    useRegionEvents: () => feed([mockEvent]),
    useWorldEvents: () => feed([]),
    useEventById: () => ({ event: null, isLoading: false, isError: false }),
  };
});

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import EventDetailScreen from "../(tabs)/(home,map,sensor,profile,settings)/event/[id]";

const metrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderScreen(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>
    </QueryClientProvider>,
  );
}

describe("Event page: Who felt it? pill", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("sits beside the felt-report pill for a recent regional event and opens the hub", async () => {
    mockEvent = buildEvent();
    await renderScreen(<EventDetailScreen />);
    expect(screen.getByRole("button", { name: i18n.t("felt.pill.label") })).toBeTruthy();
    const hub = screen.getByRole("button", { name: "Who felt it?" });
    await fireEvent.press(hub);
    expect(mockPush).toHaveBeenCalledWith(`/event-hub/${mockEventId}`);
  });

  it("is absent for a world (non-regional) event", async () => {
    mockEvent = buildEvent({
      isRegional: false,
      lat: 35.6,
      lon: 139.7,
      placeName: "Tokyo",
    });
    await renderScreen(<EventDetailScreen />);
    expect(screen.queryByRole("button", { name: "Who felt it?" })).toBeNull();
  });
});
