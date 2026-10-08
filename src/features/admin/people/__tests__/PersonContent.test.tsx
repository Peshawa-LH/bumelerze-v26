import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { CommunityError } from "@/features/community/types";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";
import { fakeTransport as fakeRestrictions } from "@/features/restrictions/__fixtures__/testing";
import i18n from "@/i18n";

import type { ActivityEntry } from "../../types";
import type { AdminTransport } from "../../transport";
import { PersonContent } from "../components/PersonContent";
import { detail, fakePeopleTransport, note } from "../__fixtures__/testing";

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
jest.mock("../../temp-password", () => ({
  generateTempPassword: jest.fn(() => "K7QM-2XWD-9HPA"),
}));
const mockConfirm = jest.fn();
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: (options: unknown) => mockConfirm(options),
  messageDialog: jest.fn(),
}));

const hub = makeTransport({ permissions: [] });
const MODERATOR: Permission[] = [
  "comments.moderate",
  "accounts.restrict",
  "people.view",
  "audit.read",
];
const OFFICIAL: Permission[] = [
  ...MODERATOR,
  "accounts.suspend",
  "accounts.reset_password",
  "badges.grant",
  "audit.read_all",
  "people.view_email",
  "people.view_guests",
];
const ID = "c2c2c2c2-0000-4000-8000-000000000000";
const GUEST_ID = "49494949-0000-4000-8000-000000000000";

function entry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: "log-9",
    cursor: "2026-10-09T10:00:00Z",
    createdAt: Date.parse("2026-10-09T10:00:00Z"),
    action: "profile_reset",
    actorId: "m1",
    actorName: "Mona",
    actorUsername: "mona",
    actorRank: "moderator",
    targetType: "profile",
    targetId: ID,
    targetUserId: ID,
    targetName: "Aso Kareem",
    targetUsername: "aso",
    targetSummary: null,
    reason: null,
    note: null,
    revertedBy: null,
    ...overrides,
  };
}

function adminTransport(rows: ActivityEntry[] = []): jest.Mocked<AdminTransport> {
  return {
    fetchActivity: jest.fn(async () => rows),
    undoAction: jest.fn(async () => undefined),
    resetPassword: jest.fn(async () => undefined),
    grantRole: jest.fn(async () => undefined),
    revokeRole: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<AdminTransport>;
}

async function render(
  permissions: Permission[],
  people: ReturnType<typeof fakePeopleTransport>,
  admin = adminTransport(),
  restrictions = fakeRestrictions(),
  userId = ID,
) {
  hub.fetchMyPermissions.mockResolvedValue(permissions);
  await renderWithProviders(
    <PersonContent
      userId={userId}
      transport={people}
      adminTransport={admin}
      hubTransport={hub}
      restrictionsTransport={restrictions}
    />,
  );
  return { admin, restrictions };
}

describe("Admin > People > person", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    mockConfirm.mockClear();
    mockSetString.mockClear();
    hub.fetchMyPermissions.mockReset();
    mockAccount = { status: "account", userId: "admin-1" };
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  describe("sections", () => {
    it("opens the person once and shows header, details, devices, activity and lists", async () => {
      const people = fakePeopleTransport();
      await render(OFFICIAL, people);
      expect(await screen.findByTestId("person-name")).toHaveTextContent("Aso Kareem");
      expect(people.person).toHaveBeenCalledTimes(1);
      expect(people.person).toHaveBeenCalledWith(ID);
      expect(screen.getByTestId("person-username")).toHaveTextContent("@aso");
      expect(screen.getByTestId("person-status")).toHaveTextContent("Active");
      expect(screen.getByTestId("person-kind")).toHaveTextContent("Account");
      expect(screen.getByTestId("person-userid")).toHaveTextContent(ID);
      expect(screen.getByTestId("person-email")).toHaveTextContent("a***@x.org");

      // devices by fingerprint only
      expect(screen.getByTestId("person-device-1f2e3d4c")).toBeTruthy();
      expect(screen.getByText(/Full device IDs are never shown/)).toBeTruthy();

      // counts
      expect(screen.getByText("5 (1 visible, 1 waiting, 2 hidden, 1 removed)")).toBeTruthy();
      expect(screen.getByText("0 / 3 / 2")).toBeTruthy();

      // lists: felt report = time, event, level; never a place
      expect(screen.getByTestId("person-felt-fr1")).toHaveTextContent(/bml2026aa · Level 5/);
      expect(screen.getByText("I felt it strongly")).toBeTruthy();
      expect(screen.getByText("Hello from Duhok")).toBeTruthy();
      expect(screen.getByTestId("person-feedback-fb1")).toHaveTextContent(/bug · unseen/);
    });

    it("shows an author-deleted comment without its text", async () => {
      await render(OFFICIAL, fakePeopleTransport());
      const row = await screen.findByTestId("person-comment-cm2");
      expect(row).toHaveTextContent(/Deleted by the author/);
    });

    it("does not call the server again when the screen re-renders", async () => {
      const people = fakePeopleTransport();
      await render(OFFICIAL, people);
      await screen.findByTestId("person-name");
      await act(async () => {
        await Promise.resolve();
      });
      expect(people.person).toHaveBeenCalledTimes(1);
    });

    it("names a guest 'Guest' + the first 8 characters of its id and offers only what fits a guest", async () => {
      const base = detail();
      const people = fakePeopleTransport({
        person: detail({
          identity: {
            ...base.identity,
            userId: GUEST_ID,
            kind: "guest",
            username: null,
            displayName: null,
            avatarPath: null,
            maskedEmail: null,
            hasPassword: null,
            platform: "ios",
          },
        }),
      });
      await render(OFFICIAL, people, adminTransport(), fakeRestrictions(), GUEST_ID);
      expect(await screen.findByTestId("person-name")).toHaveTextContent("Guest 49494949");
      expect(screen.getByTestId("person-kind")).toHaveTextContent("Guest (no account)");
      expect(screen.getByTestId("person-action-limit")).toBeTruthy();
      expect(screen.queryByTestId("person-action-profile")).toBeNull();
      expect(screen.queryByTestId("person-action-password")).toBeNull();
      expect(screen.queryByTestId("person-action-badge")).toBeNull();
      expect(screen.queryByTestId("person-action-reset")).toBeNull();
      expect(screen.queryByTestId("person-action-email")).toBeNull();
      expect(screen.queryByTestId("person-email")).toBeNull();
      expect(screen.getByTestId("person-action-note")).toBeTruthy();
    });

    it("links to others seen on the same device", async () => {
      const base = detail();
      const people = fakePeopleTransport({
        person: detail({
          ...base,
          sameDeviceUsers: [
            { userId: GUEST_ID, kind: "guest", username: null, displayName: null, fingerprint: "1f2e3d4c" },
          ],
        }),
      });
      await render(OFFICIAL, people);
      await fireEvent.press(await screen.findByTestId(`person-same-${GUEST_ID}`));
      expect(mockPush).toHaveBeenCalledWith(`/admin/person/${GUEST_ID}`);
    });

    it("words a missing person plainly", async () => {
      const people = fakePeopleTransport();
      people.person.mockRejectedValue(new CommunityError("not_found"));
      await render(MODERATOR, people);
      expect(await screen.findByTestId("person-error")).toBeTruthy();
    });

    it("shows nothing without people.view and asks the server for nothing", async () => {
      const people = fakePeopleTransport();
      await render(["comments.moderate"], people);
      expect(await screen.findByTestId("person-no-access")).toBeTruthy();
      expect(people.person).not.toHaveBeenCalled();
    });
  });

  describe("permission split", () => {
    it("gives a moderator profile, limit, name/photo reset and notes, but no email, password or badges", async () => {
      const people = fakePeopleTransport({
        person: detail({
          identity: { ...detail().identity, maskedEmail: null, hasPassword: null },
        }),
      });
      await render(MODERATOR, people);
      await screen.findByTestId("person-name");
      expect(screen.getByTestId("person-action-profile")).toBeTruthy();
      expect(screen.getByTestId("person-action-limit")).toBeTruthy();
      expect(screen.getByTestId("person-action-reset")).toBeTruthy();
      expect(screen.getByTestId("person-action-note")).toBeTruthy();
      expect(screen.queryByTestId("person-action-email")).toBeNull();
      expect(screen.queryByTestId("person-action-password")).toBeNull();
      expect(screen.queryByTestId("person-action-badge")).toBeNull();
      expect(screen.queryByTestId("person-email")).toBeNull();
    });

    it("gives the official every action", async () => {
      await render(OFFICIAL, fakePeopleTransport());
      await screen.findByTestId("person-name");
      for (const id of ["profile", "limit", "password", "badge", "reset", "email", "note"]) {
        expect(screen.getByTestId(`person-action-${id}`)).toBeTruthy();
      }
    });

    it("never offers to limit, reset or change the password of one's own account, or limit an admin", async () => {
      mockAccount = { status: "account", userId: ID };
      await render(OFFICIAL, fakePeopleTransport());
      await screen.findByTestId("person-name");
      expect(screen.queryByTestId("person-action-limit")).toBeNull();
      expect(screen.queryByTestId("person-action-reset")).toBeNull();
    });

    it("never offers to limit or reset a moderator or the official account", async () => {
      const base = detail();
      await render(
        OFFICIAL,
        fakePeopleTransport({
          person: detail({ identity: { ...base.identity, ranks: [{ role: "moderator", orgName: null }] } }),
        }),
      );
      await screen.findByTestId("person-name");
      expect(screen.queryByTestId("person-action-limit")).toBeNull();
      expect(screen.queryByTestId("person-action-reset")).toBeNull();
    });

    it("badges need an @username", async () => {
      const base = detail();
      await render(
        OFFICIAL,
        fakePeopleTransport({ person: detail({ identity: { ...base.identity, username: null } }) }),
      );
      expect(await screen.findByTestId("person-badge-needs-username")).toBeTruthy();
      expect(screen.getByTestId("person-action-badge").props.accessibilityState.disabled).toBe(true);
    });
  });

  describe("actions", () => {
    it("opens the public profile", async () => {
      await render(OFFICIAL, fakePeopleTransport());
      await fireEvent.press(await screen.findByTestId("person-action-profile"));
      expect(mockPush).toHaveBeenCalledWith("/u/aso");
    });

    it("opens the Limit account sheet and applies a limit through the existing flow", async () => {
      const { restrictions } = await render(MODERATOR, fakePeopleTransport());
      await fireEvent.press(await screen.findByTestId("person-action-limit"));
      expect(await screen.findByTestId("limit-sheet")).toBeTruthy();
      expect(screen.getByTestId("limit-sheet-target")).toHaveTextContent("Aso Kareem");
      await act(async () => {
        fireEvent.press(screen.getByTestId("limit-reason-spam"));
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId("limit-submit"));
      });
      await waitFor(() => expect(restrictions.restrict).toHaveBeenCalledTimes(1));
      expect(restrictions.restrict.mock.calls[0]?.[0]).toMatchObject({ userId: ID, level: "restrict", reason: "spam" });
    });

    it("shows the limits and lifts the active one, with a snackbar", async () => {
      const base = detail();
      const people = fakePeopleTransport({
        person: detail({
          identity: { ...base.identity, status: "restricted" },
          restrictions: [
            {
              restrictionId: "r1",
              level: "restrict",
              reason: "spam",
              note: "private note",
              startsAt: Date.now() - 1000,
              endsAt: Date.now() + 86_400_000,
              createdAt: Date.now() - 1000,
              createdByName: "Mona",
              liftedAt: null,
              liftedByName: null,
              appealRequestedAt: null,
              active: true,
            },
          ],
        }),
      });
      const { restrictions } = await render(MODERATOR, people);
      expect(await screen.findByTestId("person-limit-r1")).toHaveTextContent(/private note/);
      expect(screen.getByTestId("person-status")).toHaveTextContent("Restricted");
      await act(async () => {
        fireEvent.press(screen.getByTestId("person-action-lift"));
      });
      await waitFor(() => expect(restrictions.lift).toHaveBeenCalledWith("r1"));
      expect(await screen.findByText("Limit lifted")).toBeTruthy();
    });

    it("a moderator cannot lift a suspension", async () => {
      const base = detail();
      const people = fakePeopleTransport({
        person: detail({
          identity: { ...base.identity, status: "suspended" },
          restrictions: [
            {
              restrictionId: "r2",
              level: "suspend",
              reason: "rumour",
              note: null,
              startsAt: Date.now() - 1000,
              endsAt: null,
              createdAt: Date.now() - 1000,
              createdByName: "Bumelerze",
              liftedAt: null,
              liftedByName: null,
              appealRequestedAt: null,
              active: true,
            },
          ],
        }),
      });
      await render(MODERATOR, people);
      expect(await screen.findByTestId("person-limit-r2")).toBeTruthy();
      expect(screen.queryByTestId("person-limit-lift-r2")).toBeNull();
      expect(screen.queryByTestId("person-action-lift")).toBeNull();
    });
  });

  describe("reveal email", () => {
    it("asks first; nothing is revealed until confirmed; then shows the full address", async () => {
      const people = fakePeopleTransport();
      await render(OFFICIAL, people);
      await fireEvent.press(await screen.findByTestId("person-action-email"));
      expect(mockConfirm).toHaveBeenCalledTimes(1);
      expect(people.revealEmail).not.toHaveBeenCalled();
      expect(screen.getByTestId("person-email")).toHaveTextContent("a***@x.org");
      const options = mockConfirm.mock.calls[0]?.[0] as { onConfirm: () => void };
      await act(async () => {
        options.onConfirm();
      });
      expect(people.revealEmail).toHaveBeenCalledWith(ID);
      await waitFor(() => expect(screen.getByTestId("person-email")).toHaveTextContent("aso@x.org"));
    });
  });

  describe("reset password", () => {
    it("asks for confirmation, then shows the generated temporary password once, with Copy", async () => {
      const { admin } = await render(OFFICIAL, fakePeopleTransport());
      await fireEvent.press(await screen.findByTestId("person-action-password"));
      expect(mockConfirm).toHaveBeenCalledTimes(1);
      expect(admin.resetPassword).not.toHaveBeenCalled();
      const options = mockConfirm.mock.calls[0]?.[0] as { onConfirm: () => void };
      await act(async () => {
        options.onConfirm();
      });
      expect(admin.resetPassword).toHaveBeenCalledWith(ID, "K7QM-2XWD-9HPA");
      expect(await screen.findByTestId("admin-temp-password")).toHaveTextContent("K7QM-2XWD-9HPA");
      expect(screen.getByText(/Temporary password for Aso Kareem/)).toBeTruthy();

      await act(async () => {
        fireEvent.press(screen.getByTestId("admin-temp-password-copy"));
      });
      expect(mockSetString).toHaveBeenCalledWith("K7QM-2XWD-9HPA");
      expect(await screen.findByTestId("admin-temp-password-copied")).toBeTruthy();

      await act(async () => {
        fireEvent.press(screen.getByTestId("admin-temp-password-done"));
      });
      expect(screen.queryByTestId("admin-temp-password")).toBeNull();
      expect(screen.queryByText("K7QM-2XWD-9HPA")).toBeNull();
    });

    it("shows no password when the server refuses", async () => {
      const admin = adminTransport();
      admin.resetPassword.mockRejectedValue(new CommunityError("forbidden"));
      await render(OFFICIAL, fakePeopleTransport(), admin);
      await fireEvent.press(await screen.findByTestId("person-action-password"));
      const options = mockConfirm.mock.calls[0]?.[0] as { onConfirm: () => void };
      await act(async () => {
        options.onConfirm();
      });
      expect(await screen.findByText("Not allowed.")).toBeTruthy();
      expect(screen.queryByTestId("admin-temp-password")).toBeNull();
    });
  });

  describe("reset name / photo", () => {
    it("resets both, then offers Undo for 10 s that restores through the audit row", async () => {
      const people = fakePeopleTransport();
      const { admin } = await render(MODERATOR, people);
      await fireEvent.press(await screen.findByTestId("person-action-reset"));
      expect(await screen.findByTestId("reset-sheet")).toBeTruthy();
      await act(async () => {
        fireEvent.press(screen.getByTestId("reset-submit"));
      });
      await waitFor(() => expect(people.resetProfile).toHaveBeenCalledWith(ID, ["display_name", "avatar"]));
      expect(await screen.findByText("Name / photo reset")).toBeTruthy();
      expect(screen.queryByTestId("reset-sheet")).toBeNull();
      await act(async () => {
        fireEvent.press(screen.getByText("Undo"));
      });
      await waitFor(() => expect(admin.undoAction).toHaveBeenCalledWith("log-1"));
    });

    it("can reset just the photo", async () => {
      const people = fakePeopleTransport();
      await render(MODERATOR, people);
      await fireEvent.press(await screen.findByTestId("person-action-reset"));
      await act(async () => {
        fireEvent.press(await screen.findByTestId("reset-field-name"));
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId("reset-submit"));
      });
      await waitFor(() => expect(people.resetProfile).toHaveBeenCalledWith(ID, ["avatar"]));
    });

    it("says so when there was nothing to reset (a replay)", async () => {
      const people = fakePeopleTransport();
      people.resetProfile.mockResolvedValue(null);
      await render(MODERATOR, people);
      await fireEvent.press(await screen.findByTestId("person-action-reset"));
      await act(async () => {
        fireEvent.press(await screen.findByTestId("reset-submit"));
      });
      expect(await screen.findByText("Nothing to reset")).toBeTruthy();
      expect(screen.queryByText("Undo")).toBeNull();
    });

    it("words a refusal and keeps the sheet open", async () => {
      const people = fakePeopleTransport();
      people.resetProfile.mockRejectedValue(new CommunityError("protected_account"));
      await render(MODERATOR, people);
      await fireEvent.press(await screen.findByTestId("person-action-reset"));
      await act(async () => {
        fireEvent.press(await screen.findByTestId("reset-submit"));
      });
      expect(await screen.findByTestId("reset-error")).toBeTruthy();
      expect(screen.getByTestId("reset-sheet")).toBeTruthy();
    });
  });

  describe("badges", () => {
    it("gives a badge to this person without typing the @username", async () => {
      const { admin } = await render(OFFICIAL, fakePeopleTransport());
      await fireEvent.press(await screen.findByTestId("person-action-badge"));
      expect(await screen.findByTestId("badge-sheet")).toBeTruthy();
      await act(async () => {
        fireEvent.press(screen.getByTestId("badge-rank-professor"));
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId("badge-grant"));
      });
      await waitFor(() =>
        expect(admin.grantRole).toHaveBeenCalledWith({
          username: "aso",
          role: "professor",
          orgName: null,
          note: "",
        }),
      );
      expect(await screen.findByTestId("badge-done")).toBeTruthy();
    });

    it("takes a badge away", async () => {
      const { admin } = await render(OFFICIAL, fakePeopleTransport());
      await fireEvent.press(await screen.findByTestId("person-action-badge"));
      await act(async () => {
        fireEvent.press(await screen.findByTestId("badge-revoke"));
      });
      await waitFor(() => expect(admin.revokeRole).toHaveBeenCalledWith("aso", "engineer"));
    });
  });

  describe("notes", () => {
    it("lists notes and adds one (trimmed), then clears the box", async () => {
      const people = fakePeopleTransport({ notes: [note()] });
      await render(MODERATOR, people);
      expect(await screen.findByTestId("person-note-n1")).toHaveTextContent(/Watch this one/);
      expect(screen.getByTestId("person-note-n1")).toHaveTextContent(/By Mona/);
      expect(screen.getByTestId("person-note-add").props.accessibilityState.disabled).toBe(true);
      await act(async () => {
        fireEvent.changeText(screen.getByTestId("person-note-input"), "  second note  ");
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId("person-note-add"));
      });
      await waitFor(() => expect(people.addNote).toHaveBeenCalledWith(ID, "second note"));
      await waitFor(() => expect(screen.getByTestId("person-note-input").props.value).toBe(""));
    });

    it("says when there are no notes", async () => {
      await render(MODERATOR, fakePeopleTransport());
      expect(await screen.findByTestId("person-notes-empty")).toBeTruthy();
    });
  });

  describe("history", () => {
    it("reads the audit rows about this person and offers Undo on a name/photo reset", async () => {
      const { admin } = await render(MODERATOR, fakePeopleTransport(), adminTransport([entry()]));
      expect(await screen.findByTestId("activity-log-9")).toBeTruthy();
      expect(admin.fetchActivity).toHaveBeenCalledWith({ action: null, targetUserId: ID }, null);
      await act(async () => {
        fireEvent.press(screen.getByTestId("activity-undo-log-9"));
      });
      await waitFor(() => expect(admin.undoAction).toHaveBeenCalledWith("log-9"));
    });

    it("offers no Undo on a row already undone, or one the viewer may not undo", async () => {
      await render(
        MODERATOR,
        fakePeopleTransport(),
        adminTransport([
          entry({ id: "a", revertedBy: "z" }),
          entry({ id: "b", action: "role_revoke" }),
        ]),
      );
      await screen.findByTestId("activity-a");
      expect(screen.queryByTestId("activity-undo-a")).toBeNull();
      expect(screen.queryByTestId("activity-undo-b")).toBeNull();
    });

    it("says when nothing has happened", async () => {
      await render(MODERATOR, fakePeopleTransport());
      expect(await screen.findByTestId("person-history-empty")).toBeTruthy();
    });

    it("is absent without audit.read", async () => {
      await render(["people.view"], fakePeopleTransport());
      await screen.findByTestId("person-name");
      expect(screen.queryByTestId("person-history")).toBeNull();
    });
  });

  describe("languages", () => {
    it("renders Eastern Arabic-Indic digits in the counts in Sorani", async () => {
      await i18n.changeLanguage("ckb");
      await render(OFFICIAL, fakePeopleTransport());
      expect(await screen.findByText("٥ (١ بینراو، ١ چاوەڕێ، ٢ شاردراو، ١ لابراو)")).toBeTruthy();
    });
  });
});
