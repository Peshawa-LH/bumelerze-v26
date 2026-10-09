import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { CommunityError } from "@/features/community/types";
import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import i18n from "@/i18n";

import { ActivityBell } from "../components/ActivityBell";
import { ActivityContent } from "../components/ActivityContent";
import type { ActivityTransport } from "../transport";
import type { ActivityItem } from "../types";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
let mockUserId: string | null = "me";
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: mockUserId ? "account" : "none", userId: mockUserId }),
}));

function item(overrides: Partial<ActivityItem> & { id: string }): ActivityItem {
  return {
    kind: "new_follower",
    createdAt: Date.now() - 60_000,
    read: false,
    actor: { userId: "u-b", username: "userb", displayName: "Bnar", avatarPath: null },
    count: 1,
    role: null,
    orgName: null,
    target: null,
    action: null,
    reason: null,
    appealed: false,
    hubId: null,
    place: null,
    magnitude: null,
    snippet: null,
    commentId: null,
    postId: null,
    tagId: null,
    homeLabel: null,
    homeCode: null,
    postCommentId: null,
    postAuthorUsername: null,
    source: null,
    ...overrides,
  };
}

function transport(
  items: ActivityItem[] | Error,
  unread = 0,
): jest.Mocked<ActivityTransport> {
  return {
    fetchActivity: jest.fn(async () => {
      if (items instanceof Error) {
        throw items;
      }
      return items;
    }),
    fetchUnread: jest.fn(async () => unread),
    markRead: jest.fn(async () => undefined),
    requestReview: jest.fn(async (_itemId: string, _message: string) => undefined),
  };
}

describe("Activity", () => {
  beforeEach(async () => {
    mockUserId = "me";
    jest.clearAllMocks();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("lists rows newest first with their words, and marks everything read once", async () => {
    const tr = transport([
      item({ id: "a", kind: "comment_reply", snippet: "Felt it too", hubId: "bml1" }),
      item({ id: "b", read: true }),
    ]);
    await renderWithProviders(<ActivityContent transport={tr} />);
    expect(await screen.findByText("Bnar replied to your comment.")).toBeTruthy();
    expect(screen.getByText("“Felt it too”")).toBeTruthy();
    expect(screen.getByText("Bnar started following you.")).toBeTruthy();
    await waitFor(() => expect(tr.markRead).toHaveBeenCalledTimes(1));
    expect(tr.markRead).toHaveBeenCalledWith();
    expect(
      screen.getByText(
        "Only here in the app. Bumelerze sends notifications for earthquakes only.",
      ),
    ).toBeTruthy();
  });

  it("does not mark anything when everything is read already", async () => {
    const tr = transport([item({ id: "b", read: true })]);
    await renderWithProviders(<ActivityContent transport={tr} />);
    await screen.findByTestId("activity-b");
    expect(tr.markRead).not.toHaveBeenCalled();
  });

  it("opens the place a row is about", async () => {
    const tr = transport([item({ id: "a", kind: "comment_reply", hubId: "bml1" })]);
    await renderWithProviders(<ActivityContent transport={tr} />);
    fireEvent.press(await screen.findByTestId("activity-a"));
    expect(mockPush).toHaveBeenCalledWith("/event-hub/bml1");
  });

  it("a removal shows its reason and sends one review request", async () => {
    const tr = transport([
      item({
        id: "r",
        kind: "content_removed",
        actor: null,
        target: "comment",
        action: "remove",
        reason: "abuse_harassment",
      }),
    ]);
    await renderWithProviders(<ActivityContent transport={tr} />);
    expect(await screen.findByText("A moderator removed your comment.")).toBeTruthy();
    expect(screen.getByText(/^Reason: /)).toBeTruthy();
    fireEvent.press(screen.getByTestId("activity-review-r"));
    const input = await screen.findByTestId("review-sheet-input");
    await act(async () => {
      fireEvent.changeText(input, "  It was a real report  ");
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("review-sheet-send"));
    });
    expect(tr.requestReview).toHaveBeenCalledWith("r", "It was a real report");
    await waitFor(() => expect(screen.queryByTestId("review-sheet")).toBeNull());
  });

  it("an appealed removal says so instead of offering the button", async () => {
    const tr = transport([
      item({
        id: "r",
        kind: "content_removed",
        actor: null,
        target: "post",
        appealed: true,
      }),
    ]);
    await renderWithProviders(<ActivityContent transport={tr} />);
    expect(await screen.findByTestId("activity-review-sent-r")).toBeTruthy();
    expect(screen.queryByTestId("activity-review-r")).toBeNull();
  });

  it("empty list", async () => {
    await renderWithProviders(<ActivityContent transport={transport([])} />);
    expect(await screen.findByTestId("activity-empty")).toBeTruthy();
  });

  it("before the migration: says not available", async () => {
    await renderWithProviders(
      <ActivityContent transport={transport(new CommunityError("unavailable", "x"))} />,
    );
    expect(await screen.findByTestId("activity-unavailable")).toBeTruthy();
  });

  it("a failed load offers Try again", async () => {
    await renderWithProviders(
      <ActivityContent transport={transport(new CommunityError("network", "x"))} />,
    );
    // one quiet retry first (a flaky network), then the message
    expect(
      await screen.findByTestId("activity-error", {}, { timeout: 5000 }),
    ).toBeTruthy();
    expect(screen.getByTestId("activity-retry")).toBeTruthy();
  });
});

describe("ActivityBell", () => {
  beforeEach(async () => {
    mockUserId = "me";
    jest.clearAllMocks();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("shows the number of new rows and opens Activity", async () => {
    await renderWithProviders(<ActivityBell transport={transport([], 3)} />);
    expect(await screen.findByTestId("activity-bell-count")).toBeTruthy();
    expect(screen.getByLabelText("Activity, 3 new")).toBeTruthy();
    fireEvent.press(screen.getByTestId("activity-bell"));
    expect(mockPush).toHaveBeenCalledWith("/account/activity");
  });

  it("no number when nothing is new", async () => {
    await renderWithProviders(<ActivityBell transport={transport([], 0)} />);
    expect(await screen.findByLabelText("Activity")).toBeTruthy();
    expect(screen.queryByTestId("activity-bell-count")).toBeNull();
  });

  it("nothing at all without an identity on the server", async () => {
    mockUserId = null;
    await renderWithProviders(<ActivityBell transport={transport([], 5)} />);
    expect(screen.queryByTestId("activity-bell")).toBeNull();
  });

  it("caps the badge at 9+ and uses Eastern Arabic digits in Sorani", async () => {
    await i18n.changeLanguage("ckb");
    await renderWithProviders(<ActivityBell transport={transport([], 42)} />);
    expect(await screen.findByText("٩+")).toBeTruthy();
    await i18n.changeLanguage("en");
  });
});
