import { cleanup, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n, { isRTLLocale } from "@/i18n";
import type { Event } from "../types";

// Home (app/(tabs)/index.tsx) is a pushed-navigator screen — it and the
// shared EventListScreen both call `useRouter()`. We don't need real
// navigation for this render test, just a stable no-op.
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Only the network-backed query hook is mocked; EventCard, EventListScreen,
// format.ts, distance.ts etc. all run for real, so this test exercises the
// actual rendering/formatting pipeline against canned data.
const mockUseRegionEvents = jest.fn();
jest.mock("@/features/events", () => {
  const actual = jest.requireActual("@/features/events");
  return {
    ...actual,
    useRegionEvents: () => mockUseRegionEvents(),
  };
});

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import HomeScreen from "../../../../app/(tabs)/index";

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderWithProviders(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

const sampleEvent: Event = {
  id: "us7000abcd",
  originTime: Date.now() - 5 * 60_000, // 5 minutes ago
  lat: 35.56,
  lon: 45.43,
  depthKm: 12,
  magnitude: { value: 4.6, type: "mb" },
  placeName: "32 km SE of Halabja, Iraq",
  provenance: {
    provider: "usgs",
    providerId: "us7000abcd",
    fetchedAt: Date.now(),
    providerUpdatedAt: Date.now(),
  },
  sig: 460,
  isRegional: true,
  url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd",
};

describe("Home screen (region feed) under the Sorani (RTL) locale", () => {
  const originalLanguage = i18n.language;

  beforeEach(() => {
    mockPush.mockClear();
    mockUseRegionEvents.mockReturnValue({
      events: [sampleEvent],
      isInitialLoading: false,
      isOfflineIsh: false,
      isHardError: false,
      isRefreshing: false,
      dataUpdatedAt: Date.now(),
      skippedCount: 0,
      refetch: jest.fn(),
    });
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("renders an event card with Sorani strings and the anchor-distance fallback", async () => {
    expect(isRTLLocale("ckb")).toBe(true);
    await i18n.changeLanguage("ckb");

    await renderWithProviders(<HomeScreen />);

    // Screen title + place name render in Sorani.
    expect(screen.getByText("ماڵەوە")).toBeTruthy();
    expect(screen.getByText("32 km SE of Halabja, Iraq")).toBeTruthy();

    // Magnitude stays a neutral, Latin-digit numeral regardless of locale
    // (design-language.md §2/§3.2) — never translated or re-scripted.
    expect(screen.getByText("M 4.6")).toBeTruthy();

    // Provenance chip.
    expect(screen.getByText("USGS")).toBeTruthy();

    // No-permission distance fallback (spec-v1.md §4.1: never "?" or a
    // blank value) — the event's coordinates are Slemani's own, so the
    // nearest-anchor phrase names Slemani in Sorani.
    expect(screen.getByText(/سلێمانی/)).toBeTruthy();
  });

  it("shows the region-feed empty state (still in Sorani) when there are no cached events", async () => {
    mockUseRegionEvents.mockReturnValue({
      events: [],
      isInitialLoading: false,
      isOfflineIsh: false,
      isHardError: false,
      isRefreshing: false,
      dataUpdatedAt: Date.now(),
      skippedCount: 0,
      refetch: jest.fn(),
    });

    await i18n.changeLanguage("ckb");
    await renderWithProviders(<HomeScreen />);

    expect(
      screen.getByText("لەم دواییانە هیچ بوومەلەرزەیەک لە هەرێمەکەتدا تۆمار نەکراوە."),
    ).toBeTruthy();
  });
});
