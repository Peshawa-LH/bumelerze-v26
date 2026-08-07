import { cleanup, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { AccessibilityInfo } from "react-native";
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

  it("renders an event card with Sorani strings and the gazetteer place line", async () => {
    expect(isRTLLocale("ckb")).toBe(true);
    await i18n.changeLanguage("ckb");

    await renderWithProviders(<HomeScreen />);

    // Screen title renders in Sorani.
    expect(screen.getByText("ماڵەوە")).toBeTruthy();

    // The raw USGS place string is gone — replaced by our own gazetteer
    // place line (ui-backlog.md wave 5 item 3). The event's coordinates are
    // Slemani's own, so the nearest-gazetteer-city phrase names Slemani in
    // Sorani and carries the Kurdistan (Iraq) region label.
    expect(screen.queryByText("32 km SE of Halabja, Iraq")).toBeNull();
    expect(screen.getByText(/سلێمانی/)).toBeTruthy();
    expect(screen.getByText(/کوردستان \(عێراق\)/)).toBeTruthy();

    // Magnitude digit-localizes to Eastern Arabic-Indic in Sorani
    // (ui-backlog.md wave 5 item 1 — reverses design-language.md §3.2's
    // earlier "always Latin" call, per Peshawa's native-speaker review).
    expect(screen.getByText("٤.٦ پلە")).toBeTruthy();

    // Provenance chip.
    expect(screen.getByText("USGS")).toBeTruthy();
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

  it("gives the persistent felt-report pill an accessibilityHint explaining what tapping it does (design-language.md §8, accessibility-tester Phase 5)", async () => {
    await renderWithProviders(<HomeScreen />);

    const pill = screen.getByRole("button", { name: i18n.t("felt.pill.label") });
    expect(pill.props.accessibilityHint).toBe(i18n.t("felt.pill.hint"));
  });

  it("marks the offline banner as an assertive/polite live region so a screen reader hears the stale-data state (accessibility-tester Phase 5)", async () => {
    mockUseRegionEvents.mockReturnValue({
      events: [sampleEvent],
      isInitialLoading: false,
      isOfflineIsh: true,
      isHardError: false,
      isRefreshing: false,
      dataUpdatedAt: Date.now(),
      skippedCount: 0,
      refetch: jest.fn(),
    });

    await renderWithProviders(<HomeScreen />);

    const banner = screen.getByText(/you're offline/i, { exact: false }).parent;
    expect(banner?.props.accessibilityLiveRegion).toBe("polite");
  });

  it("announces the offline state via AccessibilityInfo too, for VoiceOver (which ignores accessibilityLiveRegion)", async () => {
    const announceSpy = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => undefined);

    mockUseRegionEvents.mockReturnValue({
      events: [sampleEvent],
      isInitialLoading: false,
      isOfflineIsh: true,
      isHardError: false,
      isRefreshing: false,
      dataUpdatedAt: Date.now(),
      skippedCount: 0,
      refetch: jest.fn(),
    });

    await renderWithProviders(<HomeScreen />);

    expect(announceSpy).toHaveBeenCalledWith(i18n.t("events.offlineAnnouncement"));
    announceSpy.mockRestore();
  });
});
