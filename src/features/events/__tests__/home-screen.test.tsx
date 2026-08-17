import { cleanup, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n, { isRTLLocale } from "@/i18n";
import type { Event } from "../types";
import type { PossibleEvent } from "../possible";

// Home (app/(tabs)/index.tsx) is a pushed-navigator screen — it and the
// shared EventListScreen both call `useRouter()`. We don't need real
// navigation for this render test, just a stable no-op.
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Only the network-backed query hooks are mocked; EventCard, EventListScreen,
// format.ts, distance.ts etc. all run for real, so this test exercises the
// actual rendering/formatting pipeline against canned data.
//
// `usePossibleEvents` (D26 item 3) and `useNotableTailEvents` (adaptive
// Home-feed policy, update-plan-2026-08.md §1.1) are mocked here for the
// same reason `useRegionEvents` already is: they're real `useQuery` hooks
// under the hood, and this file's `renderWithProviders` deliberately has no
// `QueryClientProvider` in its tree (see that function below) — mocking
// them keeps every existing test in this file working unchanged, and lets
// the dedicated possible-event test below control its return value
// directly without needing real Supabase env wiring.
const mockUseRegionEvents = jest.fn();
const mockUsePossibleEvents = jest.fn();
const mockUseNotableTailEvents = jest.fn();
jest.mock("@/features/events", () => {
  const actual = jest.requireActual("@/features/events");
  return {
    ...actual,
    useRegionEvents: () => mockUseRegionEvents(),
    usePossibleEvents: () => mockUsePossibleEvents(),
    useNotableTailEvents: () => mockUseNotableTailEvents(),
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

// Slemani coordinates again (same as sampleEvent) — nearestCities resolves
// this to "Slemani" in every locale's own gazetteer name.
const samplePossibleEvent: PossibleEvent = {
  id: "possible-event-1",
  originTime: Date.now() - 2 * 60_000,
  lat: 35.56,
  lon: 45.43,
  createdAt: Date.now() - 90_000,
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
    // Default: no possible events (the common case) — matches
    // `usePossibleEvents`' own "unconfigured/empty" shape.
    mockUsePossibleEvents.mockReturnValue({ events: [], isReady: false });
    // Default: no notable-tail backfill (the common case — no M>=6 event in
    // the last year). Individual tests override this to exercise the
    // adaptive policy's notable carve-out.
    mockUseNotableTailEvents.mockReturnValue({ events: [] });
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

  it("hides sub-3.0 micro-events from the Home list (owner directive 2026-08-16 display floor) while keeping M>=3 events", async () => {
    const microEvent: Event = {
      ...sampleEvent,
      id: "emsc-micro-1",
      magnitude: { value: 1.8, type: "ml" },
      provenance: {
        ...sampleEvent.provenance,
        provider: "emsc",
        providerId: "emsc-micro-1",
      },
    };
    mockUseRegionEvents.mockReturnValue({
      events: [microEvent, sampleEvent],
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

    // The M4.6 card renders; the M1.8 card does not.
    expect(screen.getByText("٤.٦ پلە")).toBeTruthy();
    expect(screen.queryByText("١.٨ پلە")).toBeNull();
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

  it("renders no possible-event card when usePossibleEvents reports unconfigured/empty (the default)", async () => {
    await renderWithProviders(<HomeScreen />);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders a distinct possible-event card ABOVE the event list when one is active (D26 item 3)", async () => {
    mockUsePossibleEvents.mockReturnValue({
      events: [samplePossibleEvent],
      isReady: true,
    });

    await i18n.changeLanguage("ckb");
    await renderWithProviders(<HomeScreen />);

    const card = screen.getByRole("alert");
    expect(card).toBeTruthy();
    // Nearest-city phrasing, localized (Sorani "Slemani" — same gazetteer
    // name the M4.6 event card elsewhere in this file already asserts on).
    expect(card.props.accessibilityLabel).toMatch(/سلێمانی/);

    // The card's own message text also renders visibly (not just in the
    // a11y label) — matched as the exact templated string (not a bare
    // substring regex) since the M4.6 event card's own place line ALSO
    // contains "سلێمانی" in this same render tree.
    const expectedMessage = i18n.t("home.possibleEvent.message", { city: "سلێمانی" });
    expect(screen.getByText(expectedMessage)).toBeTruthy();
  });

  it("renders the possible-event card's unknown-area fallback text far from any gazetteer city", async () => {
    mockUsePossibleEvents.mockReturnValue({
      events: [{ ...samplePossibleEvent, lat: 0, lon: 0 }],
      isReady: true,
    });

    await renderWithProviders(<HomeScreen />);

    expect(
      screen.getByText(i18n.t("home.possibleEvent.messageUnknownArea", { lng: "en" })),
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

  describe("[regression] the accent-stripe card flips to the reading-start edge on web", () => {
    // react-native-web only resolves `borderStartColor`/`borderStartWidth`
    // from a `dir` prop threaded onto the element itself — it does not
    // inherit direction from the `<html dir="rtl">` the i18n boot sets, so
    // this only ever mattered (and only ever broke) on `Platform.OS ===
    // "web"`. See `EventCard.tsx`'s `webDirProp` comment for the full
    // root-cause writeup.
    const originalPlatformOS = Platform.OS;

    beforeAll(() => {
      Platform.OS = "web";
    });

    afterAll(() => {
      Platform.OS = originalPlatformOS;
    });

    it('passes dir="rtl" to the card in Sorani so its logical border props resolve to the visual right', async () => {
      await i18n.changeLanguage("ckb");
      await renderWithProviders(<HomeScreen />);

      const card = screen.getByTestId(`event-card-${sampleEvent.id}`);
      expect(card.props.dir).toBe("rtl");
    });

    it('passes dir="ltr" to the card in English', async () => {
      await renderWithProviders(<HomeScreen />);

      const card = screen.getByTestId(`event-card-${sampleEvent.id}`);
      expect(card.props.dir).toBe("ltr");
    });
  });

  it("never passes a web-only dir prop to the card on native", async () => {
    await i18n.changeLanguage("ckb");
    await renderWithProviders(<HomeScreen />);

    const card = screen.getByTestId(`event-card-${sampleEvent.id}`);
    expect(card.props.dir).toBeUndefined();
  });
});
