import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { AdminContent } from "@/features/admin/components/AdminContent";
import { ActivityContent } from "@/features/admin/components/ActivityContent";
import type { AdminTransport } from "@/features/admin/transport";
import type { ActivityEntry } from "@/features/admin/types";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";
import i18n from "@/i18n";

import { SupabaseRestrictionsTransport } from "../transport";

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

const hub = makeTransport({ permissions: [] });
const MODERATOR: Permission[] = ["comments.moderate", "accounts.restrict", "audit.read"];
const OFFICIAL: Permission[] = [
  "comments.moderate",
  "comments.delete",
  "posts.delete",
  "badges.grant",
  "accounts.restrict",
  "accounts.suspend",
  "audit.read",
  "audit.read_all",
];

function adminTransport(
  extra: Partial<Record<keyof AdminTransport, unknown>> = {},
): jest.Mocked<AdminTransport> {
  return {
    fetchQueue: jest.fn(async () => []),
    fetchRoleHolders: jest.fn(async () => []),
    fetchReportedProfiles: jest.fn(async () => [
      {
        userId: "u1",
        username: "dilan.k",
        displayName: "Dilan",
        reportCount: 2,
        lastReason: "spam",
      },
    ]),
    fetchReportedPosts: jest.fn(async () => [
      {
        postId: "p1",
        authorId: "u2",
        username: "aso",
        displayName: "Aso",
        body: "quake tonight at nine",
        reportCount: 1,
        lastReason: "false",
      },
    ]),
    fetchActivity: jest.fn(async () => []),
    undoAction: jest.fn(async () => undefined),
    ...extra,
  } as unknown as jest.Mocked<AdminTransport>;
}

async function renderAdmin(permissions: Permission[], transport = adminTransport()) {
  hub.fetchMyPermissions.mockResolvedValue(permissions);
  await renderWithProviders(<AdminContent transport={transport} hubTransport={hub} />);
  return transport;
}

describe("Limit account in the Admin screen", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    hub.fetchMyPermissions.mockReset();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(() => {
    jest.restoreAllMocks();
    return cleanup();
  });

  it("a moderator with accounts.restrict sees it on reported profiles and posts, and the Limited accounts row", async () => {
    await renderAdmin(MODERATOR);
    expect(await screen.findByTestId("reported-limit-u1")).toBeTruthy();
    expect(screen.getByTestId("reported-post-limit-p1")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("admin-limited-row"));
    expect(mockPush).toHaveBeenCalledWith("/admin/limited");
  });

  it("without accounts.restrict none of it is offered", async () => {
    await renderAdmin(["comments.moderate"]);
    await screen.findByTestId("reported-name-u1");
    expect(screen.queryByTestId("reported-limit-u1")).toBeNull();
    expect(screen.queryByTestId("reported-post-limit-p1")).toBeNull();
    expect(screen.queryByTestId("admin-limited-row")).toBeNull();
  });

  it("the sheet from a reported profile has no Suspend for a moderator, and it has for the official", async () => {
    await renderAdmin(MODERATOR);
    await fireEvent.press(await screen.findByTestId("reported-limit-u1"));
    expect(await screen.findByTestId("limit-sheet-target")).toHaveTextContent("Dilan");
    expect(screen.queryByTestId("limit-level-suspend")).toBeNull();
    await fireEvent.press(screen.getByTestId("limit-sheet-close"));
    await cleanup();
    hub.fetchMyPermissions.mockReset();
    await renderAdmin(OFFICIAL);
    await fireEvent.press(await screen.findByTestId("reported-limit-u1"));
    expect(await screen.findByTestId("limit-level-suspend")).toBeTruthy();
  });

  it("limits the post's author (not the post) with the chosen reason", async () => {
    const restrict = jest
      .spyOn(SupabaseRestrictionsTransport, "restrict")
      .mockResolvedValue("r-9");
    await renderAdmin(MODERATOR);
    await fireEvent.press(await screen.findByTestId("reported-post-limit-p1"));
    expect(await screen.findByTestId("limit-sheet-target")).toHaveTextContent("Aso");
    await fireEvent.press(screen.getByTestId("limit-reason-rumour"));
    await fireEvent.press(screen.getByTestId("limit-submit"));
    await waitFor(() =>
      expect(restrict).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u2", reason: "rumour" }),
      ),
    );
  });
});

describe("Undo of a restriction in Activity", () => {
  function entry(
    id: string,
    action: string,
    overrides: Partial<ActivityEntry> = {},
  ): ActivityEntry {
    return {
      id,
      cursor: "2026-10-08T10:00:00.000001+00:00",
      createdAt: Date.parse("2026-10-08T10:00:00Z"),
      action,
      actorId: "a1",
      actorName: "Mona",
      actorUsername: "mona",
      actorRank: "moderator",
      targetType: "account",
      targetId: "u1",
      targetUserId: "u1",
      targetName: "Dilan",
      targetUsername: "dilan",
      targetSummary: null,
      reason: "rumour",
      note: null,
      revertedBy: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    hub.fetchMyPermissions.mockReset();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("a moderator can undo a restrict (a lift) but not a suspension; a lift row has no Undo", async () => {
    hub.fetchMyPermissions.mockResolvedValue(MODERATOR);
    const transport = adminTransport({
      fetchActivity: jest.fn(async () => [
        entry("l1", "restrict"),
        entry("l2", "suspend"),
        entry("l3", "lift"),
      ]),
    });
    await renderWithProviders(
      <ActivityContent transport={transport} hubTransport={hub} />,
    );
    expect(await screen.findByTestId("activity-undo-l1")).toBeTruthy();
    expect(screen.queryByTestId("activity-undo-l2")).toBeNull();
    expect(screen.queryByTestId("activity-undo-l3")).toBeNull();
    expect(screen.getByTestId("activity-action-l1")).toHaveTextContent(
      "Restricted an account",
    );
    expect(
      screen.getAllByText("Fake earthquake prediction or rumour").length,
    ).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId("activity-undo-l1"));
    await waitFor(() => expect(transport.undoAction).toHaveBeenCalledWith("l1"));
  });

  it("the official rank can undo a suspension too", async () => {
    hub.fetchMyPermissions.mockResolvedValue(OFFICIAL);
    const transport = adminTransport({
      fetchActivity: jest.fn(async () => [entry("l2", "suspend")]),
    });
    await renderWithProviders(
      <ActivityContent transport={transport} hubTransport={hub} />,
    );
    expect(await screen.findByTestId("activity-undo-l2")).toBeTruthy();
  });

  it("a restriction already lifted shows no Undo", async () => {
    hub.fetchMyPermissions.mockResolvedValue(OFFICIAL);
    const transport = adminTransport({
      fetchActivity: jest.fn(async () => [entry("l1", "restrict", { revertedBy: "l9" })]),
    });
    await renderWithProviders(
      <ActivityContent transport={transport} hubTransport={hub} />,
    );
    await screen.findByTestId("activity-l1");
    expect(screen.queryByTestId("activity-undo-l1")).toBeNull();
  });
});
