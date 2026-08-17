import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { useFeltQueueStore, type QueueItem, type Tier1Report } from "@/features/felt";

/**
 * My Data screen (D26 item 7). Mirrors `notification-settings-screen.test.tsx`'s
 * `expo-router` mock shape (`Stack.Screen` + `useRouter`) — this screen uses
 * both (a title-setting `<Stack.Screen>` and a `router.push` from the
 * empty-state CTA).
 */

const mockPush = jest.fn();
const mockScreenOptions = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  Stack: Object.assign(() => null, {
    Screen: (props: { options?: { title?: string } }) => {
      mockScreenOptions(props.options);
      return null;
    },
  }),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: () => "test-device-uuid-abcdefgh",
}));

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import MyDataScreen from "../my-data";

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderWithProviders(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

const SAMPLE_TIER1: Tier1Report = {
  reportId: "report-1",
  deviceId: "device-abcdef1234567890",
  eventId: null,
  eventRegistration: null,
  cartoonLevel: 4,
  location: { quality: "gps", lat: 36.19, lon: 44.01 },
  feltAt: 1_700_000_000_000,
  createdAt: 1_700_000_000_000,
  submittedAt: null,
};

function makeQueueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    tier1: SAMPLE_TIER1,
    tier2: null,
    state: "queued",
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    photoState: null,
    ...overrides,
  };
}

describe("My Data screen", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    mockPush.mockClear();
    mockScreenOptions.mockClear();
    useFeltQueueStore.setState({ items: [], hasHydrated: true });
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("sets the screen title and shows the contributor id header", async () => {
    await renderWithProviders(<MyDataScreen />);

    expect(mockScreenOptions).toHaveBeenCalledWith(
      expect.objectContaining({ title: "My Data" }),
    );
    expect(screen.getByText("Your anonymous contributor ID")).toBeTruthy();

    // getDeviceId() resolves asynchronously (AsyncStorage read/write) — wait
    // for the header to settle from its loading ellipsis to the real id.
    expect(await screen.findByText("TEST-DEV")).toBeTruthy();
  });

  it("shows the empty state with an invite to report, and no contribution rows, when the queue is empty", async () => {
    await renderWithProviders(<MyDataScreen />);

    expect(screen.getByText("0 reports submitted")).toBeTruthy();
    expect(
      screen.getByText(
        "You haven't submitted a felt report yet. If you feel an earthquake, tell us about it. It takes one tap.",
      ),
    ).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Report an earthquake" }));
    expect(mockPush).toHaveBeenCalledWith("/felt-report");
  });

  it("renders one row per queued report, newest first, with artwork/date/sync status", async () => {
    useFeltQueueStore.setState({
      hasHydrated: true,
      items: [
        makeQueueItem({
          tier1: { ...SAMPLE_TIER1, reportId: "older", createdAt: 1_700_000_000_000 },
          state: "queued",
        }),
        makeQueueItem({
          tier1: { ...SAMPLE_TIER1, reportId: "newer", createdAt: 1_700_100_000_000 },
          state: "submitted",
        }),
      ],
    });

    await renderWithProviders(<MyDataScreen />);

    expect(screen.getByText("2 reports submitted")).toBeTruthy();
    expect(screen.queryByText("You haven't submitted a felt report yet.")).toBeNull();

    const submittedTexts = screen.getAllByText("Submitted");
    const onDeviceTexts = screen.getAllByText("On this device");
    expect(submittedTexts).toHaveLength(1);
    expect(onDeviceTexts).toHaveLength(1);

    expect(
      screen.getAllByTestId("mydata-level-artwork", { includeHiddenElements: true }),
    ).toHaveLength(2);
  });

  it("does not flash the empty state before the persisted queue has hydrated", async () => {
    useFeltQueueStore.setState({ hasHydrated: false, items: [] });

    await renderWithProviders(<MyDataScreen />);

    expect(
      screen.queryByText(
        "You haven't submitted a felt report yet. If you feel an earthquake, tell us about it. It takes one tap.",
      ),
    ).toBeNull();
  });
});
