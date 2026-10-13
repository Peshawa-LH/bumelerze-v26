import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  EMPTY_TIER2_ANSWERS,
  useFeltQueueStore,
  type CartoonLevel,
  type EventRegistration,
} from "@/features/felt";
import i18n from "@/i18n";

import { FeltSafeCard } from "../components/FeltSafeCard";
import { __resetCheckInQueueForTests, useCheckInStore } from "../queue";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "u1" }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  getSupabaseClient: () => null,
}));
jest.mock("../transport", () => ({
  ...jest.requireActual("../transport"),
  SupabaseCheckInTransport: {
    resolveEvent: () => Promise.resolve(null),
    checkIn: () => new Promise(() => undefined),
    retract: () => Promise.resolve(true),
  },
}));
jest.mock("@/features/events", () => ({
  ...jest.requireActual("@/features/events"),
  useRegionEvents: () => ({ events: [] }),
}));

const EVENT: EventRegistration = {
  provider: "emsc",
  providerId: "20261008_0000123",
  originTime: Date.now() - 30 * 60_000,
  lat: 36.2,
  lon: 44.0,
  depthKm: 8,
  magnitude: 5.4,
  magType: "mw",
  placeName: "Erbil",
};

function addReport(
  level: CartoonLevel,
  damage: 1 | 2 | 3 | 4 | 5 | null = null,
  event: EventRegistration | null = EVENT,
) {
  useFeltQueueStore.setState({
    items: [
      {
        tier1: {
          reportId: "r1",
          deviceId: "d1",
          eventId: "x",
          eventRegistration: event,
          cartoonLevel: level,
          location: { quality: "gps", lat: 36.19, lon: 44.01 },
          feltAt: Date.now(),
          createdAt: Date.now(),
          submittedAt: null,
        },
        tier2:
          damage === null
            ? null
            : {
                detailId: "t2",
                feltReportId: "r1",
                deviceId: "d1",
                answers: { ...EMPTY_TIER2_ANSWERS, buildingDamageLevel: damage },
                photoUri: null,
                createdAt: Date.now(),
              },
        state: "queued",
        attempts: 0,
        lastAttemptAt: null,
        nextRetryAt: null,
        photoState: null,
      },
    ],
  });
}

const metrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

let queryClient = new QueryClient();

async function renderCard() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await act(async () => {
    await render(
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider initialMetrics={metrics}>
          <FeltSafeCard feltReportId="r1" />
        </SafeAreaProvider>
      </QueryClientProvider>,
    );
  });
}

beforeEach(async () => {
  __resetCheckInQueueForTests();
  mockPush.mockReset();
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  useFeltQueueStore.setState({ items: [] });
});

describe("check-in card on the felt-report done screen", () => {
  it("level V and up: the full 'Are you safe?' card with the report's earthquake", async () => {
    addReport(5);
    await renderCard();
    expect(screen.getByTestId("felt-safe-card")).toBeTruthy();
    expect(screen.getByRole("button", { name: "I'm safe" })).toBeTruthy();
    expect(screen.getByTestId("im-safe-event-line")).toHaveTextContent(
      /After the earthquake M/,
    );
  });

  it("level III-IV: a quiet link only, to the check-in screen with the event", async () => {
    addReport(4);
    await renderCard();
    expect(screen.queryByTestId("felt-safe-card")).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId("felt-safe-link"));
    });
    const arg = mockPush.mock.calls[0]?.[0] as {
      pathname: string;
      params: { event?: string };
    };
    expect(arg.pathname).toBe("/im-safe");
    expect(typeof arg.params.event).toBe("string");
    // the check-in screen is real from a report, not a practice
    expect(arg.params).toMatchObject({ report: "r1" });
  });

  it("a report with no earthquake still sends a real check-in, tied to the report", async () => {
    addReport(6, null, null);
    await renderCard();
    expect(screen.queryByTestId("im-safe-event-line")).toBeNull();
    expect(screen.queryByText("Practice a check-in")).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId("im-safe-button"));
    });
    expect(useCheckInStore.getState().items[0]).toMatchObject({
      eventKey: "report:r1",
      event: null,
      feltReportId: "r1",
    });
  });

  it("a report with an earthquake sends the report id along with the earthquake", async () => {
    addReport(6);
    await renderCard();
    await act(async () => {
      fireEvent.press(screen.getByTestId("im-safe-button"));
    });
    expect(useCheckInStore.getState().items[0]).toMatchObject({
      eventKey: "emsc:20261008_0000123",
      feltReportId: "r1",
    });
  });

  it("level II and below: nothing", async () => {
    addReport(2);
    await renderCard();
    expect(screen.queryByTestId("felt-safe-card")).toBeNull();
    expect(screen.queryByTestId("felt-safe-link")).toBeNull();
  });

  it("damage DG3 or more: the 'cannot send help' statement comes first", async () => {
    addReport(7, 3);
    await renderCard();
    const card = screen.getByTestId("im-safe-panel");
    const first = card.children[0] as { props: { testID?: string } };
    expect(first.props.testID).toBe("im-safe-no-help");
  });

  it("never checks in by itself: reporting shaking is not 'safe'", async () => {
    addReport(8);
    await renderCard();
    expect(screen.queryByTestId("im-safe-status")).toBeNull();
  });
});
