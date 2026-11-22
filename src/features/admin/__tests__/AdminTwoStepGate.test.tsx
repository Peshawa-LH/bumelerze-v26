import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";

import i18n from "@/i18n";
import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";

import * as area from "../area";
import { AdminTwoStepGate } from "../components/AdminTwoStepGate";

/**
 * Admin tools need two-step sign-in (security checklist A1.1, migration
 * 0076). While the session has no code, every admin page (the admin home
 * and any tool page opened directly) shows ONE card instead of the tools:
 * turn two-step sign-in on, or enter the code.
 */

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  useFocusEffect: jest.fn(),
}));

let mockAccount: { status: string; userId: string | null } = {
  status: "account",
  userId: "u-admin",
};
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => mockAccount,
}));

type Res = { data: unknown; error: unknown };
/** `my_admin_needs_two_step()` answers `mockNeeds`; every other RPC nothing. */
let mockNeeds: Res = { data: true, error: null };
const mockRpc = jest.fn(async (name: string): Promise<Res> =>
  name === "my_admin_needs_two_step" ? mockNeeds : { data: null, error: null },
);
let mockFactors: { factor_type: string; status: string }[] = [];
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({
    rpc: (name: string) => mockRpc(name),
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "u-admin", factors: mockFactors } } },
        error: null,
      }),
    },
  }),
}));

const mockFetchPermissions = jest.fn<Promise<string[]>, []>();
jest.mock("@/features/eventhub/transport", () => ({
  ...jest.requireActual("@/features/eventhub/transport"),
  SupabaseEventHubTransport: {
    fetchMyPermissions: () => mockFetchPermissions(),
    fetchRoles: async () => ({}),
  },
}));

const TOOLS = "the page's tools";
function Tools() {
  return <Text testID="admin-tools">{TOOLS}</Text>;
}

function needsCalls(): number {
  return mockRpc.mock.calls.filter(([name]) => name === "my_admin_needs_two_step").length;
}

describe("Two-step sign-in needed (admin pages)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockAccount = { status: "account", userId: "u-admin" };
    mockFactors = [];
    mockNeeds = { data: true, error: null };
    mockFetchPermissions.mockResolvedValue([]);
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("two-step sign-in off: says why, and its one button opens the setup", async () => {
    await renderWithProviders(
      <AdminTwoStepGate>
        <Tools />
      </AdminTwoStepGate>,
    );
    expect(await screen.findByTestId("admin-two-step-card")).toBeTruthy();
    expect(screen.getByText("Two-step sign-in needed")).toBeTruthy();
    expect(
      screen.getByText(
        "Admin tools need two-step sign-in. Turning it on takes about 2 minutes.",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("admin-tools")).toBeNull();
    expect(screen.queryByTestId("admin-two-step-enter-code")).toBeNull();

    fireEvent.press(screen.getByText("Turn on two-step sign-in"));
    expect(mockPush).toHaveBeenCalledWith("/account/two-step");
  });

  it("two-step sign-in on but no code in this session: asks for the code", async () => {
    mockFactors = [{ factor_type: "totp", status: "verified" }];
    await renderWithProviders(
      <AdminTwoStepGate>
        <Tools />
      </AdminTwoStepGate>,
    );
    expect(await screen.findByTestId("admin-two-step-enter-code")).toBeTruthy();
    expect(screen.getByText("Two-step sign-in needed")).toBeTruthy();
    // The approved words of the code screen, reused.
    expect(
      screen.getByText(
        "Open your authenticator app and enter the 6-digit code for Bumelerze.",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("admin-two-step-turn-on")).toBeNull();

    fireEvent.press(screen.getByText("Enter code"));
    expect(mockPush).toHaveBeenCalledWith("/account/two-step-code");
  });

  it("the title is a heading and the button a real 44 pt+ target", async () => {
    await renderWithProviders(
      <AdminTwoStepGate>
        <Tools />
      </AdminTwoStepGate>,
    );
    const title = await screen.findByText("Two-step sign-in needed");
    expect(title.props.accessibilityRole).toBe("header");
    const button = screen.getByTestId("admin-two-step-turn-on");
    expect(button.props.accessibilityRole).toBe("button");
    const style = StyleSheet.flatten(
      typeof button.props.style === "function"
        ? button.props.style({ pressed: false })
        : button.props.style,
    ) as { minHeight?: number };
    expect(style.minHeight ?? 0).toBeGreaterThanOrEqual(44);
  });

  it("reads in Sorani, with the code screen's own Sorani body", async () => {
    await i18n.changeLanguage("ckb");
    mockFactors = [{ factor_type: "totp", status: "verified" }];
    await renderWithProviders(
      <AdminTwoStepGate>
        <Tools />
      </AdminTwoStepGate>,
    );
    expect(
      await screen.findByText(i18n.t("account.twoStep.adminNeeded.title")),
    ).toBeTruthy();
    expect(i18n.t("account.twoStep.adminNeeded.title")).not.toBe(
      "Two-step sign-in needed",
    );
    expect(screen.getByText(i18n.t("account.twoStep.challenge.body"))).toBeTruthy();
    expect(
      screen.getByText(i18n.t("account.twoStep.adminNeeded.enterCode")),
    ).toBeTruthy();
  });

  it("an admin who gave the code sees the tools, and the server is never asked", async () => {
    mockFetchPermissions.mockResolvedValue(["comments.moderate"]);
    await renderWithProviders(
      <AdminTwoStepGate>
        <Tools />
      </AdminTwoStepGate>,
    );
    expect(await screen.findByTestId("admin-tools")).toBeTruthy();
    expect(needsCalls()).toBe(0);
    expect(screen.queryByTestId("admin-two-step-card")).toBeNull();
  });

  it("an account the server says no for keeps today's page (no card)", async () => {
    mockNeeds = { data: false, error: null };
    await renderWithProviders(
      <AdminTwoStepGate>
        <Tools />
      </AdminTwoStepGate>,
    );
    await waitFor(() => expect(needsCalls()).toBe(1));
    expect(await screen.findByTestId("admin-tools")).toBeTruthy();
    expect(screen.queryByTestId("admin-two-step-card")).toBeNull();
  });

  it("[before 0076] a server without the function keeps today's page", async () => {
    mockNeeds = { data: null, error: { code: "PGRST202", message: "missing" } };
    await renderWithProviders(
      <AdminTwoStepGate>
        <Tools />
      </AdminTwoStepGate>,
    );
    await waitFor(() => expect(needsCalls()).toBe(1));
    expect(await screen.findByTestId("admin-tools")).toBeTruthy();
  });

  it("a guest never asks the server", async () => {
    mockAccount = { status: "anonymous", userId: "anon-1" };
    await renderWithProviders(
      <AdminTwoStepGate>
        <Tools />
      </AdminTwoStepGate>,
    );
    expect(await screen.findByTestId("admin-tools")).toBeTruthy();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("the admin home shows the card instead of the tool tiles", async () => {
    await renderWithProviders(<area.AdminContent />);
    expect(await screen.findByTestId("admin-two-step-card")).toBeTruthy();
    expect(screen.queryByTestId("admin-launcher")).toBeNull();
    expect(screen.queryByTestId("admin-no-access")).toBeNull();
  });

  it("the admin home shows its tiles once the code was given", async () => {
    mockFetchPermissions.mockResolvedValue(["comments.moderate"]);
    await renderWithProviders(<area.AdminContent />);
    expect(await screen.findByTestId("admin-tile-moderation")).toBeTruthy();
    expect(screen.queryByTestId("admin-two-step-card")).toBeNull();
    expect(needsCalls()).toBe(0);
  });

  it.each([
    ["People", () => <area.PeopleContent />],
    ["Activity", () => <area.ActivityContent />],
    ["Feedback message", () => <area.FeedbackDetailContent feedbackId="f-1" />],
    ["Person", () => <area.PersonContent userId="u-2" />],
  ])("a tool page opened directly (%s) shows the card too", async (_name, page) => {
    await renderWithProviders(page());
    expect(await screen.findByTestId("admin-two-step-card")).toBeTruthy();
  });
});
