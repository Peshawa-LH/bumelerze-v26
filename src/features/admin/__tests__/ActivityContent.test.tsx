import { Text } from "react-native";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import { CommunityError, type PublicProfile } from "@/features/community/types";
import type { CommunityTransport } from "@/features/community/transport";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";

import { ActivityContent } from "../components/ActivityContent";
import { ActivityRow } from "../components/ActivityRow";
import { AdminContent } from "../components/AdminContent";
import type { AdminTransport } from "../transport";
import { ACTIVITY_PAGE_SIZE, type ActivityEntry } from "../types";

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

function entry(n: number, overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: `l${n}`,
    cursor: `2026-10-08T10:00:${String(59 - (n % 60)).padStart(2, "0")}.000001+00:00`,
    createdAt: Date.parse("2026-10-08T10:00:00Z") - n * 1000,
    action: "comment_hide",
    actorId: "a1",
    actorName: "Mona",
    actorUsername: "mona",
    actorRank: "moderator",
    targetType: "comment",
    targetId: `c${n}`,
    targetUserId: "u1",
    targetName: "Dilan",
    targetUsername: "dilan",
    targetSummary: "bml202610aa",
    reason: "spam",
    note: null,
    revertedBy: null,
    ...overrides,
  };
}

function makeAdmin(
  pages: (ActivityEntry[] | Error)[] = [[entry(1)]],
): jest.Mocked<Pick<AdminTransport, "fetchActivity">> & AdminTransport {
  let call = 0;
  const transport = {
    fetchQueue: jest.fn(async () => []),
    fetchRoleHolders: jest.fn(async () => []),
    fetchReportedProfiles: jest.fn(async () => []),
    fetchReportedPosts: jest.fn(async () => []),
    fetchActivity: jest.fn(async () => {
      const page = pages[Math.min(call, pages.length - 1)] as ActivityEntry[] | Error;
      call += 1;
      if (page instanceof Error) {
        throw page;
      }
      return page;
    }),
  };
  return transport as unknown as jest.Mocked<Pick<AdminTransport, "fetchActivity">> &
    AdminTransport;
}

function givePermissions(permissions: Permission[]) {
  mockHub.fetchMyPermissions.mockResolvedValue(permissions);
}

const MODERATOR: Permission[] = ["comments.moderate", "audit.read"];
const OFFICIAL: Permission[] = [
  "comments.moderate",
  "comments.delete",
  "badges.grant",
  "audit.read",
  "audit.read_all",
];

function community(
  profile: Partial<PublicProfile> | null | Error,
): jest.Mocked<Pick<CommunityTransport, "fetchPublicProfile">> & CommunityTransport {
  return {
    fetchPublicProfile: jest.fn(async () => {
      if (profile instanceof Error) {
        throw profile;
      }
      return profile === null ? null : ({ ...profile } as PublicProfile);
    }),
  } as unknown as jest.Mocked<Pick<CommunityTransport, "fetchPublicProfile">> &
    CommunityTransport;
}

describe("Admin > Activity", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  describe("access", () => {
    it("shows an ordinary account only a 'not allowed' line and reads nothing", async () => {
      givePermissions([]);
      const transport = makeAdmin();
      await renderWithProviders(
        <ActivityContent transport={transport} hubTransport={mockHub} />,
      );
      expect(await screen.findByTestId("activity-no-access")).toBeTruthy();
      expect(transport.fetchActivity).not.toHaveBeenCalled();
    });

    it("is closed to moderation powers without audit.read (a server before migration 0052)", async () => {
      givePermissions(["comments.moderate", "comments.delete", "badges.grant"]);
      const transport = makeAdmin();
      await renderWithProviders(
        <ActivityContent transport={transport} hubTransport={mockHub} />,
      );
      expect(await screen.findByTestId("activity-no-access")).toBeTruthy();
      expect(transport.fetchActivity).not.toHaveBeenCalled();
    });

    it("offers a moderator only content-action filters", async () => {
      givePermissions(MODERATOR);
      await renderWithProviders(
        <ActivityContent transport={makeAdmin()} hubTransport={mockHub} />,
      );
      expect(await screen.findByTestId("activity-filter-comment_hide")).toBeTruthy();
      expect(screen.getByTestId("activity-filter-post_remove")).toBeTruthy();
      expect(screen.queryByTestId("activity-filter-role_grant")).toBeNull();
      expect(screen.queryByTestId("activity-filter-password_reset")).toBeNull();
    });

    it("offers the official rank every filter", async () => {
      givePermissions(OFFICIAL);
      await renderWithProviders(
        <ActivityContent transport={makeAdmin()} hubTransport={mockHub} />,
      );
      expect(await screen.findByTestId("activity-filter-role_grant")).toBeTruthy();
      expect(screen.getByTestId("activity-filter-password_reset")).toBeTruthy();
      expect(screen.getByTestId("activity-filter-purge")).toBeTruthy();
    });
  });

  describe("rows", () => {
    it("shows what was done, by whom and with which rank, to whom, why and when", async () => {
      givePermissions(OFFICIAL);
      await renderWithProviders(
        <ActivityContent transport={makeAdmin()} hubTransport={mockHub} />,
      );
      expect(await screen.findByTestId("activity-action-l1")).toHaveTextContent(
        "Hid a comment",
      );
      expect(screen.getByTestId("activity-actor-l1")).toHaveTextContent(
        "By Mona · Moderator",
      );
      expect(screen.getByText("To Dilan")).toBeTruthy();
      expect(screen.getByText("bml202610aa")).toBeTruthy();
      expect(screen.getByText("Spam")).toBeTruthy();
    });

    it("words a system row, a rank change and an undone row", async () => {
      givePermissions(OFFICIAL);
      const rows = [
        entry(1, {
          action: "purge",
          actorId: null,
          actorName: null,
          actorUsername: null,
          actorRank: null,
          targetUserId: null,
          targetName: null,
          targetUsername: null,
          targetType: "comment",
          reason: "author_deleted_text",
          note: "3 comments",
        }),
        entry(2, { action: "role_grant", reason: "engineer", targetType: "rank" }),
        entry(3, { revertedBy: "l9" }),
      ];
      await renderWithProviders(
        <ActivityContent transport={makeAdmin([rows])} hubTransport={mockHub} />,
      );
      expect(await screen.findByTestId("activity-actor-l1")).toHaveTextContent(
        "By System",
      );
      expect(screen.getByText("Old deleted text cleaned up")).toBeTruthy();
      expect(screen.getByText("3 comments")).toBeTruthy();
      expect(screen.getByTestId("activity-action-l2")).toHaveTextContent("Gave a badge");
      expect(screen.getByText("Engineer")).toBeTruthy();
      expect(screen.getByTestId("activity-action-l3")).toHaveTextContent(
        "Hid a comment · Undone",
      );
    });

    it("says so when there is no activity", async () => {
      givePermissions(MODERATOR);
      await renderWithProviders(
        <ActivityContent transport={makeAdmin([[]])} hubTransport={mockHub} />,
      );
      expect(await screen.findByTestId("activity-empty")).toBeTruthy();
      expect(screen.queryByTestId("activity-load-more")).toBeNull();
    });

    it("words a failed load and retries", async () => {
      givePermissions(MODERATOR);
      const transport = makeAdmin([new CommunityError("network"), [entry(1)]]);
      await renderWithProviders(
        <ActivityContent transport={transport} hubTransport={mockHub} />,
      );
      expect(await screen.findByTestId("activity-error")).toBeTruthy();
      await fireEvent.press(screen.getByTestId("activity-retry"));
      expect(await screen.findByTestId("activity-l1")).toBeTruthy();
    });

    it("leaves a place for the next batch's Undo button", async () => {
      await renderWithProviders(
        <ActivityRow
          entry={entry(1)}
          renderAction={(e: ActivityEntry) => <ActionProbe id={e.id} />}
        />,
      );
      expect(screen.getByTestId("probe-l1")).toBeTruthy();
    });
  });

  describe("paging", () => {
    it("loads 50 rows a page and asks for the next page with the last row's timestamp", async () => {
      givePermissions(MODERATOR);
      const first = Array.from({ length: ACTIVITY_PAGE_SIZE }, (_, i) => entry(i + 1));
      const second = [entry(100)];
      const transport = makeAdmin([first, second]);
      await renderWithProviders(
        <ActivityContent transport={transport} hubTransport={mockHub} />,
      );
      expect(await screen.findByTestId("activity-l1")).toBeTruthy();
      expect(transport.fetchActivity).toHaveBeenCalledWith(
        { action: null, targetUserId: null },
        null,
      );
      await act(async () => {
        fireEvent.press(screen.getByTestId("activity-load-more"));
      });
      await waitFor(() =>
        expect(transport.fetchActivity).toHaveBeenLastCalledWith(
          { action: null, targetUserId: null },
          first[ACTIVITY_PAGE_SIZE - 1]?.cursor,
        ),
      );
      expect(await screen.findByTestId("activity-l100")).toBeTruthy();
      // a short page is the last one
      expect(screen.queryByTestId("activity-load-more")).toBeNull();
    });

    it("shows no 'Load more' when the first page is short", async () => {
      givePermissions(MODERATOR);
      await renderWithProviders(
        <ActivityContent transport={makeAdmin([[entry(1)]])} hubTransport={mockHub} />,
      );
      await screen.findByTestId("activity-l1");
      expect(screen.queryByTestId("activity-load-more")).toBeNull();
    });
  });

  describe("filters", () => {
    it("filters by action and back to All", async () => {
      givePermissions(MODERATOR);
      const transport = makeAdmin();
      await renderWithProviders(
        <ActivityContent transport={transport} hubTransport={mockHub} />,
      );
      await fireEvent.press(await screen.findByTestId("activity-filter-comment_remove"));
      await waitFor(() =>
        expect(transport.fetchActivity).toHaveBeenCalledWith(
          { action: "comment_remove", targetUserId: null },
          null,
        ),
      );
      expect(
        screen.getByTestId("activity-filter-comment_remove").props.accessibilityState
          .selected,
      ).toBe(true);
      await fireEvent.press(screen.getByTestId("activity-filter-all"));
      // "All" was read before, so it comes from the cache
      await waitFor(() =>
        expect(
          screen.getByTestId("activity-filter-all").props.accessibilityState.selected,
        ).toBe(true),
      );
      expect(await screen.findByTestId("activity-l1")).toBeTruthy();
    });

    it("filters by person from a @username", async () => {
      givePermissions(MODERATOR);
      const transport = makeAdmin();
      const profiles = community({ userId: "u7", username: "spammer" });
      await renderWithProviders(
        <ActivityContent
          transport={transport}
          hubTransport={mockHub}
          communityTransport={profiles}
        />,
      );
      const input = await screen.findByTestId("activity-person-input");
      expect(screen.getByTestId("activity-person-apply").props.accessibilityState.disabled).toBe(
        true,
      );
      await act(async () => {
        fireEvent.changeText(input, "@Spammer");
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId("activity-person-apply"));
      });
      expect(profiles.fetchPublicProfile).toHaveBeenCalledWith("spammer");
      expect(await screen.findByTestId("activity-person-chip")).toHaveTextContent(
        /Only: .*@spammer/,
      );
      await waitFor(() =>
        expect(transport.fetchActivity).toHaveBeenLastCalledWith(
          { action: null, targetUserId: "u7" },
          null,
        ),
      );
      await fireEvent.press(screen.getByTestId("activity-person-clear"));
      // the unfiltered list was read before, so it comes from the cache
      expect(screen.queryByTestId("activity-person-chip")).toBeNull();
      expect(await screen.findByTestId("activity-person-input")).toBeTruthy();
      expect(await screen.findByTestId("activity-l1")).toBeTruthy();
    });

    it("says so when no person has that username", async () => {
      givePermissions(MODERATOR);
      await renderWithProviders(
        <ActivityContent
          transport={makeAdmin()}
          hubTransport={mockHub}
          communityTransport={community(null)}
        />,
      );
      await act(async () => {
        fireEvent.changeText(await screen.findByTestId("activity-person-input"), "nobody");
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId("activity-person-apply"));
      });
      expect(await screen.findByText("No person with that username.")).toBeTruthy();
    });

    it("filters by the person a row is about when its name is tapped", async () => {
      givePermissions(MODERATOR);
      const transport = makeAdmin();
      await renderWithProviders(
        <ActivityContent transport={transport} hubTransport={mockHub} />,
      );
      await fireEvent.press(await screen.findByTestId("activity-target-l1"));
      await waitFor(() =>
        expect(transport.fetchActivity).toHaveBeenLastCalledWith(
          { action: null, targetUserId: "u1" },
          null,
        ),
      );
      expect(screen.getByTestId("activity-person-chip")).toHaveTextContent(/Only: .*@dilan/);
    });
  });

  describe("languages", () => {
    it("reads in Sorani (right to left) with every label translated", async () => {
      await i18n.changeLanguage("ckb");
      givePermissions(OFFICIAL);
      await renderWithProviders(
        <ActivityContent transport={makeAdmin()} hubTransport={mockHub} />,
      );
      expect(await screen.findByTestId("activity-action-l1")).toHaveTextContent(
        "تێبینییەکی شارد",
      );
      expect(screen.getByTestId("activity-filter-all")).toHaveTextContent("هەموو");
      expect(i18n.dir()).toBe("rtl");
    });

    it("keeps a username left to right in the filter box", async () => {
      givePermissions(MODERATOR);
      await renderWithProviders(
        <ActivityContent transport={makeAdmin()} hubTransport={mockHub} />,
      );
      const style = [(await screen.findByTestId("activity-person-input")).props.style].flat(2);
      expect(style).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ writingDirection: "ltr", textAlign: "left" }),
        ]),
      );
    });
  });

  describe("entry in Admin", () => {
    it("shows an Activity row to holders of audit.read, which opens the screen", async () => {
      givePermissions(MODERATOR);
      await renderWithProviders(
        <AdminContent transport={makeAdmin()} hubTransport={mockHub} />,
      );
      await fireEvent.press(await screen.findByTestId("admin-activity-row"));
      expect(mockPush).toHaveBeenCalledWith("/admin/activity");
    });

    it("hides the row without audit.read", async () => {
      givePermissions(["comments.moderate"]);
      await renderWithProviders(
        <AdminContent transport={makeAdmin()} hubTransport={mockHub} />,
      );
      await screen.findByTestId("admin-queue");
      expect(screen.queryByTestId("admin-activity-row")).toBeNull();
    });

    it("lets audit.read alone open the admin screen", async () => {
      givePermissions(["audit.read"]);
      await renderWithProviders(
        <AdminContent transport={makeAdmin()} hubTransport={mockHub} />,
      );
      expect(await screen.findByTestId("admin-activity-row")).toBeTruthy();
      expect(screen.queryByTestId("admin-no-access")).toBeNull();
      expect(screen.queryByTestId("admin-queue")).toBeNull();
    });
  });
});

/** Stands in for the next batch's Undo button. */
function ActionProbe({ id }: { id: string }) {
  return <Text testID={`probe-${id}`}>Undo</Text>;
}
