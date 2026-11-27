import { cleanup, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { Event } from "@/features/events";
import type { HiddenEarthquake } from "@/features/home-extras";
import i18n from "@/i18n";

/**
 * Significant and World leave out the earthquakes Bumelerze hid for
 * everyone (B2.6 stage 2, migration 0085), by id only: the card that stays
 * is kept.
 */
jest.mock("expo-router", () => {
  const actual = jest.requireActual("expo-router");
  return {
    ...actual,
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true }),
    Stack: Object.assign(() => null, { ...actual.Stack, Screen: () => null }),
  };
});

function mockEvent(id: string, overrides: Partial<Event> = {}): Event {
  return {
    id,
    bumelerzeId: null,
    originTime: Date.now() - 30 * 60_000,
    lat: 35.56,
    lon: 45.43,
    depthKm: 10,
    magnitude: { value: 5.6, type: "mww" },
    placeName: "",
    provenance: {
      provider: "usgs",
      providerId: id,
      fetchedAt: Date.now(),
      providerUpdatedAt: Date.now(),
    },
    sig: 600,
    isRegional: true,
    url: "",
    ...overrides,
  };
}

const mockKept = mockEvent("us7000kept");
const mockSecondCard = mockEvent("20261126_0000042", {
  originTime: mockKept.originTime + 40_000,
  sig: 590,
  provenance: {
    ...mockKept.provenance,
    provider: "emsc",
    providerId: "20261126_0000042",
  },
});
const mockBlast = mockEvent("us7000blst", {
  lat: 10,
  lon: 10,
  isRegional: false,
  sig: 700,
});

const mockFeed = (events: Event[]) => ({
  events,
  isInitialLoading: false,
  isOfflineIsh: false,
  isHardError: false,
  isRefreshing: false,
  dataUpdatedAt: Date.now(),
  skippedCount: 0,
  refetch: jest.fn(),
});

jest.mock("@/features/events", () => {
  const actual = jest.requireActual("@/features/events");
  return {
    ...actual,
    useRegionEvents: () => mockFeed([mockSecondCard, mockKept]),
    useWorldEvents: () => mockFeed([mockBlast, mockKept]),
  };
});
jest.mock("@/features/events/source-corroboration", () => ({
  ...jest.requireActual("@/features/events/source-corroboration"),
  useEventSourceAgencies: () => new Map(),
}));

const mockHidden: HiddenEarthquake[] = [
  {
    bumelerzeId: "bml20260a02",
    providerIds: ["20261126_0000042"],
    reasonKind: "duplicate",
    kept: { bumelerzeId: "bml20260a01", providerIds: ["us7000kept"] },
  },
  {
    bumelerzeId: "bml20260a03",
    providerIds: ["us7000blst"],
    reasonKind: "removed",
    kept: null,
  },
];
jest.mock("@/features/home-extras", () => {
  const actual = jest.requireActual("@/features/home-extras");
  return { ...actual, useHiddenEarthquakes: () => actual.indexHidden(mockHidden) };
});

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import SignificantScreen from "../(tabs)/(home,map,sensor,profile,settings)/significant";
// eslint-disable-next-line import/first -- see comment above
import WorldScreen from "../(tabs)/(home,map,sensor,profile,settings)/world";

function renderScreen(ui: ReactElement) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      {ui}
    </SafeAreaProvider>,
  );
}

function cardIds(): string[] {
  return screen.getAllByTestId(/^event-card-/).map((card) => card.props.testID as string);
}

beforeEach(async () => {
  if (i18n.language !== "en") await i18n.changeLanguage("en");
});
afterEach(cleanup);

describe("hidden earthquakes on Significant and World (migration 0085)", () => {
  it("Significant shows the card that stays and neither hidden one", async () => {
    await renderScreen(<SignificantScreen />);
    expect(cardIds()).toEqual(["event-card-us7000kept"]);
  });

  it("World leaves the hidden one out", async () => {
    await renderScreen(<WorldScreen />);
    expect(cardIds()).toEqual(["event-card-us7000kept"]);
  });
});
