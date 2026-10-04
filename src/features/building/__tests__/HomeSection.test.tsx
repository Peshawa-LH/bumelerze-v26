import { act, cleanup, fireEvent, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { HomeSection } from "../components/HomeSection";
import {
  TAG,
  clearQueryClients,
  member,
  mockTransport,
  renderWithProviders,
  resetMockTransport,
  storedAssessment,
} from "../__fixtures__/testing";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
let mockAccount: { status: string; userId: string | null } = {
  status: "account",
  userId: "u-owner",
};
jest.mock("@/features/account/use-account", () => ({ useAccount: () => mockAccount }));
jest.mock("../transport", () => ({
  ...jest.requireActual("../transport"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  SupabaseHomeTransport: require("../__fixtures__/testing").mockTransport,
}));

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

describe("My home section", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetMockTransport();
    mockAccount = { status: "account", userId: "u-owner" };
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(async () => {
    cleanup();
    await clearQueryClients();
  });

  it("anonymous: a card that leads to account sign-in", async () => {
    mockAccount = { status: "anonymous", userId: "a1" };
    await renderWithProviders(<HomeSection />);
    expect(screen.getByText("Create an account to tag your home.")).toBeTruthy();
    await press("home-section-sign-in");
    expect(mockPush).toHaveBeenCalledWith("/account/sign-in");
    expect(mockTransport.fetchMemberships).not.toHaveBeenCalled();
  });

  it("unconfigured: nothing at all", async () => {
    mockAccount = { status: "unconfigured", userId: null };
    await renderWithProviders(<HomeSection />);
    expect(screen.queryByTestId("home-section")).toBeNull();
    expect(screen.queryByText("My home")).toBeNull();
  });

  it("no home yet: 'Tag my building' and 'Join a home'", async () => {
    await renderWithProviders(<HomeSection />);
    expect(
      await screen.findByText("Tag your home to get a free safety report."),
    ).toBeTruthy();
    await press("home-tag");
    expect(mockPush).toHaveBeenCalledWith("/home/new");
    await press("home-join");
    expect(mockPush).toHaveBeenCalledWith("/home/join");
    expect(screen.getByText("Tag my building")).toBeTruthy();
  });

  it("tagged: a home card with label, code, class badge and the two actions", async () => {
    mockTransport.fetchMemberships.mockResolvedValue([
      member("u-owner", { role: "owner" }),
    ]);
    mockTransport.fetchTags.mockResolvedValue([TAG]);
    mockTransport.fetchLatestAssessments.mockResolvedValue({
      "tag-1": storedAssessment(),
    });
    await renderWithProviders(<HomeSection />);
    expect(await screen.findByTestId("home-card-tag-1")).toBeTruthy();
    expect(screen.getByText("Our house")).toBeTruthy();
    expect(screen.getByText(/BMH-7K3Q9P/)).toBeTruthy();
    expect(screen.getByTestId("home-vc-tag-1").props.accessibilityLabel).toMatch(
      /^Vulnerability class [A-F]$/,
    );
    expect(screen.queryByText("Tag your home to get a free safety report.")).toBeNull();
    await press("home-report-tag-1");
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/home/[tagId]/report",
      params: { tagId: "tag-1" },
    });
    await press("home-family-tag-1");
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/home/[tagId]/family",
      params: { tagId: "tag-1" },
    });
    expect(screen.getByText("Tag another home")).toBeTruthy();
  });

  it("a home without a report yet says so and still opens", async () => {
    mockTransport.fetchMemberships.mockResolvedValue([
      member("u-owner", { role: "owner" }),
    ]);
    mockTransport.fetchTags.mockResolvedValue([{ ...TAG, label: null }]);
    await renderWithProviders(<HomeSection />);
    expect(await screen.findByText("No report yet.")).toBeTruthy();
    expect(screen.getByText("House")).toBeTruthy();
  });

  it("archived homes are not listed", async () => {
    mockTransport.fetchMemberships.mockResolvedValue([
      member("u-owner", { role: "owner" }),
    ]);
    mockTransport.fetchTags.mockResolvedValue([{ ...TAG, status: "archived" }]);
    await renderWithProviders(<HomeSection />);
    expect(
      await screen.findByText("Tag your home to get a free safety report."),
    ).toBeTruthy();
  });

  it("shows a waiting note for a join request nobody approved yet", async () => {
    mockTransport.fetchMemberships.mockResolvedValue([
      member("u-owner", { status: "pending", tagId: "other" }),
    ]);
    await renderWithProviders(<HomeSection />);
    expect(await screen.findByTestId("home-pending")).toBeTruthy();
  });

  it("stops offering new tags at five owned homes", async () => {
    const tags = [1, 2, 3, 4, 5].map((n) => ({
      ...TAG,
      tagId: `t${n}`,
      code: `BMH-00000${n}`,
    }));
    mockTransport.fetchMemberships.mockResolvedValue(
      tags.map((tag) => member("u-owner", { tagId: tag.tagId, role: "owner" })),
    );
    mockTransport.fetchTags.mockResolvedValue(tags);
    await renderWithProviders(<HomeSection />);
    expect(await screen.findByTestId("home-card-t5")).toBeTruthy();
    expect(screen.queryByTestId("home-tag")).toBeNull();
    expect(screen.getByTestId("home-join")).toBeTruthy();
  });

  it("offers a retry when the homes cannot be loaded", async () => {
    mockTransport.fetchMemberships.mockRejectedValueOnce(new Error("offline"));
    await renderWithProviders(<HomeSection />);
    expect(await screen.findByText("Could not load your home.")).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
  });
});
