import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";

import { AdminContent } from "../components/AdminContent";
import { generateTempPassword } from "../temp-password";
import type { AdminTransport } from "../transport";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
let mockAccount: { status: string; userId: string | null } = {
  status: "account",
  userId: "admin-1",
};
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => mockAccount,
}));

const mockSetString = jest.fn();
jest.mock("expo-clipboard", () => ({
  setStringAsync: (text: string) => mockSetString(text),
}));
jest.mock("../temp-password", () => ({
  generateTempPassword: jest.fn(() => "K7QM-2XWD-9HPA"),
}));

const mockHub = makeTransport({ permissions: [] });
const mockConfirm = jest.fn();
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: (options: unknown) => mockConfirm(options),
  messageDialog: jest.fn(),
}));

const ADMIN: Permission[] = [
  "comments.moderate",
  "comments.delete",
  "badges.grant",
  "hubs.feature",
  "accounts.reset_password",
];

function makeAdminTransport(
  overrides: Partial<AdminTransport> = {},
): jest.Mocked<AdminTransport> {
  return {
    fetchQueue: jest.fn(async () => [
      {
        id: "c1",
        eventId: "e1",
        hubId: "bml202610aa",
        authorId: "u1",
        authorName: "Dilan",
        body: "Please approve me",
        status: "pending" as const,
        flagCount: 0,
        createdAt: 1,
      },
      {
        id: "c2",
        eventId: "e1",
        hubId: null,
        authorId: "u2",
        authorName: "Aso",
        body: "Reported text",
        status: "visible" as const,
        flagCount: 2,
        createdAt: 2,
      },
    ]),
    fetchRoleHolders: jest.fn(async () => [
      {
        userId: "u9",
        username: "nasrin",
        displayName: "Nasrin",
        role: "professor" as const,
        orgName: null,
        grantedAt: 1,
        grantedByName: "Bumelerze team",
        note: null,
      },
    ]),
    fetchReportedProfiles: jest.fn(async () => [
      {
        userId: "u7",
        username: "spammer",
        displayName: "Spammer",
        reportCount: 2,
        lastReason: "spam",
      },
    ]),
    grantRole: jest.fn(async () => undefined),
    revokeRole: jest.fn(async () => undefined),
    resolveProfileReports: jest.fn(async () => undefined),
    fetchReportedPosts: jest.fn(async () => []),
    dismissPostReports: jest.fn(async () => undefined),
    findAccounts: jest.fn(async () => [
      {
        userId: "u5",
        username: "dilan",
        displayName: "Dilan",
        maskedEmail: "d***@gmail.com",
      },
    ]),
    resetPassword: jest.fn(async () => undefined),
    ...overrides,
  } as jest.Mocked<AdminTransport>;
}

function givePermissions(permissions: Permission[] | null) {
  if (permissions === null) {
    mockHub.fetchMyPermissions.mockRejectedValue(new Error("my_permissions is missing"));
  } else {
    mockHub.fetchMyPermissions.mockResolvedValue(permissions);
  }
}

describe("AdminContent", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    mockConfirm.mockClear();
    mockHub.moderateComment.mockClear();
    mockHub.adminDeleteComment.mockClear();
    mockHub.adminRestoreComment.mockReset();
    mockHub.adminRestoreComment.mockResolvedValue(undefined);
    mockAccount = { status: "account", userId: "admin-1" };
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("shows the queue, reported profiles and rank badges to an admin", async () => {
    givePermissions(ADMIN);
    await renderWithProviders(
      <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
    );
    expect(await screen.findByTestId("admin-queue")).toBeTruthy();
    expect(await screen.findByTestId("admin-ranks")).toBeTruthy();
    expect(await screen.findByTestId("admin-reports")).toBeTruthy();
    expect(screen.getByText("Please approve me")).toBeTruthy();
    expect(screen.getByText("Reported text")).toBeTruthy();
    expect(screen.getByTestId("holder-u9-professor")).toBeTruthy();
  });

  it("shows a moderator the queue and reports, but no rank badges and no Remove", async () => {
    givePermissions(["comments.moderate"]);
    await renderWithProviders(
      <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
    );
    expect(await screen.findByTestId("admin-queue")).toBeTruthy();
    expect(screen.queryByTestId("admin-ranks")).toBeNull();
    expect(screen.queryByTestId("queue-remove-c1")).toBeNull();
  });

  it("shows an ordinary account nothing but a 'not allowed' line", async () => {
    givePermissions([]);
    const transport = makeAdminTransport();
    await renderWithProviders(
      <AdminContent transport={transport} hubTransport={mockHub} />,
    );
    expect(await screen.findByTestId("admin-no-access")).toBeTruthy();
    expect(screen.queryByTestId("admin-queue")).toBeNull();
    expect(transport.fetchQueue).not.toHaveBeenCalled();
    expect(transport.fetchRoleHolders).not.toHaveBeenCalled();
  });

  it("shows no admin tools when the server has no my_permissions yet, even for an official", async () => {
    givePermissions(null);
    mockHub.fetchRoles.mockResolvedValue({
      "admin-1": [{ role: "official", orgName: null }],
    });
    const transport = makeAdminTransport();
    await renderWithProviders(
      <AdminContent transport={transport} hubTransport={mockHub} />,
    );
    expect(await screen.findByTestId("admin-no-access")).toBeTruthy();
    expect(transport.fetchQueue).not.toHaveBeenCalled();
    mockHub.fetchRoles.mockReset();
  });

  it("approves and hides through moderate_comment", async () => {
    givePermissions(ADMIN);
    await renderWithProviders(
      <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
    );
    await act(async () => {
      fireEvent.press(await screen.findByTestId("queue-approve-c1"));
    });
    await waitFor(() =>
      expect(mockHub.moderateComment).toHaveBeenCalledWith("c1", "approve"),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("queue-hide-c2"));
    });
    await waitFor(() =>
      expect(mockHub.moderateComment).toHaveBeenCalledWith("c2", "hide"),
    );
  });

  it("removes a comment with a reason and a confirmation", async () => {
    givePermissions(ADMIN);
    await renderWithProviders(
      <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
    );
    await fireEvent.press(await screen.findByTestId("queue-remove-c2"));
    await fireEvent.press(await screen.findByTestId("remove-reason-false"));
    expect(mockHub.adminDeleteComment).not.toHaveBeenCalled();
    const options = mockConfirm.mock.calls[0]?.[0] as { onConfirm: () => void };
    options.onConfirm();
    await waitFor(() =>
      expect(mockHub.adminDeleteComment).toHaveBeenCalledWith("c2", "false"),
    );
  });

  it("offers Undo for 10 s after Hide, and Undo restores the comment", async () => {
    givePermissions(ADMIN);
    await renderWithProviders(
      <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
    );
    await fireEvent.press(await screen.findByTestId("queue-hide-c2"));
    await waitFor(() =>
      expect(mockHub.moderateComment).toHaveBeenCalledWith("c2", "hide"),
    );
    expect(await screen.findByTestId("snackbar-message")).toHaveTextContent(
      "Comment hidden",
    );
    expect(mockHub.adminRestoreComment).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("snackbar-action"));
    await waitFor(() => expect(mockHub.adminRestoreComment).toHaveBeenCalledWith("c2"));
  });

  it("offers Undo after Remove too, and no Undo when the action failed", async () => {
    givePermissions(ADMIN);
    await renderWithProviders(
      <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
    );
    mockHub.adminDeleteComment.mockRejectedValueOnce(new Error("boom"));
    await fireEvent.press(await screen.findByTestId("queue-remove-c2"));
    await fireEvent.press(await screen.findByTestId("remove-reason-false"));
    await act(async () => {
      (mockConfirm.mock.calls[0]?.[0] as { onConfirm: () => void }).onConfirm();
    });
    await waitFor(() => expect(mockHub.adminDeleteComment).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("snackbar")).toBeNull();

    // the reason picker stays open after a failure: pick again
    await fireEvent.press(await screen.findByTestId("remove-reason-spam"));
    await act(async () => {
      (mockConfirm.mock.calls[1]?.[0] as { onConfirm: () => void }).onConfirm();
    });
    expect(await screen.findByTestId("snackbar-message")).toHaveTextContent(
      "Comment removed",
    );
    await fireEvent.press(screen.getByTestId("snackbar-action"));
    await waitFor(() => expect(mockHub.adminRestoreComment).toHaveBeenCalledWith("c2"));
  });

  it("approving offers no Undo (nothing was taken down)", async () => {
    givePermissions(ADMIN);
    await renderWithProviders(
      <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
    );
    await fireEvent.press(await screen.findByTestId("queue-approve-c1"));
    await waitFor(() =>
      expect(mockHub.moderateComment).toHaveBeenCalledWith("c1", "approve"),
    );
    expect(screen.queryByTestId("snackbar")).toBeNull();
  });

  it("opens the event hub of a queued comment", async () => {
    givePermissions(ADMIN);
    await renderWithProviders(
      <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
    );
    await fireEvent.press(await screen.findByTestId("queue-open-c1"));
    expect(mockPush).toHaveBeenCalledWith("/event-hub/bml202610aa");
    expect(screen.queryByTestId("queue-open-c2")).toBeNull(); // no hub id, no link
  });

  it("gives a rank by @username, without the @, lowercase", async () => {
    givePermissions(ADMIN);
    const transport = makeAdminTransport();
    await renderWithProviders(
      <AdminContent transport={transport} hubTransport={mockHub} />,
    );
    const input = await screen.findByTestId("admin-username-input");
    expect(screen.getByTestId("admin-grant").props.accessibilityState.disabled).toBe(
      true,
    );
    await act(async () => {
      fireEvent.changeText(input, "@Nasrin.K");
      fireEvent.press(screen.getByTestId("admin-rank-seismologist"));
      fireEvent.changeText(screen.getByTestId("admin-note-input"), "ID checked");
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("admin-grant"));
    });
    expect(transport.grantRole).toHaveBeenCalledWith({
      username: "nasrin.k",
      role: "seismologist",
      orgName: null,
      note: "ID checked",
    });
    expect(await screen.findByText("Badge given.")).toBeTruthy();
  });

  it("asks for the organisation only for a partner badge", async () => {
    givePermissions(ADMIN);
    const transport = makeAdminTransport();
    await renderWithProviders(
      <AdminContent transport={transport} hubTransport={mockHub} />,
    );
    await screen.findByTestId("admin-ranks");
    expect(screen.queryByTestId("admin-org-input")).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId("admin-rank-partner"));
    });
    expect(screen.getByTestId("admin-org-input")).toBeTruthy();
  });

  it("offers no 'official' rank to grant", async () => {
    givePermissions(ADMIN);
    await renderWithProviders(
      <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
    );
    await screen.findByTestId("admin-ranks");
    expect(screen.queryByTestId("admin-rank-official")).toBeNull();
    expect(screen.getByTestId("admin-rank-moderator")).toBeTruthy();
  });

  it("words a failed grant in plain language", async () => {
    givePermissions(ADMIN);
    const { CommunityError } = jest.requireActual("@/features/community/types");
    const transport = makeAdminTransport({
      grantRole: jest.fn(async () => {
        throw new CommunityError("not_found");
      }),
    });
    await renderWithProviders(
      <AdminContent transport={transport} hubTransport={mockHub} />,
    );
    await act(async () => {
      fireEvent.changeText(await screen.findByTestId("admin-username-input"), "nobody");
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("admin-grant"));
    });
    expect(await screen.findByText("Not found.")).toBeTruthy();
  });

  it("takes a held rank away after a confirmation", async () => {
    givePermissions(ADMIN);
    const transport = makeAdminTransport();
    await renderWithProviders(
      <AdminContent transport={transport} hubTransport={mockHub} />,
    );
    await fireEvent.press(await screen.findByTestId("holder-revoke-u9-professor"));
    const options = mockConfirm.mock.calls[0]?.[0] as { onConfirm: () => void };
    options.onConfirm();
    await waitFor(() =>
      expect(transport.revokeRole).toHaveBeenCalledWith("nasrin", "professor"),
    );
  });

  it("opens a reported person's and a badge holder's profile from their name", async () => {
    givePermissions(ADMIN);
    await renderWithProviders(
      <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
    );
    await fireEvent.press(await screen.findByTestId("reported-name-u7"));
    await fireEvent.press(await screen.findByTestId("holder-open-u9-professor"));
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(mockPush.mock.calls[0]?.[0]).toBe("/u/spammer");
    expect(mockPush.mock.calls[1]?.[0]).toBe("/u/nasrin");
  });

  it("dismisses reports on a profile", async () => {
    givePermissions(ADMIN);
    const transport = makeAdminTransport();
    await renderWithProviders(
      <AdminContent transport={transport} hubTransport={mockHub} />,
    );
    await act(async () => {
      fireEvent.press(await screen.findByTestId("reported-dismiss-u7"));
    });
    expect(transport.resolveProfileReports).toHaveBeenCalledWith("u7");
  });
  describe("Reset a password", () => {
    async function search(transport: jest.Mocked<AdminTransport>, text = "dilan") {
      await renderWithProviders(
        <AdminContent transport={transport} hubTransport={mockHub} />,
      );
      await act(async () => {
        fireEvent.changeText(
          await screen.findByTestId("admin-password-search-input"),
          text,
        );
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId("admin-password-search"));
      });
    }

    beforeEach(() => {
      mockSetString.mockClear();
      (generateTempPassword as jest.Mock).mockClear();
    });

    it("is hidden without the accounts.reset_password permission", async () => {
      givePermissions(["comments.moderate", "badges.grant"]);
      const transport = makeAdminTransport();
      await renderWithProviders(
        <AdminContent transport={transport} hubTransport={mockHub} />,
      );
      await screen.findByTestId("admin-ranks");
      expect(screen.queryByTestId("admin-passwords")).toBeNull();
      expect(transport.findAccounts).not.toHaveBeenCalled();
    });

    it("is hidden on a server that predates the migration (permission not in my_permissions)", async () => {
      givePermissions(ADMIN.filter((p) => p !== "accounts.reset_password"));
      await renderWithProviders(
        <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
      );
      await screen.findByTestId("admin-ranks");
      expect(screen.queryByTestId("admin-passwords")).toBeNull();
    });

    it("alone is enough to open the admin screen", async () => {
      givePermissions(["accounts.reset_password"]);
      await renderWithProviders(
        <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
      );
      expect(await screen.findByTestId("admin-passwords")).toBeTruthy();
      expect(screen.queryByTestId("admin-no-access")).toBeNull();
      expect(screen.queryByTestId("admin-queue")).toBeNull();
    });

    it("needs at least 3 characters before it searches", async () => {
      givePermissions(ADMIN);
      await renderWithProviders(
        <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
      );
      await act(async () => {
        fireEvent.changeText(
          await screen.findByTestId("admin-password-search-input"),
          "di",
        );
      });
      expect(
        screen.getByTestId("admin-password-search").props.accessibilityState.disabled,
      ).toBe(true);
    });

    it("finds an account and shows the name, @username and masked email only", async () => {
      givePermissions(ADMIN);
      const transport = makeAdminTransport();
      await search(transport, " @Dilan ");
      expect(transport.findAccounts).toHaveBeenCalledWith("@Dilan");
      expect(await screen.findByTestId("admin-account-u5")).toBeTruthy();
      expect(screen.getByText(/@dilan.* · d\*\*\*@gmail\.com/)).toBeTruthy();
    });

    it("says so when nothing matches", async () => {
      givePermissions(ADMIN);
      const transport = makeAdminTransport({ findAccounts: jest.fn(async () => []) });
      await search(transport, "nobody");
      expect(await screen.findByTestId("admin-password-none")).toBeTruthy();
    });

    it("asks for confirmation first; nothing is reset until it is given", async () => {
      givePermissions(ADMIN);
      const transport = makeAdminTransport();
      await search(transport);
      await fireEvent.press(await screen.findByTestId("admin-reset-u5"));
      expect(mockConfirm).toHaveBeenCalledTimes(1);
      expect(transport.resetPassword).not.toHaveBeenCalled();
      expect(screen.queryByTestId("admin-temp-password")).toBeNull();
    });

    it("resets with the generated temporary password and shows it once, with a copy button", async () => {
      givePermissions(ADMIN);
      const transport = makeAdminTransport();
      await search(transport);
      await fireEvent.press(await screen.findByTestId("admin-reset-u5"));
      const options = mockConfirm.mock.calls[0]?.[0] as { onConfirm: () => void };
      await act(async () => {
        options.onConfirm();
      });

      expect(transport.resetPassword).toHaveBeenCalledWith("u5", "K7QM-2XWD-9HPA");
      expect(await screen.findByTestId("admin-temp-password")).toHaveTextContent(
        "K7QM-2XWD-9HPA",
      );
      expect(screen.getByText(/Temporary password for .*@dilan/)).toBeTruthy();

      await act(async () => {
        fireEvent.press(screen.getByTestId("admin-temp-password-copy"));
      });
      expect(mockSetString).toHaveBeenCalledWith("K7QM-2XWD-9HPA");
      expect(await screen.findByTestId("admin-temp-password-copied")).toBeTruthy();

      // Once: after Done the password is gone from the screen.
      await act(async () => {
        fireEvent.press(screen.getByTestId("admin-temp-password-done"));
      });
      expect(screen.queryByTestId("admin-temp-password")).toBeNull();
      expect(screen.queryByText("K7QM-2XWD-9HPA")).toBeNull();
    });

    it("shows no password when the server refuses", async () => {
      givePermissions(ADMIN);
      const { CommunityError } = jest.requireActual("@/features/community/types");
      const transport = makeAdminTransport({
        resetPassword: jest.fn(async () => {
          throw new CommunityError("forbidden");
        }),
      });
      await search(transport);
      await fireEvent.press(await screen.findByTestId("admin-reset-u5"));
      const options = mockConfirm.mock.calls[0]?.[0] as { onConfirm: () => void };
      await act(async () => {
        options.onConfirm();
      });
      expect(await screen.findByText("Not allowed.")).toBeTruthy();
      expect(screen.queryByTestId("admin-temp-password")).toBeNull();
    });

    it("says 'Not available yet' when the migration is not applied (lookup RPC missing)", async () => {
      givePermissions(ADMIN);
      const { CommunityError } = jest.requireActual("@/features/community/types");
      const transport = makeAdminTransport({
        findAccounts: jest.fn(async () => {
          throw new CommunityError("unavailable");
        }),
      });
      await search(transport);
      expect(await screen.findByText("Not available yet.")).toBeTruthy();
    });
  });
});
