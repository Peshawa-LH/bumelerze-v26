import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";

import { AdminContent } from "../components/AdminContent";
import type { InboxTransport } from "../inbox/transport";
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
  "accounts.reset_password",
  "people.view",
  "people.view_email",
  "people.view_guests",
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
        lastReason: null,
        lastNote: null,
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
        lastReason: "rumour_prediction",
        lastNote: "says a bigger one comes tonight",
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
        lastReason: "impersonation",
        lastNote: "uses the name of a professor",
      },
    ]),
    grantRole: jest.fn(async () => undefined),
    revokeRole: jest.fn(async () => undefined),
    resolveProfileReports: jest.fn(async () => undefined),
    fetchReportedPosts: jest.fn(async () => []),
    dismissPostReports: jest.fn(async () => undefined),
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

  it("shows the feedback inbox and felt photos rows with what is waiting (migration 0060)", async () => {
    givePermissions([...ADMIN, "feedback.manage", "photos.moderate"]);
    const inbox = {
      counts: jest.fn(async () => ({
        feedback: {
          unseen: 2,
          inReview: 1,
          solved: 0,
          wontDo: 0,
          badgeRequestsOpen: 1,
          appealsOpen: 0,
        },
        photosPending: 4,
      })),
    } as unknown as InboxTransport;
    await renderWithProviders(
      <AdminContent
        transport={makeAdminTransport()}
        hubTransport={mockHub}
        inboxTransport={inbox}
      />,
    );
    expect(await screen.findByTestId("admin-feedback-row")).toBeTruthy();
    expect(await screen.findByText("3 open")).toBeTruthy();
    expect(screen.getByText("4 waiting")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("admin-feedback-row"));
    expect(mockPush).toHaveBeenCalledWith("/admin/feedback");
    await fireEvent.press(screen.getByTestId("admin-photos-row"));
    expect(mockPush).toHaveBeenCalledWith("/admin/photos");
  });

  it("gives a moderator the felt photos row but not the feedback inbox", async () => {
    givePermissions(["comments.moderate", "photos.moderate"]);
    const inbox = {
      counts: jest.fn(async () => ({ feedback: null, photosPending: 0 })),
    } as unknown as InboxTransport;
    await renderWithProviders(
      <AdminContent
        transport={makeAdminTransport()}
        hubTransport={mockHub}
        inboxTransport={inbox}
      />,
    );
    expect(await screen.findByTestId("admin-photos-row")).toBeTruthy();
    expect(screen.queryByTestId("admin-feedback-row")).toBeNull();
  });

  it("shows the Alerts row with alerts.test (migration 0062)", async () => {
    givePermissions(["comments.moderate", "alerts.test"]);
    await renderWithProviders(
      <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
    );
    await fireEvent.press(await screen.findByTestId("admin-alerts-row"));
    expect(mockPush).toHaveBeenCalledWith("/admin/alerts");
  });

  it("has no Alerts row without alerts.test", async () => {
    givePermissions(["comments.moderate"]);
    await renderWithProviders(
      <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
    );
    expect(await screen.findByTestId("admin-queue")).toBeTruthy();
    expect(screen.queryByTestId("admin-alerts-row")).toBeNull();
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

  describe("report reasons and notes", () => {
    it("shows the reason and the note on a flagged comment in the queue", async () => {
      givePermissions(ADMIN);
      await renderWithProviders(
        <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
      );
      expect(await screen.findByTestId("queue-reason-c2")).toHaveTextContent(
        "Reason: Fake earthquake prediction or rumour",
      );
      expect(screen.getByTestId("queue-note-c2")).toHaveTextContent(
        "\u201Csays a bigger one comes tonight\u201D",
      );
      // a comment that only waits for review has no reason line
      expect(screen.queryByTestId("queue-reason-c1")).toBeNull();
      expect(screen.queryByTestId("queue-note-c1")).toBeNull();
    });

    it("shows the reason and the note on a reported profile", async () => {
      givePermissions(ADMIN);
      await renderWithProviders(
        <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
      );
      expect(
        await screen.findByText("Reports: 2 · Pretending to be someone else"),
      ).toBeTruthy();
      expect(screen.getByTestId("reported-note-u7")).toHaveTextContent(
        "\u201Cuses the name of a professor\u201D",
      );
    });
  });

  describe("actions on a reported profile", () => {
    it("Open person goes to the person page (people.view)", async () => {
      givePermissions([...ADMIN, "accounts.restrict"]);
      await renderWithProviders(
        <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
      );
      await fireEvent.press(await screen.findByTestId("reported-person-u7"));
      expect(mockPush).toHaveBeenCalledWith("/admin/person/u7");
    });

    it("offers Open person, Reset name / photo and Limit account next to each other with the permissions", async () => {
      givePermissions([...ADMIN, "accounts.restrict"]);
      await renderWithProviders(
        <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
      );
      expect(await screen.findByTestId("reported-person-u7")).toBeTruthy();
      expect(screen.getByTestId("reported-reset-u7")).toBeTruthy();
      expect(screen.getByTestId("reported-limit-u7")).toBeTruthy();
      await fireEvent.press(screen.getByTestId("reported-reset-u7"));
      expect(await screen.findByTestId("reset-sheet")).toBeTruthy();
      expect(screen.getByTestId("reset-submit")).toBeTruthy();
    });

    it("hides Open person without people.view and the reset and limit without accounts.restrict", async () => {
      givePermissions(["comments.moderate"]);
      await renderWithProviders(
        <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
      );
      await screen.findByTestId("reported-name-u7");
      expect(screen.queryByTestId("reported-person-u7")).toBeNull();
      expect(screen.queryByTestId("reported-reset-u7")).toBeNull();
      expect(screen.queryByTestId("reported-limit-u7")).toBeNull();
    });
  });

  describe("People entry", () => {
    it("is the first row for people.view and opens the directory", async () => {
      givePermissions(["comments.moderate", "people.view"]);
      await renderWithProviders(
        <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
      );
      await fireEvent.press(await screen.findByTestId("admin-people-row"));
      expect(mockPush).toHaveBeenCalledWith("/admin/people");
    });

    it("is absent without people.view", async () => {
      givePermissions(["comments.moderate"]);
      await renderWithProviders(
        <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
      );
      await screen.findByTestId("admin-queue");
      expect(screen.queryByTestId("admin-people-row")).toBeNull();
    });

    it("alone is enough to open the admin screen", async () => {
      givePermissions(["people.view"]);
      await renderWithProviders(
        <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
      );
      expect(await screen.findByTestId("admin-people-row")).toBeTruthy();
      expect(screen.queryByTestId("admin-no-access")).toBeNull();
    });

    it("no longer has its own password search (it lives on the person page)", async () => {
      givePermissions(ADMIN);
      await renderWithProviders(
        <AdminContent transport={makeAdminTransport()} hubTransport={mockHub} />,
      );
      await screen.findByTestId("admin-ranks");
      expect(screen.queryByTestId("admin-passwords")).toBeNull();
    });
  });
});
