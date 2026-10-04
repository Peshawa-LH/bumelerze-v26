import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useFeltQueueStore, type QueueItem, type Tier1Report } from "@/features/felt";
import i18n from "@/i18n";

const mockPush = jest.fn();
const mockScreenOptions = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    back: jest.fn(),
    canGoBack: () => true,
    replace: jest.fn(),
  }),
  Stack: Object.assign(() => null, {
    Screen: (props: { options?: { title?: string; headerLeft?: () => unknown } }) => {
      mockScreenOptions(props.options);
      return null;
    },
  }),
}));

// eslint-disable-next-line import/first -- after the mocks
import MyReportsScreen from "../my-reports";

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

function makeItem(id: string, createdAt: number): QueueItem {
  return {
    tier1: { ...SAMPLE_TIER1, reportId: id, createdAt },
    tier2: null,
    state: "queued",
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    photoState: null,
  };
}

const metrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderScreen() {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <MyReportsScreen />
    </SafeAreaProvider>,
  );
}

describe("My reports screen (full list)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    useFeltQueueStore.setState({ items: [], hasHydrated: true });
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("titles the screen 'My reports' and gives it a back button", async () => {
    await renderScreen();
    const options = mockScreenOptions.mock.calls[0]?.[0] as {
      title: string;
      headerLeft: () => unknown;
    };
    expect(options.title).toBe("My reports");
    expect(typeof options.headerLeft).toBe("function");
  });

  it("renders every report, not just a preview", async () => {
    useFeltQueueStore.setState({
      hasHydrated: true,
      items: [1, 2, 3, 4, 5].map((n) => makeItem(`r${n}`, 1_700_000_000_000 + n * 1000)),
    });
    await renderScreen();
    expect(
      screen.getAllByTestId("mydata-level-artwork", { includeHiddenElements: true }),
    ).toHaveLength(5);
  });

  it("shows the same compact empty state when there are none", async () => {
    await renderScreen();
    expect(screen.getByText("No reports yet.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("reports-empty-cta"));
    expect(mockPush).toHaveBeenCalledWith("/felt-report");
  });

  it("does not flash the empty state before the queue has hydrated", async () => {
    useFeltQueueStore.setState({ hasHydrated: false, items: [] });
    await renderScreen();
    expect(screen.queryByTestId("reports-empty")).toBeNull();
  });
});
