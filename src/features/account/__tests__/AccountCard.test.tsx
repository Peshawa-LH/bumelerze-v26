import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import type { UseAccountResult } from "../use-account";
import { AccountCard } from "../components/AccountCard";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("expo-crypto", () => ({
  randomUUID: () => "test-device-uuid-abcdefgh",
}));

let mockAccount: UseAccountResult;
jest.mock("../use-account", () => ({
  useAccount: () => mockAccount,
}));

const mockSignOut = jest.fn();
const mockDelete = jest.fn();
jest.mock("../service", () => ({
  signOutAccount: () => mockSignOut(),
  deleteAccount: () => mockDelete(),
  getAvatarUrl: () => null,
}));

function account(overrides: Partial<UseAccountResult>): UseAccountResult {
  return {
    status: "anonymous",
    userId: "u1",
    email: null,
    profile: null,
    privateProfile: null,
    profileLoaded: false,
    refreshProfile: async () => undefined,
    ...overrides,
  };
}

const ACCOUNT = account({
  status: "account",
  email: "shilan@example.com",
  profile: { userId: "u1", displayName: "Shilan", avatarPath: null },
  profileLoaded: true,
});

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

describe("AccountCard", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockSignOut.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("anonymous: keeps the contributor ID card and offers to create an account", async () => {
    mockAccount = account({ status: "anonymous" });
    await render(<AccountCard />);

    expect(screen.getByText("Your anonymous contributor ID")).toBeTruthy();
    expect(screen.getByText(/Show your name on reports and comments/)).toBeTruthy();
    await press("account-create");
    expect(mockPush).toHaveBeenCalledWith("/account/sign-in");
  });

  it("unconfigured: only the contributor ID card, no account call to action", async () => {
    mockAccount = account({ status: "unconfigured" });
    await render(<AccountCard />);

    expect(screen.getByText("Your anonymous contributor ID")).toBeTruthy();
    expect(screen.queryByTestId("account-create")).toBeNull();
  });

  it("account: shows name and email with edit, sign out and delete", async () => {
    mockAccount = ACCOUNT;
    await render(<AccountCard />);

    expect(screen.getByText("Shilan")).toBeTruthy();
    expect(screen.getByText("shilan@example.com")).toBeTruthy();
    expect(screen.queryByText("Your anonymous contributor ID")).toBeNull();

    await press("account-edit-profile");
    expect(mockPush).toHaveBeenCalledWith("/account/profile");

    await press("account-sign-out");
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("account without a profile yet: prompts to finish the profile", async () => {
    mockAccount = account({ status: "account", email: "a@b.co", profileLoaded: true });
    await render(<AccountCard />);

    await press("account-finish-profile");
    expect(mockPush).toHaveBeenCalledWith("/account/profile");
  });

  it("delete needs a second, confirming tap and can be cancelled", async () => {
    mockAccount = ACCOUNT;
    await render(<AccountCard />);

    await press("account-delete");
    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/permanently deletes your profile/)).toBeTruthy();

    await press("account-delete-cancel");
    expect(screen.queryByTestId("account-delete-confirm")).toBeNull();

    await press("account-delete");
    await press("account-delete-confirm");
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("shows a message when deleting fails", async () => {
    mockAccount = ACCOUNT;
    mockDelete.mockRejectedValueOnce(new Error("boom"));
    await render(<AccountCard />);

    await press("account-delete");
    await press("account-delete-confirm");
    expect(screen.getByText("Something went wrong. Try again.")).toBeTruthy();
  });
});
