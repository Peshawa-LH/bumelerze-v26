import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";

import { AdminContent } from "../components/AdminContent";
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
});
