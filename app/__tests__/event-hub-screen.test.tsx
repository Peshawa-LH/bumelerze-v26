import { cleanup, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import type { Event } from "@/features/events";
import {
  buildEvent,
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";

/**
 * The Event hub route: header title, event lookup by the same id the event
 * page uses, and the "not found" fallback. The body itself is covered by
 * `EventHubContent.test.tsx`.
 */
const mockScreenOptions = jest.fn();
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  const { useEffect } = require("react");
  return {
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true }),
    useLocalSearchParams: () => ({ id: "bml20260042" }),
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => effect(), [effect]);
    },
    Stack: Object.assign(() => null, {
      Screen: (props: { options?: { title?: string } }) => {
        mockScreenOptions(props.options);
        return null;
      },
    }),
  };
});

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/feltmap/use-event-uuid", () => ({
  useEventUuid: () => "uuid-1",
  useEventUuidResult: () => ({ uuid: "uuid-1", isPending: false }),
}));
jest.mock("@/features/account", () => ({
  ...jest.requireActual("@/features/account"),
  useAccount: () => ({ status: "anonymous", userId: "anon-1" }),
}));

const mockTransport = makeTransport();
jest.mock("@/features/eventhub/transport", () => ({
  ...jest.requireActual("@/features/eventhub/transport"),
  get SupabaseEventHubTransport() {
    return mockTransport;
  },
}));

let mockEvents: Event[] = [];
jest.mock("@/features/events", () => {
  const actual = jest.requireActual("@/features/events");
  const feed = () => ({
    events: mockEvents,
    isOfflineIsh: false,
    isInitialLoading: false,
    isHardError: false,
    dataUpdatedAt: 0,
    skippedCount: 0,
    refetch: jest.fn(),
    isRefreshing: false,
  });
  return {
    ...actual,
    useRegionEvents: feed,
    useWorldEvents: () => ({ ...feed(), events: [] }),
    useEventById: () => ({ event: null, isLoading: false, isError: false }),
    useEventByBumelerzeId: () => ({ event: null, isLoading: false, isError: false }),
  };
});

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import EventHubScreen from "../event-hub/[id]";

describe("Event hub route", () => {
  beforeEach(async () => {
    mockScreenOptions.mockClear();
    mockEvents = [buildEvent({ bumelerzeId: "bml20260042" })];
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("titles the page 'Event hub' with the magnitude and place beneath", async () => {
    await renderWithProviders(<EventHubScreen />);
    expect(mockScreenOptions).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Event hub", headerShown: true }),
    );
    const subtitle = await screen.findByTestId("hub-subtitle");
    const text = [subtitle.props.children].flat().join("");
    expect(text).toMatch(/^M 4\.2 · .*Slemani/);
  });

  it.each([
    ["ckb", "ناوەندی ڕووداو"],
    ["kmr", "Navenda bûyerê"],
    ["ar", "مركز الحدث"],
  ])("has the %s title", async (locale, title) => {
    await i18n.changeLanguage(locale);
    await renderWithProviders(<EventHubScreen />);
    expect(mockScreenOptions).toHaveBeenCalledWith(expect.objectContaining({ title }));
  });

  it("says the event was not found for an unknown id", async () => {
    mockEvents = [];
    await renderWithProviders(<EventHubScreen />);
    expect(await screen.findByText("Event not found")).toBeTruthy();
    expect(screen.queryByTestId("hub-subtitle")).toBeNull();
  });
});
