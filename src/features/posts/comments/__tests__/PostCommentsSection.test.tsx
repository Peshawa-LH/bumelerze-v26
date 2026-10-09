import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import { CommunityError } from "@/features/community/types";
import i18n from "@/i18n";

import {
  PostCommentsSection,
  type CommentsViewer,
} from "../components/PostCommentsSection";
import { comment, makeFakeComments } from "../__fixtures__/fake-comments";

let mockUuid = 0;
jest.mock("expo-crypto", () => ({ randomUUID: () => `client-${++mockUuid}` }));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "me" }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
  signInAnonymously: jest.fn(async () => undefined),
}));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
const mockConfirm = jest.fn();
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: (options: unknown) => mockConfirm(options),
  messageDialog: jest.fn(),
}));

const ACCOUNT: CommentsViewer = {
  userId: "me",
  isAccount: true,
  isLimited: false,
  canReport: true,
  isModerator: false,
  canRemove: false,
};
const accept = jest.fn(async () => undefined);

async function renderSection(
  fake: ReturnType<typeof makeFakeComments>,
  props: Partial<Parameters<typeof PostCommentsSection>[0]> = {},
) {
  await renderWithProviders(
    <PostCommentsSection
      postId="p1"
      commentCount={2}
      commentsOff={false}
      isPostOwner={false}
      viewer={ACCOUNT}
      transport={fake}
      guidelinesTransport={{ accept }}
      {...props}
    />,
  );
}

const open = async () => fireEvent.press(screen.getByTestId("post-comments-toggle-p1"));

describe("PostCommentsSection", () => {
  beforeEach(async () => {
    mockConfirm.mockClear();
    mockPush.mockClear();
    if (i18n.language !== "en") await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("is closed at first (nothing loaded) and shows the count", async () => {
    const fake = makeFakeComments([comment("a", 5)]);
    await renderSection(fake);
    expect(screen.getByText("Comments (⁦2⁩)")).toBeTruthy();
    expect(fake.fetchComments).not.toHaveBeenCalled();
    await open();
    expect(await screen.findByTestId("post-comment-a")).toBeTruthy();
    expect(fake.fetchComments).toHaveBeenCalledWith("p1");
  });

  it("shows conversations newest first with replies under them, and @mentions as text", async () => {
    const fake = makeFakeComments([
      comment("old", 60, { body: "hello @user_new" }),
      comment("new", 5),
      comment("reply", 30, { parentId: "old" }),
    ]);
    await renderSection(fake);
    await open();
    await screen.findByTestId("post-comment-old");
    const ids = screen
      .getAllByTestId(/^post-comment-(old|new|reply)$/)
      .map((n) => n.props.testID);
    expect(ids).toEqual(["post-comment-new", "post-comment-old", "post-comment-reply"]);
    expect(screen.getByTestId("post-comment-body-old")).toBeTruthy();
  });

  it("an account writes a comment, sent once with a client id; a held one says so", async () => {
    const fake = makeFakeComments([]);
    fake.addComment.mockResolvedValueOnce({ id: "x", status: "pending" });
    await renderSection(fake, { commentCount: 0 });
    await open();
    await fireEvent.changeText(
      screen.getByTestId("post-comment-composer-p1-input"),
      "Felt it too",
    );
    await fireEvent.press(screen.getByTestId("post-comment-composer-p1-post"));
    await waitFor(() =>
      expect(fake.addComment).toHaveBeenCalledWith({
        postId: "p1",
        body: "Felt it too",
        parentId: null,
        clientId: expect.stringMatching(/^client-/),
      }),
    );
    expect(await screen.findByTestId("post-comments-held-p1")).toBeTruthy();
  });

  it("keeps the same client id for a retry after a failure", async () => {
    const fake = makeFakeComments([]);
    fake.addComment.mockRejectedValueOnce(new CommunityError("network"));
    await renderSection(fake, { commentCount: 0 });
    await open();
    await fireEvent.changeText(
      screen.getByTestId("post-comment-composer-p1-input"),
      "again",
    );
    await fireEvent.press(screen.getByTestId("post-comment-composer-p1-post"));
    await waitFor(() => expect(fake.addComment).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByTestId("post-comment-composer-p1-post"));
    await waitFor(() => expect(fake.addComment).toHaveBeenCalledTimes(2));
    const ids = fake.addComment.mock.calls.map((call) => call[0].clientId);
    expect(ids[0]).toBe(ids[1]);
  });

  it("words 'comments are off' when the server refuses", async () => {
    const fake = makeFakeComments([]);
    fake.addComment.mockRejectedValueOnce(new CommunityError("comments_off"));
    await renderSection(fake, { commentCount: 0 });
    await open();
    await fireEvent.changeText(screen.getByTestId("post-comment-composer-p1-input"), "x");
    await fireEvent.press(screen.getByTestId("post-comment-composer-p1-post"));
    expect(await screen.findByText("Comments are off for this post.")).toBeTruthy();
  });

  it("guests read but get no box, only 'create an account'", async () => {
    const fake = makeFakeComments([comment("a", 5)]);
    await renderSection(fake, { viewer: { ...ACCOUNT, isAccount: false } });
    await open();
    await screen.findByTestId("post-comment-a");
    expect(screen.queryByTestId("post-comment-composer-p1")).toBeNull();
    expect(screen.getByTestId("post-comments-guest-p1")).toBeTruthy();
    expect(screen.queryByTestId("post-comment-reply-a")).toBeNull();
  });

  it("a limited account sees the box switched off", async () => {
    const fake = makeFakeComments([]);
    await renderSection(fake, { viewer: { ...ACCOUNT, isLimited: true } });
    await open();
    expect(await screen.findByTestId("post-comment-composer-p1-disabled")).toBeTruthy();
  });

  it("comments off: no box for readers, the line says so", async () => {
    const fake = makeFakeComments([comment("a", 5)]);
    await renderSection(fake, { commentsOff: true });
    expect(screen.getByTestId("post-comments-off-p1")).toBeTruthy();
    await open();
    await screen.findByTestId("post-comment-a");
    expect(screen.queryByTestId("post-comment-composer-p1")).toBeNull();
    expect(screen.queryByTestId("post-comments-switch-p1")).toBeNull();
  });

  it("the post's author switches comments off with Undo, and deletes anybody's comment with Undo", async () => {
    const fake = makeFakeComments([comment("rude", 5)]);
    await renderSection(fake, { isPostOwner: true });
    await open();
    await fireEvent.press(await screen.findByTestId("post-comments-switch-p1"));
    await waitFor(() => expect(fake.setCommentsOff).toHaveBeenCalledWith("p1", true));
    expect(await screen.findByText("Comments turned off")).toBeTruthy();
    await fireEvent.press(screen.getByText("Undo"));
    await waitFor(() =>
      expect(fake.setCommentsOff).toHaveBeenLastCalledWith("p1", false),
    );

    await fireEvent.press(screen.getByTestId("post-comment-delete-rude"));
    await waitFor(() => expect(fake.deleteComment).toHaveBeenCalledWith("rude"));
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(await screen.findByText("Comment deleted")).toBeTruthy();
    await fireEvent.press(screen.getByText("Undo"));
    await waitFor(() => expect(fake.restoreComment).toHaveBeenCalledWith("rude"));
  });

  it("readers do not get Delete on someone else's comment, but get Report and Mute", async () => {
    const fake = makeFakeComments([
      comment("a", 5),
      comment("mine", 3, { userId: "me" }),
    ]);
    await renderSection(fake);
    await open();
    await screen.findByTestId("post-comment-a");
    expect(screen.queryByTestId("post-comment-delete-a")).toBeNull();
    expect(screen.getByTestId("post-comment-report-a")).toBeTruthy();
    expect(screen.getByTestId("post-comment-mute-a")).toBeTruthy();
    expect(screen.getByTestId("post-comment-delete-mine")).toBeTruthy();
    expect(screen.queryByTestId("post-comment-report-mine")).toBeNull();
  });

  it("reports through the shared report sheet", async () => {
    const fake = makeFakeComments([comment("a", 5)]);
    await renderSection(fake);
    await open();
    await fireEvent.press(await screen.findByTestId("post-comment-report-a"));
    await fireEvent.press(
      screen.getByTestId("post-comment-report-sheet-a-reason-rumour_prediction"),
    );
    await fireEvent.press(screen.getByTestId("post-comment-report-sheet-a-submit"));
    await waitFor(() =>
      expect(fake.reportComment).toHaveBeenCalledWith("a", "rumour_prediction", null),
    );
    expect(await screen.findByTestId("post-comment-reported-a")).toBeTruthy();
  });

  it("replies attach to the top comment", async () => {
    const fake = makeFakeComments([comment("top", 5)]);
    await renderSection(fake);
    await open();
    await fireEvent.press(await screen.findByTestId("post-comment-reply-top"));
    await fireEvent.changeText(
      screen.getByTestId("post-comment-reply-composer-top-input"),
      "@user_top yes",
    );
    await fireEvent.press(screen.getByTestId("post-comment-reply-composer-top-post"));
    await waitFor(() =>
      expect(fake.addComment).toHaveBeenCalledWith(
        expect.objectContaining({ parentId: "top", body: "@user_top yes" }),
      ),
    );
  });

  it("moderators hide with Undo; the official removes with a reason and Undo", async () => {
    const fake = makeFakeComments([comment("a", 5), comment("b", 4)]);
    await renderSection(fake, {
      viewer: { ...ACCOUNT, isModerator: true, canRemove: true },
    });
    await open();
    await fireEvent.press(await screen.findByTestId("post-comment-hide-a"));
    await waitFor(() =>
      expect(fake.moderate).toHaveBeenCalledWith("a", "hide", undefined),
    );
    await fireEvent.press(await screen.findByText("Undo"));
    await waitFor(() => expect(fake.adminRestore).toHaveBeenCalledWith("a"));

    await fireEvent.press(screen.getByTestId("post-comment-remove-b"));
    await fireEvent.press(screen.getByText(i18n.t("eventHub.reasons.spam")));
    const options = mockConfirm.mock.calls.at(-1)?.[0] as { onConfirm: () => void };
    options.onConfirm();
    await waitFor(() => expect(fake.adminRemove).toHaveBeenCalledWith("b", "spam"));
  });

  it("a removed comment and a deleted account show only as placeholders above replies", async () => {
    const fake = makeFakeComments([
      comment("gone", 50, {
        status: "removed",
        userId: null,
        body: "",
        displayName: null,
      }),
      comment("r", 40, { parentId: "gone" }),
      comment("ghost", 30, { userId: null, body: "", displayName: null }),
    ]);
    await renderSection(fake);
    await open();
    expect(await screen.findByTestId("post-comment-placeholder-gone")).toBeTruthy();
    expect(screen.queryByTestId("post-comment-ghost")).toBeNull();
  });

  it("reads in Sorani (RTL) with the count in Kurdish digits", async () => {
    await i18n.changeLanguage("ckb");
    const fake = makeFakeComments([]);
    await renderSection(fake, { commentCount: 3 });
    expect(
      screen.getByText(i18n.t("postComments.count", { number: "⁦٣⁩" })),
    ).toBeTruthy();
    await i18n.changeLanguage("en");
  });
});
