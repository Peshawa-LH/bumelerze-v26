import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import type { Event } from "@/features/events";

/**
 * `origin=map` (event-preview-sheet wave) — the map screen's sheet is the
 * ONLY thing that ever sets this param when it pushes `/event/[id]`; this
 * file proves the resulting "back to map" affordance appears ONLY then, and
 * that its `onPress` prefers `router.back()` (already correct by
 * construction whenever this param is set, per `handleBackToMap`'s own doc
 * comment) with a `replace("/map")` fallback for the one edge case where
 * the stack was already cleared out from under the screen. Same "render the
 * real screen file" pattern as `event-detail-kurdistan-gate.test.tsx`.
 */
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
const mockScreenOptions = jest.fn();
const mockEventId = "map-origin-test-event-1";
let mockOrigin: string | undefined;

jest.mock("expo-router", () => {
  const actual = jest.requireActual("expo-router");
  return {
    ...actual,
    useRouter: () => ({
      push: mockPush,
      back: mockBack,
      replace: mockReplace,
      canGoBack: mockCanGoBack,
    }),
    useLocalSearchParams: () => ({ id: mockEventId, origin: mockOrigin }),
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

const mockEvent: Event = buildEvent();

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

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCanGoBack.mockReset().mockReturnValue(true);
  mockOrigin = undefined;
});

afterEach(async () => {
  await cleanup();
});

describe("Event Detail: origin=map back-to-map affordance", () => {
  it("shows no back-to-map row for a normal (non-map-sheet) entry", async () => {
    mockOrigin = undefined;
    await renderWithProviders(<EventDetailScreen />);

    expect(screen.queryByText(i18n.t("eventDetail.backToMap"))).toBeNull();
  });

  it("shows the back-to-map row when reached via the map sheet (origin=map), and it prefers router.back()", async () => {
    mockOrigin = "map";
    mockCanGoBack.mockReturnValue(true);
    await renderWithProviders(<EventDetailScreen />);

    const backButton = screen.getByRole("button", { name: i18n.t("eventDetail.backToMap") });
    await act(async () => {
      fireEvent.press(backButton);
    });

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("falls back to replacing the map route when the stack has nothing to go back to", async () => {
    mockOrigin = "map";
    mockCanGoBack.mockReturnValue(false);
    await renderWithProviders(<EventDetailScreen />);

    const backButton = screen.getByRole("button", { name: i18n.t("eventDetail.backToMap") });
    await act(async () => {
      fireEvent.press(backButton);
    });

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/map");
  });
});
