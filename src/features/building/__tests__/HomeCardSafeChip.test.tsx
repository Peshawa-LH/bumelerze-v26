import { cleanup, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { HomeCard } from "../components/HomeCard";
import {
  TAG,
  clearQueryClients,
  member,
  mockTransport,
  renderWithProviders,
  resetMockTransport,
} from "../__fixtures__/testing";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "u-owner" }),
}));
jest.mock("../transport", () => ({
  ...jest.requireActual("../transport"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  SupabaseHomeTransport: require("../__fixtures__/testing").mockTransport,
}));
const mockFetchFamily = jest.fn();
jest.mock("@/features/safe/transport", () => ({
  ...jest.requireActual("@/features/safe/transport"),
  SupabaseFamilyCheckInTransport: {
    fetchFamily: (tagId: string) => mockFetchFamily(tagId),
    setSharing: jest.fn(),
  },
}));

const NOW = Date.now();

describe("Profile home card: family check-in chip", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetMockTransport();
    mockTransport.fetchMembers.mockResolvedValue([
      member("u-owner", { role: "owner" }),
      member("u-2"),
    ]);
    await i18n.changeLanguage("en");
  });
  afterEach(async () => {
    cleanup();
    await clearQueryClients();
  });

  it("shows '1 of 2 checked in' for a recent earthquake", async () => {
    mockFetchFamily.mockResolvedValue({
      myShare: true,
      sharing: ["u-owner", "u-2"],
      checkins: [
        {
          userId: "u-2",
          checkedInAt: NOW - 600_000,
          event: {
            eventId: "e1",
            bumelerzeId: null,
            magnitude: 5,
            place: null,
            originTime: NOW - 3_600_000,
          },
        },
      ],
    });
    await renderWithProviders(
      <HomeCard home={{ tag: TAG, role: "owner", assessment: null }} />,
    );
    expect(await screen.findByTestId("home-safe-tag-1")).toHaveTextContent(
      /1 of 2 checked in/,
    );
    expect(screen.getByLabelText("1 of 2 family members have checked in")).toBeTruthy();
  });

  it("no recent check-in, or no status: no chip", async () => {
    mockFetchFamily.mockResolvedValue({
      myShare: true,
      sharing: ["u-owner", "u-2"],
      checkins: [],
    });
    await renderWithProviders(
      <HomeCard home={{ tag: TAG, role: "owner", assessment: null }} />,
    );
    await screen.findByTestId("home-members-tag-1");
    expect(screen.queryByTestId("home-safe-tag-1")).toBeNull();
  });
});
