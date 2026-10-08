import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { CommunityError } from "@/features/community/types";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import { HubError, type Permission } from "@/features/eventhub/types";
import type { PostsTransport } from "@/features/posts/transport";
import i18n from "@/i18n";

import { AdminContent } from "../components/AdminContent";
import { HiddenRemovedContent } from "../components/HiddenRemovedContent";
import type { AdminTransport } from "../transport";
import { HIDDEN_PAGE_SIZE, type HiddenRemovedItem } from "../types";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "admin-1" }),
}));
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: jest.fn(),
  messageDialog: jest.fn(),
}));

const mockHub = makeTransport({ permissions: [] });

const MODERATOR: Permission[] = ["comments.moderate", "audit.read"];
const OFFICIAL: Permission[] = [
  "comments.moderate",
  "comments.delete",
  "posts.delete",
  "badges.grant",
  "audit.read",
  "audit.read_all",
  "content.restore",
];

function item(overrides: Partial<HiddenRemovedItem> = {}): HiddenRemovedItem {
  return {
    kind: "comment",
    id: "c1",
    status: "hidden",
    actedAt: Date.parse("2026-10-08T09:00:00Z"),
    cursor: "2026-10-08T09:00:00.000001+00:00",
    actorName: "Mona",
    reason: "spam",
    authorId: "u1",
    authorName: "Dilan",
    authorUsername: "dilan",
    hubId: "bml202610aa",
    place: "Duhok",
    body: "buy cheap stuff",
    canRestore: true,
    ...overrides,
  };
}

function admin(pages: (HiddenRemovedItem[] | Error)[]): jest.Mocked<AdminTransport> {
  let call = 0;
  return {
    fetchQueue: jest.fn(async () => []),
    fetchRoleHolders: jest.fn(async () => []),
    fetchReportedProfiles: jest.fn(async () => []),
    fetchReportedPosts: jest.fn(async () => []),
    fetchHiddenRemoved: jest.fn(async () => {
      const page = pages[Math.min(call, pages.length - 1)] as HiddenRemovedItem[] | Error;
      call += 1;
      if (page instanceof Error) {
        throw page;
      }
      return page;
    }),
  } as unknown as jest.Mocked<AdminTransport>;
}

function posts(): jest.Mocked<PostsTransport> {
  return {
    adminRestorePost: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<PostsTransport>;
}

async function renderScreen(
  permissions: Permission[],
  transport: AdminTransport,
  postsTransport = posts(),
) {
  mockHub.fetchMyPermissions.mockResolvedValue(permissions);
  mockHub.adminRestoreComment.mockClear();
  await renderWithProviders(
    <HiddenRemovedContent
      transport={transport}
      hubTransport={mockHub}
      postsTransport={postsTransport}
    />,
  );
  return postsTransport;
}

describe("Admin > Hidden and removed", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  describe("access", () => {
    it("shows an ordinary account only a 'not allowed' line and reads nothing", async () => {
      const transport = admin([[item()]]);
      await renderScreen([], transport);
      expect(await screen.findByTestId("hidden-no-access")).toBeTruthy();
      expect(transport.fetchHiddenRemoved).not.toHaveBeenCalled();
    });

    it("is closed to the audit permission alone (it needs comments.moderate)", async () => {
      const transport = admin([[item()]]);
      await renderScreen(["audit.read"], transport);
      expect(await screen.findByTestId("hidden-no-access")).toBeTruthy();
      expect(transport.fetchHiddenRemoved).not.toHaveBeenCalled();
    });
  });

  describe("as a moderator", () => {
    const rows = [
      item(),
      item({
        id: "c2",
        status: "removed",
        body: null,
        canRestore: false,
        reason: "abuse",
      }),
      item({
        kind: "post",
        id: "p1",
        status: "removed",
        body: null,
        canRestore: false,
        hubId: null,
        place: null,
      }),
    ];

    it("sees a hidden comment with its text and a Restore button", async () => {
      await renderScreen(MODERATOR, admin([rows]));
      expect(await screen.findByTestId("hidden-heading-c1")).toHaveTextContent(
        "Hidden comment",
      );
      expect(screen.getByTestId("hidden-body-c1")).toHaveTextContent("buy cheap stuff");
      expect(screen.getByTestId("hidden-restore-c1")).toBeTruthy();
      expect(screen.getAllByText(/Dilan · By Mona · Spam/).length).toBeGreaterThan(0);
    });

    it("sees removed items WITHOUT the evidence text and without Restore", async () => {
      await renderScreen(MODERATOR, admin([rows]));
      expect(await screen.findByTestId("hidden-heading-c2")).toHaveTextContent(
        "Removed comment",
      );
      expect(screen.getByTestId("hidden-heading-p1")).toHaveTextContent("Removed post");
      for (const id of ["c2", "p1"]) {
        expect(screen.queryByTestId(`hidden-body-${id}`)).toBeNull();
        expect(screen.getByTestId(`hidden-text-hidden-${id}`)).toBeTruthy();
        expect(screen.queryByTestId(`hidden-restore-${id}`)).toBeNull();
        expect(screen.getByTestId(`hidden-cannot-restore-${id}`)).toBeTruthy();
      }
    });

    it("restores a hidden comment through the hub transport and says so", async () => {
      await renderScreen(MODERATOR, admin([rows]));
      await fireEvent.press(await screen.findByTestId("hidden-restore-c1"));
      await waitFor(() => expect(mockHub.adminRestoreComment).toHaveBeenCalledWith("c1"));
      expect(await screen.findByTestId("snackbar-message")).toHaveTextContent("Restored");
    });

    it("opens the event of a comment", async () => {
      await renderScreen(MODERATOR, admin([rows]));
      await fireEvent.press(await screen.findByTestId("hidden-open-c1"));
      expect(mockPush).toHaveBeenCalledWith("/event-hub/bml202610aa");
    });
  });

  describe("as the official account", () => {
    const rows = [
      item({
        id: "c2",
        status: "removed",
        body: "the evidence text",
        canRestore: true,
        reason: "removed_by_admin",
      }),
      item({
        kind: "post",
        id: "p1",
        status: "removed",
        body: "post evidence",
        canRestore: true,
        hubId: null,
        place: null,
      }),
      item({ id: "c3", status: "removed", body: "too old", canRestore: false }),
    ];

    it("reads the evidence text of removed items and restores a comment and a post", async () => {
      const postsTransport = await renderScreen(OFFICIAL, admin([rows]));
      expect(await screen.findByTestId("hidden-body-c2")).toHaveTextContent(
        "the evidence text",
      );
      expect(screen.getByTestId("hidden-body-p1")).toHaveTextContent("post evidence");

      await fireEvent.press(screen.getByTestId("hidden-restore-c2"));
      await waitFor(() => expect(mockHub.adminRestoreComment).toHaveBeenCalledWith("c2"));
      await fireEvent.press(screen.getByTestId("hidden-restore-p1"));
      await waitFor(() =>
        expect(postsTransport.adminRestorePost).toHaveBeenCalledWith("p1"),
      );
    });

    it("offers no Restore where the server says it will not work (window passed, no evidence)", async () => {
      await renderScreen(OFFICIAL, admin([rows]));
      await screen.findByTestId("hidden-body-c2");
      expect(screen.queryByTestId("hidden-restore-c3")).toBeNull();
      expect(screen.getByTestId("hidden-cannot-restore-c3")).toHaveTextContent(
        "Can't be restored.",
      );
    });

    it("words a refused restore in plain language", async () => {
      mockHub.adminRestoreComment.mockRejectedValueOnce(new HubError("expired"));
      await renderScreen(OFFICIAL, admin([rows]));
      await fireEvent.press(await screen.findByTestId("hidden-restore-c2"));
      expect(await screen.findByTestId("hidden-error-c2")).toHaveTextContent(
        "Too late to undo this.",
      );
    });

    it("words a refused post restore too", async () => {
      const postsTransport = posts();
      postsTransport.adminRestorePost.mockRejectedValueOnce(
        new CommunityError("not_restorable"),
      );
      await renderScreen(OFFICIAL, admin([rows]), postsTransport);
      await fireEvent.press(await screen.findByTestId("hidden-restore-p1"));
      expect(await screen.findByTestId("hidden-error-p1")).toHaveTextContent(
        "This can't be restored any more.",
      );
    });
  });

  describe("list states", () => {
    it("says when nothing is hidden or removed", async () => {
      await renderScreen(MODERATOR, admin([[]]));
      expect(await screen.findByTestId("hidden-empty")).toHaveTextContent(
        "Nothing hidden or removed.",
      );
    });

    it("shows a retry when the list cannot load", async () => {
      const transport = admin([new CommunityError("network"), [item()]]);
      await renderScreen(MODERATOR, transport);
      expect(await screen.findByTestId("hidden-error")).toBeTruthy();
      await fireEvent.press(screen.getByTestId("hidden-retry"));
      expect(await screen.findByTestId("hidden-heading-c1")).toBeTruthy();
    });

    it("pages with the last row's raw timestamp", async () => {
      const full = Array.from({ length: HIDDEN_PAGE_SIZE }, (_, n) =>
        item({
          id: `c${n}`,
          cursor: `2026-10-08T09:00:${String(59 - (n % 60)).padStart(2, "0")}.000007+00:00`,
        }),
      );
      const transport = admin([full, [item({ id: "last" })]]);
      await renderScreen(MODERATOR, transport);
      await fireEvent.press(await screen.findByTestId("hidden-load-more"));
      await waitFor(() =>
        expect(transport.fetchHiddenRemoved).toHaveBeenLastCalledWith(
          full[full.length - 1]?.cursor,
        ),
      );
      expect(await screen.findByTestId("hidden-heading-last")).toBeTruthy();
    });
  });

  describe("the entry in the admin screen", () => {
    it("is offered to anyone who can moderate, and opens the screen", async () => {
      mockHub.fetchMyPermissions.mockResolvedValue(MODERATOR);
      await renderWithProviders(
        <AdminContent transport={admin([[]])} hubTransport={mockHub} />,
      );
      await fireEvent.press(await screen.findByTestId("admin-hidden-row"));
      expect(mockPush).toHaveBeenCalledWith("/admin/hidden");
    });

    it("is not offered to an ordinary account", async () => {
      mockHub.fetchMyPermissions.mockResolvedValue([]);
      await renderWithProviders(
        <AdminContent transport={admin([[]])} hubTransport={mockHub} />,
      );
      await screen.findByTestId("admin-no-access");
      expect(screen.queryByTestId("admin-hidden-row")).toBeNull();
    });
  });
});
