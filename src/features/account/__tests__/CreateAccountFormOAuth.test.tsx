import { act, fireEvent, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { CreateAccountForm } from "../components/CreateAccountForm";
import { AccountError } from "../types";

const mockStartOAuth = jest.fn();
jest.mock("../service", () => ({
  createAccountWithPassword: jest.fn(),
  startOAuth: (...args: unknown[]) => mockStartOAuth(...args),
}));

async function pressGoogle() {
  await act(async () => {
    fireEvent.press(screen.getByTestId("account-google"));
  });
}

describe("Create account: Google / Apple (flag-gated)", () => {
  beforeEach(async () => {
    mockStartOAuth.mockReset();
    process.env.EXPO_PUBLIC_AUTH_GOOGLE = "1";
    process.env.EXPO_PUBLIC_AUTH_APPLE = "1";
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_AUTH_GOOGLE;
    delete process.env.EXPO_PUBLIC_AUTH_APPLE;
  });

  it("carries on like a new account once the app's sign-in sheet comes back signed in", async () => {
    mockStartOAuth.mockResolvedValueOnce("signedIn");
    const onCreated = jest.fn();
    await render(<CreateAccountForm onCreated={onCreated} />);
    await pressGoogle();
    expect(mockStartOAuth).toHaveBeenCalledWith("google");
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("account-error")?.props.children ?? null).toBeFalsy();
  });

  it("does nothing and says nothing when the sheet was closed, or the web left the page", async () => {
    const onCreated = jest.fn();
    await render(<CreateAccountForm onCreated={onCreated} />);
    mockStartOAuth.mockResolvedValueOnce("cancelled");
    await pressGoogle();
    mockStartOAuth.mockResolvedValueOnce("redirecting");
    await pressGoogle();
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.queryByText("Something went wrong. Try again.")).toBeNull();
  });

  it("shows the account error text when it fails", async () => {
    mockStartOAuth.mockRejectedValueOnce(new AccountError("network"));
    const onCreated = jest.fn();
    await render(<CreateAccountForm onCreated={onCreated} />);
    await pressGoogle();
    expect(screen.getByText("No connection. Try again.")).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
