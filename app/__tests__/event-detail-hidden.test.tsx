import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { AdminHiddenEvent } from "@/features/admin/hidden-events/transport";
import type { Event } from "@/features/events";
import {
  indexHidden,
  NO_HIDDEN,
  type HiddenEarthquake,
  type HiddenIndex,
} from "@/features/home-extras";
import i18n from "@/i18n";

/**
 * A link to an earthquake Bumelerze hid for everyone (B2.6 stage 2,
 * migration 0085, owner choice 4): a second card opens the card that stays
 * (2.21), a removed one says "Earthquake removed" (2.22), an admin with
 * `events.hide` sees it with banner 2.23. Unknown ids keep "Event not found".
 */
const mockReplace = jest.fn();
const mockNavigate = jest.fn();
let mockRouteId = "bml20260a02";

jest.mock("expo-router", () => {
  const actual = jest.requireActual("expo-router");
  return {
    ...actual,
    useRouter: () => ({
      push: jest.fn(),
      back: jest.fn(),
      replace: mockReplace,
      navigate: mockNavigate,
      canGoBack: () => true,
    }),
    useLocalSearchParams: () => ({ id: mockRouteId }),
    Stack: Object.assign(() => null, {
      ...actual.Stack,
      Screen: () => null,
    }),
  };
});

function buildEvent(id: string, overrides: Partial<Event> = {}): Event {
  return {
    id,
    bumelerzeId: null,
    originTime: Date.now() - 5 * 60_000,
    lat: 35.2,
    lon: 45.9,
    depthKm: 10,
    magnitude: { value: 4.6, type: "mb" },
    placeName: "Halabja, Iraq",
    provenance: {
      provider: "emsc",
      providerId: id,
      fetchedAt: Date.now(),
      providerUpdatedAt: Date.now(),
    },
    sig: 460,
    isRegional: true,
    url: "",
    ...overrides,
  };
}

const mockEmptyFeed = {
  events: [] as Event[],
  isOfflineIsh: false,
  isInitialLoading: false,
  isHardError: false,
  dataUpdatedAt: Date.now(),
  skippedCount: 0,
  refetch: jest.fn(),
  isRefreshing: false,
};
let mockRegionEvents: Event[] = [];
let mockByBml: Event | null = null;

jest.mock("@/features/events", () => {
  const actual = jest.requireActual("@/features/events");
  return {
    ...actual,
    useRegionEvents: () => ({ ...mockEmptyFeed, events: mockRegionEvents }),
    useWorldEvents: () => ({ ...mockEmptyFeed, events: [] }),
    useEventById: () => ({ event: null, isLoading: false, isError: false }),
    useEventByBumelerzeId: (_id: string | undefined, enabled: boolean) => ({
      event: enabled ? mockByBml : null,
      isLoading: false,
      isError: false,
    }),
    useBumelerzeId: () => ({ bumelerzeId: null }),
  };
});

const mockHidden: { current: HiddenIndex } = { current: NO_HIDDEN };
jest.mock("@/features/home-extras", () => ({
  ...jest.requireActual("@/features/home-extras"),
  useHiddenEarthquakes: () => mockHidden.current,
}));

let mockAccount: { status: string; userId?: string } = { status: "anonymous" };
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => mockAccount,
}));

let mockPerms = { permissions: [] as string[], legacy: false, isLoading: false };
jest.mock("@/features/eventhub/queries", () => ({
  ...jest.requireActual("@/features/eventhub/queries"),
  useMyPermissions: () => ({
    ...mockPerms,
    has: (permission: string) => mockPerms.permissions.includes(permission),
  }),
}));

let mockAdminRows: AdminHiddenEvent[] | undefined;
jest.mock("@/features/admin/hidden-events/queries", () => ({
  ...jest.requireActual("@/features/admin/hidden-events/queries"),
  useAdminHiddenEvents: () => ({ data: mockAdminRows }),
}));

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import EventDetailScreen from "../(tabs)/(home,map,sensor,profile,settings)/event/[id]";
// eslint-disable-next-line import/first -- see comment above
import EventHubScreen from "../(tabs)/(home,map,sensor,profile,settings)/event-hub/[id]";

const secondCard: HiddenEarthquake = {
  bumelerzeId: "bml20260a02",
  providerIds: ["20261126_0000042"],
  reasonKind: "duplicate",
  kept: { bumelerzeId: "bml20260a01", providerIds: ["us7000kept"] },
};
const removed: HiddenEarthquake = {
  bumelerzeId: "bml20260a03",
  providerIds: ["us7000blst"],
  reasonKind: "removed",
  kept: null,
};

function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        {ui}
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  mockReplace.mockClear();
  mockNavigate.mockClear();
  mockRouteId = "bml20260a02";
  mockRegionEvents = [];
  mockByBml = null;
  mockHidden.current = indexHidden([secondCard, removed]);
  mockAccount = { status: "anonymous" };
  mockPerms = { permissions: [], legacy: false, isLoading: false };
  mockAdminRows = undefined;
  if (i18n.language !== "en") await i18n.changeLanguage("en");
});

afterEach(async () => {
  await cleanup();
});

describe("Event page: hidden earthquakes (migration 0085)", () => {
  it("opens the card that stays for a link to a hidden second card (2.21)", async () => {
    mockByBml = buildEvent("20261126_0000042", { bumelerzeId: "bml20260a02" });
    await renderWithProviders(<EventDetailScreen />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/event/bml20260a01"));
    // Nothing of the hidden card shows meanwhile.
    expect(screen.queryByText(/Halabja/)).toBeNull();
    expect(screen.getByText("Loading event…")).toBeTruthy();
  });

  it("does the same for an old provider-id link to it", async () => {
    mockRouteId = "20261126_0000042";
    mockRegionEvents = [buildEvent("20261126_0000042")];
    await renderWithProviders(<EventDetailScreen />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/event/bml20260a01"));
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it("says 'Earthquake removed' for a removed one, with Back to map (2.22)", async () => {
    mockRouteId = "bml20260a03";
    mockByBml = buildEvent("us7000blst", { bumelerzeId: "bml20260a03" });
    await renderWithProviders(<EventDetailScreen />);
    expect(await screen.findByText("Earthquake removed")).toBeTruthy();
    expect(
      screen.getByText(
        "Bumelerze removed this earthquake from the app. Agencies sometimes publish an earthquake by mistake, or twice.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Halabja/)).toBeNull();
    expect(screen.queryByText("Event not found")).toBeNull();
    fireEvent.press(screen.getByTestId("earthquake-removed-map"));
    expect(mockNavigate).toHaveBeenCalledWith("/map");
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("says it even when the agency deleted the record (no event to show)", async () => {
    mockRouteId = "us7000blst";
    await renderWithProviders(<EventDetailScreen />);
    expect(await screen.findByText("Earthquake removed")).toBeTruthy();
    expect(screen.queryByText("Event not found")).toBeNull();
  });

  it("keeps 'Event not found' for an id nobody knows", async () => {
    mockRouteId = "bml20260zzz";
    await renderWithProviders(<EventDetailScreen />);
    expect(await screen.findByText("Event not found")).toBeTruthy();
    expect(screen.queryByText("Earthquake removed")).toBeNull();
  });

  it("shows the card that stays as any other earthquake", async () => {
    mockRouteId = "bml20260a01";
    mockByBml = buildEvent("us7000kept", { bumelerzeId: "bml20260a01" });
    await renderWithProviders(<EventDetailScreen />);
    expect(await screen.findByText(/bml20260a01/)).toBeTruthy();
    expect(screen.queryByTestId("hidden-event-banner")).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("waits for a signed-in account's permissions before sending it anywhere", async () => {
    mockAccount = { status: "account", userId: "u1" };
    mockPerms = { permissions: [], legacy: false, isLoading: true };
    mockByBml = buildEvent("20261126_0000042", { bumelerzeId: "bml20260a02" });
    await renderWithProviders(<EventDetailScreen />);
    expect(await screen.findByText("Loading event…")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByText(/Halabja/)).toBeNull();
  });

  it("an admin with events.hide sees the hidden card with banner 2.23, no redirect", async () => {
    mockAccount = { status: "account", userId: "admin-1" };
    mockPerms = { permissions: ["events.hide"], legacy: false, isLoading: false };
    mockByBml = buildEvent("20261126_0000042", { bumelerzeId: "bml20260a02" });
    await renderWithProviders(<EventDetailScreen />);
    expect(await screen.findByTestId("hidden-event-banner")).toBeTruthy();
    expect(
      screen.getByText(
        "Hidden for everyone else: Two cards for one earthquake. Only admins see this page.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/bml20260a02/)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("the banner gives the admin's own reason and note when the admin list has them", async () => {
    mockRouteId = "bml20260a03";
    mockAccount = { status: "account", userId: "admin-1" };
    mockPerms = { permissions: ["events.hide"], legacy: false, isLoading: false };
    mockByBml = buildEvent("us7000blst", { bumelerzeId: "bml20260a03" });
    mockAdminRows = [
      {
        eventId: "uuid-3",
        bumelerzeId: "bml20260a03",
        place: null,
        magnitude: 3.1,
        originTime: Date.now(),
        status: "published",
        reason: "other",
        note: "Test by the station team",
        hiddenAt: Date.now(),
        hiddenByName: "Peshawa",
        kept: null,
      },
    ];
    await renderWithProviders(<EventDetailScreen />);
    expect(await screen.findByTestId("hidden-event-banner")).toBeTruthy();
    expect(
      screen.getByText(
        "Hidden for everyone else: ⁨Test by the station team⁩. Only admins see this page.",
      ),
    ).toBeTruthy();
  });

  it("an admin without the list's answer still gets a truthful reason", async () => {
    mockRouteId = "bml20260a03";
    mockAccount = { status: "account", userId: "admin-1" };
    mockPerms = { permissions: ["events.hide"], legacy: false, isLoading: false };
    mockByBml = buildEvent("us7000blst", { bumelerzeId: "bml20260a03" });
    await renderWithProviders(<EventDetailScreen />);
    expect(await screen.findByTestId("hidden-event-banner")).toBeTruthy();
    expect(
      screen.getByText(
        "Hidden for everyone else: Earthquake removed. Only admins see this page.",
      ),
    ).toBeTruthy();
  });

  it("an admin without the two-step code (no events.hide in this session) is sent on like everyone", async () => {
    mockAccount = { status: "account", userId: "admin-1" };
    mockPerms = { permissions: [], legacy: false, isLoading: false };
    mockByBml = buildEvent("20261126_0000042", { bumelerzeId: "bml20260a02" });
    await renderWithProviders(<EventDetailScreen />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/event/bml20260a01"));
  });

  it("reads in Sorani", async () => {
    await i18n.changeLanguage("ckb");
    mockRouteId = "bml20260a03";
    await renderWithProviders(<EventDetailScreen />);
    expect(await screen.findByText("بوومەلەرزەکە لابرا")).toBeTruthy();
    expect(screen.getByText("گەڕانەوە بۆ نەخشە")).toBeTruthy();
  });
});

describe("Event hub: hidden earthquakes (migration 0085)", () => {
  it("opens the hub of the card that stays, where the felt reports went", async () => {
    await renderWithProviders(<EventHubScreen />);
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/event-hub/bml20260a01"),
    );
  });

  it("says 'Earthquake removed' for a removed one", async () => {
    mockRouteId = "bml20260a03";
    await renderWithProviders(<EventHubScreen />);
    expect(await screen.findByText("Earthquake removed")).toBeTruthy();
    expect(screen.queryByText("Event not found")).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
