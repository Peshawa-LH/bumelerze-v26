import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { activityDetail, activityHref, activityMessage } from "@/features/activity/text";
import { parseActivityRows } from "@/features/activity/transport";
import { parseHiddenRemoved } from "@/features/admin/transport";
import { PostCommentQueueSection } from "@/features/admin/components/PostCommentQueueSection";
import { toCommunityError } from "@/features/community/transport";
import { communityErrorText } from "@/features/community/error-text";
import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import { RecentlyDeletedSection } from "@/features/profile/components/RecentlyDeletedSection";
import { parseRecentlyDeleted } from "@/features/undo/transport";
import type { UndoTransport } from "@/features/undo/transport";
import i18n from "@/i18n";

import { makeFakeComments } from "../__fixtures__/fake-comments";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "me" }),
}));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
const mockConfirm = jest.fn();
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: (options: unknown) => mockConfirm(options),
  messageDialog: jest.fn(),
}));

const t = i18n.t.bind(i18n);

function activityRow(overrides: Record<string, unknown>) {
  return {
    item_id: "i1",
    created_at: "2026-10-09T10:00:00Z",
    read_at: null,
    actor_id: "u-b",
    actor_username: "userb",
    actor_name: "Bnar",
    actor_avatar: null,
    item_count: 1,
    ...overrides,
  };
}

describe("activity for comments on posts and mentions (0063)", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("parses the new kinds and fields, and opens the post's profile", () => {
    const [onPost, reply, mentionPost, mentionHub] = parseActivityRows([
      activityRow({
        kind: "post_comment",
        snippet: "Felt it too",
        post_comment_id: "pc1",
        post_id: "p1",
        post_author_username: "dilan",
      }),
      activityRow({
        item_id: "i2",
        kind: "post_comment_reply",
        post_comment_id: "pc2",
        post_author_username: "aso",
      }),
      activityRow({
        item_id: "i3",
        kind: "mention",
        source: "post_comment",
        snippet: "hi @me",
        post_author_username: "aso",
      }),
      activityRow({
        item_id: "i4",
        kind: "mention",
        source: "comment",
        hub_id: "bml2026aaa",
      }),
    ]);
    expect(onPost).toMatchObject({
      kind: "post_comment",
      postCommentId: "pc1",
      postAuthorUsername: "dilan",
    });
    expect(activityMessage(t, onPost!, "en")).toBe("Bnar commented on your post.");
    expect(activityDetail(t, onPost!)).toBe("“Felt it too”");
    expect(activityHref(onPost!)).toBe("/u/dilan");
    expect(activityMessage(t, reply!, "en")).toBe(
      "Bnar replied to your comment on a post.",
    );
    expect(activityHref(reply!)).toBe("/u/aso");
    expect(activityMessage(t, mentionPost!, "en")).toBe(
      "Bnar mentioned you in a comment.",
    );
    expect(activityHref(mentionPost!)).toBe("/u/aso");
    expect(activityMessage(t, mentionHub!, "en")).toBe(
      "Bnar mentioned you in an Event hub comment.",
    );
    expect(activityHref(mentionHub!)).toBe("/event-hub/bml2026aaa");
  });

  it("words a hidden or removed post comment and a reviewed report", () => {
    const [hidden, reviewed] = parseActivityRows([
      activityRow({
        kind: "content_removed",
        actor_id: null,
        target: "post_comment",
        action: "hide",
        reason: "spam",
      }),
      activityRow({
        item_id: "i2",
        kind: "report_reviewed",
        actor_id: null,
        target: "post_comment",
      }),
    ]);
    expect(activityMessage(t, hidden!, "en")).toBe(
      "A moderator hid your comment on a post.",
    );
    expect(activityMessage(t, reviewed!, "en")).toBe(
      "We reviewed a comment you reported. Thank you.",
    );
  });

  it("every new kind has words in all four languages", async () => {
    for (const locale of ["en", "ckb", "kmr", "ar"]) {
      await i18n.changeLanguage(locale);
      for (const key of [
        "activity.kinds.post_comment",
        "activity.kinds.post_comment_reply",
        "activity.mention.comment",
        "activity.mention.post",
        "activity.mention.post_comment",
        "activity.removed.post_comment_hide",
        "activity.removed.post_comment_remove",
        "activity.reviewed.post_comment",
        "community.errors.comments_off",
      ]) {
        expect(i18n.exists(key)).toBe(true);
      }
    }
    await i18n.changeLanguage("en");
  });
});

describe("errors", () => {
  it("maps comments_off", () => {
    const error = toCommunityError({
      message: "post_comments: comments_off",
      code: "42501",
    });
    expect(error.code).toBe("comments_off");
    expect(communityErrorText(t, error)).toBe("Comments are off for this post.");
  });
});

describe("Recently deleted includes my post comments", () => {
  afterEach(cleanup);

  it("parses and restores through the post comments transport", async () => {
    const now = Date.now();
    const rows = parseRecentlyDeleted([
      {
        kind: "post_comment",
        item_id: "pc1",
        body: "my words",
        deleted_at: new Date(now - 3_600_000).toISOString(),
        expires_at: new Date(now + 3_600_000).toISOString(),
        hub_id: null,
      },
    ]);
    expect(rows[0]).toMatchObject({ kind: "post_comment", id: "pc1" });
    const undo: jest.Mocked<UndoTransport> = {
      fetchRecentlyDeleted: jest.fn(async () => rows),
    };
    const comments = makeFakeComments([]);
    await renderWithProviders(
      <RecentlyDeletedSection transport={undo} postCommentsTransport={comments} />,
    );
    expect(await screen.findByText("Comment on a post")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("restore-post_comment-pc1"));
    await waitFor(() => expect(comments.restoreComment).toHaveBeenCalledWith("pc1"));
  });
});

describe("Admin", () => {
  afterEach(cleanup);

  it("Hidden and removed lists post comments", () => {
    const [row] = parseHiddenRemoved([
      {
        kind: "post_comment",
        item_id: "pc1",
        status: "hidden",
        acted_at: "2026-10-09T10:00:00Z",
        body: "x",
        can_restore: true,
      },
    ]);
    expect(row).toMatchObject({
      kind: "post_comment",
      status: "hidden",
      canRestore: true,
    });
  });

  it("the queue approves held comments, hides and removes with Undo", async () => {
    const comments = makeFakeComments([]);
    comments.fetchQueue.mockResolvedValue([
      {
        commentId: "held",
        postId: "p1",
        postAuthorUsername: "dilan",
        authorId: "u1",
        username: "shirin",
        displayName: "Shirin",
        body: "kill yourself",
        status: "pending",
        reportCount: 0,
        lastReason: null,
        lastNote: null,
        createdAt: Date.now(),
      },
      {
        commentId: "reported",
        postId: "p1",
        postAuthorUsername: "dilan",
        authorId: "u2",
        username: "aso",
        displayName: "Aso",
        body: "rude",
        status: "visible",
        reportCount: 2,
        lastReason: "abuse_harassment",
        lastNote: "he insulted me",
        createdAt: Date.now(),
      },
    ]);
    const filter = { fetchHolds: jest.fn(async () => []) } as never;
    await renderWithProviders(
      <PostCommentQueueSection canRemove transport={comments} filterTransport={filter} />,
    );
    expect(await screen.findByTestId("admin-post-comments")).toBeTruthy();
    expect(screen.getByText("Approve")).toBeTruthy();
    expect(
      screen.getByTestId("queue-post-comment-approve-reported").props
        .accessibilityLabel ?? "",
    ).toBeDefined();
    await fireEvent.press(screen.getByTestId("queue-post-comment-approve-held"));
    await waitFor(() =>
      expect(comments.moderate).toHaveBeenCalledWith("held", "approve", undefined),
    );
    await fireEvent.press(screen.getByTestId("queue-post-comment-hide-reported"));
    await waitFor(() =>
      expect(comments.moderate).toHaveBeenCalledWith("reported", "hide", undefined),
    );
    await fireEvent.press(screen.getByTestId("queue-post-comment-open-reported"));
    expect(mockPush).toHaveBeenCalledWith("/u/dilan");
    await fireEvent.press(screen.getByTestId("queue-post-comment-remove-reported"));
    await fireEvent.press(screen.getByText(i18n.t("eventHub.reasons.abuse")));
    const options = mockConfirm.mock.calls.at(-1)?.[0] as { onConfirm: () => void };
    options.onConfirm();
    await waitFor(() =>
      expect(comments.adminRemove).toHaveBeenCalledWith("reported", "abuse"),
    );
  });
});
