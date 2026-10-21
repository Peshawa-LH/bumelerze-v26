import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { FeltReportPill } from "@/features/felt";
import { useTabBarStore } from "@/features/tab-bar/store";
import i18n from "@/i18n";
import { lightColors } from "@/theme/semantic";

import { EventHubPill, HUB_PILL_MIN_WIDTH } from "../components/EventHubPill";
import { buildEvent, EMPTY_SUMMARY, renderWithProviders } from "../__fixtures__/testing";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

let mockConfigured = true;
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => mockConfigured,
  getSupabaseClient: () => null,
}));

jest.mock("@/features/feltmap/use-event-uuid", () => ({
  useEventUuid: () => "uuid-1",
  useEventUuidResult: () => ({ uuid: "uuid-1", isPending: false }),
}));

const mockFetchSummary = jest.fn();
jest.mock("../transport", () => ({
  ...jest.requireActual("../transport"),
  SupabaseEventHubTransport: {
    fetchSummary: (...args: unknown[]) => mockFetchSummary(...args),
  },
}));

const DAY = 24 * 60 * 60 * 1000;
const PILL_LABEL = "Who felt it?";

describe("EventHubPill", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    mockFetchSummary.mockReset();
    mockFetchSummary.mockResolvedValue(EMPTY_SUMMARY);
    mockConfigured = true;
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("shows for a recent regional event even with no activity", async () => {
    await renderWithProviders(
      <EventHubPill event={buildEvent()} routeId="bml20260042" />,
    );
    expect(screen.getByRole("button", { name: PILL_LABEL })).toBeTruthy();
  });

  it("hides for a regional event older than 72 hours with no reports or comments", async () => {
    await renderWithProviders(
      <EventHubPill
        event={buildEvent({ originTime: Date.now() - 10 * DAY })}
        routeId="bml20260042"
      />,
    );
    // Let the summary query settle; it stays hidden.
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByRole("button", { name: PILL_LABEL })).toBeNull();
  });

  it("shows for an old regional event once it has reports or comments", async () => {
    mockFetchSummary.mockResolvedValue({ ...EMPTY_SUMMARY, reports: 3, people: 3 });
    await renderWithProviders(
      <EventHubPill
        event={buildEvent({ originTime: Date.now() - 10 * DAY })}
        routeId="bml20260042"
      />,
    );
    expect(await screen.findByRole("button", { name: PILL_LABEL })).toBeTruthy();
  });

  it("never shows for a world (non-regional) event", async () => {
    mockFetchSummary.mockResolvedValue({ ...EMPTY_SUMMARY, reports: 50, comments: 9 });
    await renderWithProviders(
      <EventHubPill event={buildEvent({ isRegional: false })} routeId="bml20260042" />,
    );
    expect(screen.queryByRole("button", { name: PILL_LABEL })).toBeNull();
  });

  it("is hidden when no Supabase project is configured", async () => {
    mockConfigured = false;
    await renderWithProviders(
      <EventHubPill event={buildEvent()} routeId="bml20260042" />,
    );
    expect(screen.queryByRole("button", { name: PILL_LABEL })).toBeNull();
  });

  it("opens the hub for the given route id", async () => {
    await renderWithProviders(
      <EventHubPill event={buildEvent()} routeId="bml20260042" />,
    );
    fireEvent.press(screen.getByRole("button", { name: PILL_LABEL }));
    expect(mockPush).toHaveBeenCalledWith("/event-hub/bml20260042");
  });

  it("floats at the bottom-START corner in the brand colour, not the felt red", async () => {
    await renderWithProviders(
      <EventHubPill event={buildEvent()} routeId="bml20260042" />,
    );
    const style = StyleSheet.flatten(screen.getByTestId("event-hub-pill").props.style);
    expect(style.start).toBe(16);
    expect(style.end).toBeUndefined();
    expect(style.position).toBe("absolute");
    expect(style.minHeight).toBe(48);
    // Sorani-sized target in every language (owner, 2026-10-08).
    expect(style.minWidth).toBe(HUB_PILL_MIN_WIDTH);
    expect(style.alignItems).toBe("center");
    expect(style.backgroundColor).toBe(lightColors.brand.primary);
    expect(style.backgroundColor).not.toBe(lightColors.action.felt);
  });

  it.each([
    ["ckb", "کێ هەستی پێکرد؟"],
    ["kmr", "Kî hîs kir?"],
    ["ar", "من شعر به؟"],
  ])("is labelled in %s", async (locale, label) => {
    await i18n.changeLanguage(locale);
    await renderWithProviders(
      <EventHubPill event={buildEvent()} routeId="bml20260042" />,
    );
    expect(screen.getByRole("button", { name: label })).toBeTruthy();
  });

  describe("height above the bottom edge, on an iPhone with a home indicator", () => {
    const withHomeIndicator = {
      frame: { x: 0, y: 0, width: 402, height: 874 },
      insets: { top: 0, left: 0, right: 0, bottom: 34 },
    };

    function renderOnIphone(ui: React.ReactElement) {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      });
      return render(
        <QueryClientProvider client={client}>
          <SafeAreaProvider initialMetrics={withHomeIndicator}>{ui}</SafeAreaProvider>
        </QueryClientProvider>,
      );
    }

    const bottomOf = (testID: string) =>
      StyleSheet.flatten(screen.getByTestId(testID).props.style).bottom;

    afterEach(() => {
      cleanup();
      useTabBarStore.setState({ hidden: false, inLayout: true });
    });

    it("sits 16 pt above the tab bar, without the inset the bar already holds", async () => {
      useTabBarStore.setState({ hidden: false, inLayout: true });
      await renderOnIphone(<EventHubPill event={buildEvent()} routeId="bml20260042" />);
      expect(bottomOf("event-hub-pill")).toBe(16);
    });

    it("clears the home indicator once the tab bar has slid away", async () => {
      useTabBarStore.setState({ hidden: true, inLayout: false });
      await renderOnIphone(<EventHubPill event={buildEvent()} routeId="bml20260042" />);
      expect(bottomOf("event-hub-pill")).toBe(34 + 16);
    });

    // The event page's two pills, as the owner saw them on the iOS
    // simulator (2026-10-21): "Who felt it?" sat 34 pt above "I felt it!".
    it.each([
      ["shown", { hidden: false, inLayout: true }],
      ["slid away", { hidden: true, inLayout: false }],
    ])("shares one bottom line with the felt pill, tab bar %s", async (_state, tabBar) => {
      useTabBarStore.setState(tabBar);
      const event = buildEvent();
      await renderOnIphone(
        <>
          <FeltReportPill eventId={event.id} event={event} />
          <EventHubPill event={event} routeId="bml20260042" />
        </>,
      );
      const feltBottom = StyleSheet.flatten(
        screen.getByRole("button", { name: "I felt it!" }).props.style,
      ).bottom;
      expect(bottomOf("event-hub-pill")).toBe(feltBottom);
    });
  });
});
