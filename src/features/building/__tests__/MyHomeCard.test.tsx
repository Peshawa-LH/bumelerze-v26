import { act, cleanup, fireEvent, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { MyHomeCard } from "../components/MyHomeCard";
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

describe("My home card", () => {
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

  it("anonymous: one muted locked row (a preview, not a second sign-up button)", async () => {
    mockAccount = { status: "anonymous", userId: "a1" };
    await renderWithProviders(<MyHomeCard />);
    expect(screen.getByText("My home")).toBeTruthy();
    expect(screen.getByText("Tag my building")).toBeTruthy();
    expect(screen.getByTestId("home-locked")).toBeTruthy();
    const row = screen.getByTestId("home-section-sign-in");
    expect(row.props.accessibilityHint).toBe("Needs an account");
    expect(screen.queryByText("Create an account")).toBeNull();
    expect(screen.queryByTestId("account-create")).toBeNull();
    expect(screen.queryByTestId("home-join")).toBeNull();
    await press("home-section-sign-in");
    expect(mockPush).toHaveBeenCalledWith("/account/sign-in");
    expect(mockTransport.fetchMemberships).not.toHaveBeenCalled();
  });

  it("unconfigured: nothing at all", async () => {
    mockAccount = { status: "unconfigured", userId: null };
    await renderWithProviders(<MyHomeCard />);
    expect(screen.queryByTestId("home-section")).toBeNull();
    expect(screen.queryByText("My home")).toBeNull();
  });

  it("no home yet: a 'Tag my building' card and a 'Join a home' link", async () => {
    await renderWithProviders(<MyHomeCard />);
    expect(await screen.findByTestId("home-tag")).toBeTruthy();
    await press("home-tag");
    expect(mockPush).toHaveBeenCalledWith("/home/new");
    await press("home-join");
    expect(mockPush).toHaveBeenCalledWith("/home/join");
    expect(screen.getByText("Tag my building")).toBeTruthy();
  });

  it("tagged: a home card with label, code, class badge, members and the two actions", async () => {
    mockTransport.fetchMemberships.mockResolvedValue([
      member("u-owner", { role: "owner" }),
    ]);
    mockTransport.fetchTags.mockResolvedValue([TAG]);
    mockTransport.fetchLatestAssessments.mockResolvedValue({
      "tag-1": storedAssessment(),
    });
    mockTransport.fetchMembers.mockResolvedValue([
      member("u-owner", { role: "owner" }),
      member("u-two"),
      member("u-three"),
    ]);
    await renderWithProviders(<MyHomeCard />);
    expect(await screen.findByTestId("home-card-tag-1")).toBeTruthy();
    expect((await screen.findByTestId("home-members-tag-1")).props.accessibilityLabel).toBe(
      "Members: 3",
    );
    expect(screen.getByText("Our house")).toBeTruthy();
    expect(screen.getByText(/BMH-7K3Q9P/)).toBeTruthy();
    expect(screen.getByTestId("home-vc-tag-1").props.accessibilityLabel).toMatch(
      /^Vulnerability class [A-F]$/,
    );
    expect(screen.queryByTestId("home-skeleton")).toBeNull();
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
    await renderWithProviders(<MyHomeCard />);
    expect(await screen.findByText("No report yet.")).toBeTruthy();
    expect(screen.getByText("House")).toBeTruthy();
    await press("home-report-tag-1");
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/home/[tagId]/report",
      params: { tagId: "tag-1" },
    });
  });

  it("shows one skeleton card while the homes load", async () => {
    mockTransport.fetchMemberships.mockReturnValue(new Promise(() => undefined));
    await renderWithProviders(<MyHomeCard />);
    expect(screen.getByTestId("home-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("home-tag")).toBeNull();
  });

  it("archived homes are not listed", async () => {
    mockTransport.fetchMemberships.mockResolvedValue([
      member("u-owner", { role: "owner" }),
    ]);
    mockTransport.fetchTags.mockResolvedValue([{ ...TAG, status: "archived" }]);
    await renderWithProviders(<MyHomeCard />);
    expect(await screen.findByTestId("home-tag")).toBeTruthy();
    expect(screen.queryByTestId("home-card-tag-1")).toBeNull();
  });

  it("shows a waiting note for a join request nobody approved yet", async () => {
    mockTransport.fetchMemberships.mockResolvedValue([
      member("u-owner", { status: "pending", tagId: "other" }),
    ]);
    await renderWithProviders(<MyHomeCard />);
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
    await renderWithProviders(<MyHomeCard />);
    expect(await screen.findByTestId("home-card-t5")).toBeTruthy();
    expect(screen.queryByTestId("home-tag")).toBeNull();
    expect(screen.getByTestId("home-join")).toBeTruthy();
  });

  it("offers a retry when the homes cannot be loaded", async () => {
    mockTransport.fetchMemberships.mockRejectedValueOnce(new Error("offline"));
    await renderWithProviders(<MyHomeCard />);
    expect(await screen.findByText("Could not load your home.")).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
    expect(screen.queryByTestId("home-skeleton")).toBeNull();
  });
});
