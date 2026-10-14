import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { formatCoordinates, isolateNumeric, type Event } from "@/features/events";

/**
 * B-3: under Sorani and Arabic the Coordinates and Depth values sat at the
 * LEFT edge of the page under right-aligned labels, and the two time rows
 * were forced LTR so "UTC" opened the sentence at the reading start. Every
 * value now takes the app language's direction and reading-start alignment
 * (`directionStyle`), while the numeric content stays a left-to-right
 * isolate. Same "render the real screen file" pattern as
 * `event-detail-kurdistan-gate.test.tsx`.
 */
const mockEventId = "rtl-values-event-1";
jest.mock("expo-router", () => {
  const actual = jest.requireActual("expo-router");
  return {
    ...actual,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => false }),
    useLocalSearchParams: () => ({ id: mockEventId }),
    Stack: Object.assign(() => null, {
      ...actual.Stack,
      Screen: () => null,
    }),
  };
});

const mockEvent: Event = {
  id: mockEventId,
  bumelerzeId: null,
  originTime: Date.UTC(2017, 10, 12, 18, 18, 17),
  lat: 34.911,
  lon: 45.959,
  depthKm: 19,
  magnitude: { value: 7.3, type: "mww" },
  placeName: "Sarpol-e Zahab, Iran",
  provenance: {
    provider: "usgs",
    providerId: mockEventId,
    fetchedAt: Date.now(),
    providerUpdatedAt: Date.now(),
  },
  sig: 900,
  isRegional: true,
  url: "",
};

jest.mock("@/features/events", () => {
  const actual = jest.requireActual("@/features/events");
  const feed = {
    isOfflineIsh: false,
    isInitialLoading: false,
    isHardError: false,
    dataUpdatedAt: Date.now(),
    skippedCount: 0,
    refetch: jest.fn(),
    isRefreshing: false,
  };
  return {
    ...actual,
    useRegionEvents: () => ({ ...feed, events: [mockEvent] }),
    useWorldEvents: () => ({ ...feed, events: [] }),
    useEventById: () => ({ event: null, isLoading: false, isError: false }),
  };
});

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import EventDetailScreen from "../(tabs)/(home,map,sensor,profile,settings)/event/[id]";

function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 360, height: 640 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        {ui}
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}

function flatStyle(node: { props: Record<string, unknown> }): Record<string, unknown> {
  return Object.assign({}, ...[node.props.style].flat(Infinity));
}

describe("Event Detail: value direction and alignment (B-3)", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("under Sorani every value is an RTL paragraph aligned to the reading start, with the numbers isolated", async () => {
    await i18n.changeLanguage("ckb");
    await renderWithProviders(<EventDetailScreen />);

    const coordinates = await screen.findByTestId("event-detail-coordinates");
    expect(coordinates.props.children).toBe(formatCoordinates(34.911, 45.959, "ckb"));
    expect(coordinates.props.children).toBe(isolateNumeric("٣٤.٩١١, ٤٥.٩٥٩"));
    expect(flatStyle(coordinates)).toMatchObject({ writingDirection: "rtl", textAlign: "right" });

    const depth = screen.getByTestId("event-detail-depth");
    expect(depth.props.children).toBe(isolateNumeric("١٩.٠ کم"));
    expect(flatStyle(depth)).toMatchObject({ writingDirection: "rtl", textAlign: "right" });

    const times = screen.getAllByTestId("event-detail-time-value");
    expect(times).toHaveLength(2);
    for (const time of times) {
      // A Sorani sentence ending in "UTC"/a period token, never forced LTR.
      expect(flatStyle(time)).toMatchObject({ writingDirection: "rtl", textAlign: "right" });
    }
    expect(times[0]?.props.children).toMatch(/UTC$/);
  });

  it("under English the same values are LTR paragraphs aligned left", async () => {
    await i18n.changeLanguage("en");
    await renderWithProviders(<EventDetailScreen />);

    const coordinates = await screen.findByTestId("event-detail-coordinates");
    expect(coordinates.props.children).toBe(isolateNumeric("34.911, 45.959"));
    expect(flatStyle(coordinates)).toMatchObject({ writingDirection: "ltr", textAlign: "left" });
    for (const time of screen.getAllByTestId("event-detail-time-value")) {
      expect(flatStyle(time)).toMatchObject({ writingDirection: "ltr", textAlign: "left" });
    }
  });
});
