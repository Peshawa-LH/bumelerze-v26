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
import { __resetCheckInQueueForTests } from "../queue";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "u1" }),
}));
jest.mock("@/features/building/queries", () => ({
  useMyHomes: () => ({
    data: { homes: [{}] },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
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

function addReport(level: CartoonLevel, damage: 1 | 2 | 3 | 4 | 5 | null = null) {
  useFeltQueueStore.setState({
    items: [
      {
        tier1: {
          reportId: "r1",
          deviceId: "d1",
          eventId: "x",
          eventRegistration: EVENT,
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

async function renderCard() {
  await act(async () => {
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <FeltSafeCard feltReportId="r1" />
      </SafeAreaProvider>,
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
