import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";

import i18n from "@/i18n";
import { encodeGeohash } from "@/lib/felt-aggregation/geohash";

import { EventHubContent } from "../components/EventHubContent";
import { makeSocialTransport } from "@/features/social/__fixtures__/testing";

import { HubError } from "../types";
import {
  buildComment,
  buildEvent,
  commentMenuAction,
  openCommentMenu,
  EMPTY_SUMMARY,
  makeTransport,
  renderWithProviders,
} from "../__fixtures__/testing";

const mockPush = jest.fn();
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  const { useEffect } = require("react");
  return {
    useRouter: () => ({ push: mockPush }),
    // Stood in as a plain effect: the screen is "focused" once mounted.
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => effect(), [effect]);
    },
  };
});

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));

jest.mock("@/features/feltmap/use-event-uuid", () => ({
  useEventUuid: () => "uuid-1",
  useEventUuidResult: () => ({ uuid: "uuid-1", isPending: false }),
}));

let mockAccount: { status: string; userId: string | null } = {
  status: "anonymous",
  userId: "anon-1",
};
jest.mock("@/features/account", () => ({
  ...jest.requireActual("@/features/account"),
  useAccount: () => mockAccount,
}));

const SLEMANI_AREA = encodeGeohash(35.57, 45.44, 5);

const openMenu = (id: string) => openCommentMenu(id);
const menuAction = (id: string, row: string) => commentMenuAction(id, row);

async function renderHub(transport: ReturnType<typeof makeTransport>) {
  await renderWithProviders(
    <EventHubContent event={buildEvent()} transport={transport} />,
  );
}

describe("EventHubContent", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    mockAccount = { status: "anonymous", userId: "anon-1" };
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("shows the magnitude and place subtitle", async () => {
    await renderHub(makeTransport());
    const subtitle = await screen.findByTestId("hub-subtitle");
    const text = String(
      Array.isArray(subtitle.props.children)
        ? subtitle.props.children.join("")
        : subtitle.props.children,
    );
    expect(text).toContain("M 4.2");
  });

  describe("prebunk card", () => {
    it("shows the 'no one can predict earthquakes' reminder on every hub", async () => {
      await renderHub(makeTransport());
      expect(await screen.findByTestId("hub-prebunk")).toBeTruthy();
      expect(
        screen.getByText(
          "No one can predict earthquakes. Ignore messages that name a day or time.",
        ),
      ).toBeTruthy();
    });

    it("is also there when the hub cannot load, and reads in Sorani", async () => {
      await i18n.changeLanguage("ckb");
      await renderHub(makeTransport({}, { fetchSummary: jest.fn(async () => null) }));
      expect(await screen.findByTestId("hub-prebunk")).toBeTruthy();
      expect(
        screen.getByText(/^هیچ کەسێک ناتوانێت بوومەلەرزە پێشبینی بکات/),
      ).toBeTruthy();
    });
  });

  describe("the hub as a post (review note 4.4)", () => {
    it("says there are no comments yet, and the felt button opens Share your experience", async () => {
      await renderHub(makeTransport());
      expect(
        await screen.findByText("No comments yet. Be the first to share what you felt."),
      ).toBeTruthy();
      const felt = screen.getByTestId("hub-actions-felt");
      expect(felt).toHaveTextContent(/I felt it!$/);
      await fireEvent.press(felt);
      expect(mockPush).toHaveBeenCalledWith(
        expect.objectContaining({ pathname: "/felt-report" }),
      );
    });

    it("counts the people who felt it in the action row, and the comments", async () => {
      await renderHub(
        makeTransport({
          summary: {
            reports: 14,
            people: 12,
            levels: { 3: 4, 5: 10 },
            firstReportAt: Date.UTC(2026, 9, 4, 10, 30),
            comments: 3,
          },
        }),
      );
      expect(await screen.findByText(/14.{0,2} felt it$/)).toBeTruthy();
      expect(screen.getByTestId("hub-actions-comments")).toHaveTextContent(/3/);
      expect(screen.getByTestId("hub-comment-count")).toHaveTextContent(/3/);
    });

    it("has the post header, the slides and the share image as slide 1", async () => {
      await renderHub(makeTransport());
      expect(await screen.findByTestId("hub-post-header")).toBeTruthy();
      expect(
        screen.getByTestId("event-mark", { includeHiddenElements: true }),
      ).toBeTruthy();
      expect(screen.getByTestId("hub-carousel")).toBeTruthy();
      expect(screen.getByTestId("slide-share-image")).toBeTruthy();
      // The hub is Bumelerze's: the official mark beside the title.
      expect(
        within(screen.getByTestId("hub-post-header")).getByTestId(
          "role-mark-official-icon",
        ),
      ).toBeTruthy();
    });

    it("opens the share sheet from the action row and from the ... menu", async () => {
      await renderHub(makeTransport());
      await fireEvent.press(await screen.findByTestId("hub-actions-share"));
      expect(await screen.findByTestId("share-sheet")).toBeTruthy();
    });

    it("an account gives the hub a heart and takes it back; the count follows", async () => {
      mockAccount = { status: "account", userId: "acct-1" };
      const social = makeSocialTransport({ hubLikes: { count: 127, liked: false } });
      await renderWithProviders(
        <EventHubContent
          event={buildEvent()}
          transport={makeTransport()}
          socialTransport={social}
        />,
      );
      const heart = await screen.findByTestId("hub-actions-heart");
      expect(heart).toHaveTextContent(/127/);
      expect(heart.props.accessibilityState.selected).toBe(false);
      await fireEvent.press(heart);
      await waitFor(() => expect(social.setHubLike).toHaveBeenCalledWith("uuid-1", true));
      await waitFor(() =>
        expect(screen.getByTestId("hub-actions-heart")).toHaveTextContent(/128/),
      );
      expect(
        screen.getByTestId("hub-actions-heart").props.accessibilityState.selected,
      ).toBe(true);
      await fireEvent.press(screen.getByTestId("hub-actions-heart"));
      await waitFor(() =>
        expect(social.setHubLike).toHaveBeenCalledWith("uuid-1", false),
      );
    });

    it("a guest reads the hub's hearts but cannot give one", async () => {
      const social = makeSocialTransport({ hubLikes: { count: 5, liked: false } });
      await renderWithProviders(
        <EventHubContent
          event={buildEvent()}
          transport={makeTransport()}
          socialTransport={social}
        />,
      );
      expect(await screen.findByLabelText(/^Likes: .*5/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Likes/ })).toBeNull();
      expect(social.setHubLike).not.toHaveBeenCalled();
    });

    it("shows no heart when the server has no hearts yet (migration 0065 missing)", async () => {
      await renderHub(makeTransport());
      await screen.findByTestId("hub-actions");
      expect(screen.queryByTestId("hub-actions-heart")).toBeNull();
    });

    it("says it could not load, with a retry, when the comments cannot be read", async () => {
      const transport = makeTransport(
        {},
        { fetchComments: jest.fn(async () => Promise.reject(new HubError("network"))) },
      );
      await renderHub(transport);
      expect(
        await screen.findByText("Couldn't load. Check your connection."),
      ).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() =>
        expect(transport.fetchComments.mock.calls.length).toBeGreaterThan(1),
      );
    });
  });

  describe("thread", () => {
    const comments = [
      buildComment({
        id: "root-new",
        userId: "u-awat",
        body: "Strong shaking in Slemani",
        areaGeohash: SLEMANI_AREA,
        createdAt: Date.now() - 5 * 60_000,
        helpfulCount: 3,
      }),
      buildComment({
        id: "root-old",
        userId: "u-bumelerze",
        body: "Official update: no damage reported",
        createdAt: Date.now() - 2 * 3_600_000,
      }),
      buildComment({
        id: "reply-b",
        parentId: "root-new",
        userId: "u-nameless",
        body: "Second reply",
        createdAt: Date.now() - 2 * 60_000,
      }),
      buildComment({
        id: "reply-a",
        parentId: "root-new",
        userId: "u-awat",
        body: "First reply",
        createdAt: Date.now() - 4 * 60_000,
      }),
    ];
    const data = {
      comments,
      authors: {
        "u-awat": { displayName: "Awat" },
        "u-bumelerze": { displayName: "Bumelerze Team" },
      },
      roles: { "u-bumelerze": [{ role: "official" as const, orgName: null }] },
    };

    it("lists threads newest first with replies oldest first, names, role marks, area and time", async () => {
      await renderHub(makeTransport(data));
      expect(await screen.findByText("Strong shaking in Slemani")).toBeTruthy();
      // Replies start folded under "View 2 replies".
      expect(screen.queryByText("First reply")).toBeNull();
      expect(screen.getByTestId("replies-toggle-root-new")).toHaveTextContent(
        /View .*2.* replies/,
      );
      await fireEvent.press(screen.getByTestId("replies-toggle-root-new"));

      const bodies = screen
        .getAllByText(
          /Strong shaking in Slemani|Official update|First reply|Second reply/,
        )
        .map((node) => String(node.props.children));
      expect(bodies).toEqual([
        "Strong shaking in Slemani",
        "First reply",
        "Second reply",
        "Official update: no damage reported",
      ]);

      // Name from profiles; no profile -> Anonymous.
      expect(screen.getAllByText("Awat").length).toBe(2);
      expect(screen.getByText("Anonymous")).toBeTruthy();
      // Official mark: the Bumelerze icon, no text beside it (one on the
      // hub's own header, one on the official comment).
      expect(
        within(screen.getByTestId("comment-root-old")).getByTestId(
          "role-mark-official-icon",
        ),
      ).toBeTruthy();
      // Area from the geohash, as a city, never coordinates.
      expect(screen.getByText("felt it near Slemani")).toBeTruthy();
      // Relative times.
      expect(screen.getByText(/· 5m ago$/)).toBeTruthy();
      expect(screen.getByText(/· 2h ago$/)).toBeTruthy();
      // The heart's count is visible to anonymous readers, read-only.
      expect(screen.getByLabelText(/^Likes: .*3/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Likes/ })).toBeNull();
    });

    it("indents replies one level under their thread", async () => {
      await renderHub(makeTransport(data));
      await fireEvent.press(await screen.findByTestId("replies-toggle-root-new"));
      await screen.findByText("First reply");
      // The indent is an empty column at the start of a row, so it mirrors
      // in Sorani and Arabic on the web too.
      expect(screen.getByTestId("comment-root-new")).toBeTruthy();
      expect(screen.queryByTestId("comment-indent-root-new")).toBeNull();
      const indent = screen.getByTestId("comment-indent-reply-a");
      expect(indent.props.style).toEqual({ width: 48 });
    });

    describe("after the author deleted their account", () => {
      const blank = buildComment({
        id: "gone",
        userId: null,
        body: "",
        areaGeohash: null,
        createdAt: Date.now() - 20 * 60_000,
        replyCount: 1,
      });
      const reply = buildComment({
        id: "after",
        parentId: "gone",
        userId: "u-awat",
        body: "I felt it too",
        createdAt: Date.now() - 10 * 60_000,
      });
      const authors = { "u-awat": { displayName: "Awat" } };

      it("shows 'Deleted account' with no photo, name, link or actions, and keeps the reply under it", async () => {
        await renderHub(makeTransport({ comments: [blank, reply], authors }));
        await fireEvent.press(await screen.findByTestId("replies-toggle-gone"));
        expect(await screen.findByText("I felt it too")).toBeTruthy();
        expect(screen.getByTestId("comment-deleted-account-gone")).toHaveTextContent(
          "Deleted account",
        );
        expect(screen.queryByTestId("comment-avatar-gone")).toBeNull();
        expect(screen.queryByTestId("comment-avatar-link-gone")).toBeNull();
        expect(screen.queryByTestId("comment-name-link-gone")).toBeNull();
        expect(screen.queryByText("Anonymous")).toBeNull();
        const row = screen.getByTestId("comment-gone");
        expect(within(row).queryByRole("button")).toBeNull();
        // the reply is a normal comment
        expect(screen.getByTestId("comment-after")).toBeTruthy();
      });

      it("leaves a lone blank comment out, nothing is under it", async () => {
        await renderHub(
          makeTransport({
            comments: [blank, buildComment({ id: "other", body: "Another one" })],
          }),
        );
        expect(await screen.findByText("Another one")).toBeTruthy();
        expect(screen.queryByTestId("comment-gone")).toBeNull();
        expect(screen.queryByText("Deleted account")).toBeNull();
      });

      it.each([
        ["ckb", "هەژماری سڕاوە"],
        ["kmr", "Hesabê jêbirî"],
        ["ar", "حساب محذوف"],
      ] as const)("is worded in %s", async (locale, text) => {
        await i18n.changeLanguage(locale);
        await renderHub(makeTransport({ comments: [blank, reply], authors }));
        expect(
          await screen.findByTestId("comment-deleted-account-gone"),
        ).toHaveTextContent(text);
      });
    });

    it("uses the Sorani locale for the empty-thread text", async () => {
      await i18n.changeLanguage("ckb");
      await renderHub(makeTransport());
      expect(
        await screen.findByText(
          "هێشتا تێبینی نییە. یەکەم کەس بە کە ئەوەی هەستت پێکرد هاوبەشی دەکەیت.",
        ),
      ).toBeTruthy();
    });
  });

  describe("anonymous reader", () => {
    it("is told the comment waits for review, with a sign-in link, once they start writing", async () => {
      await renderHub(makeTransport());
      expect(screen.queryByTestId("hub-composer-anonymous-note")).toBeNull();
      await fireEvent.changeText(
        await screen.findByTestId("hub-composer-input"),
        "I felt",
      );
      expect(
        await screen.findByText(
          "Your comment will appear after review. Create an account to post right away.",
        ),
      ).toBeTruthy();
      await fireEvent.press(screen.getByRole("link", { name: "Create an account" }));
      expect(mockPush).toHaveBeenCalledWith("/account/sign-in");
    });

    it("sees their own pending comment marked 'Waiting for review', and no Helpful button", async () => {
      await renderHub(
        makeTransport({
          comments: [
            buildComment({
              id: "mine",
              userId: "anon-1",
              status: "pending",
              body: "My pending note",
            }),
            buildComment({ id: "theirs", body: "Their note" }),
            buildComment({
              id: "hidden-pending",
              status: "pending",
              body: "Someone else pending",
            }),
          ],
        }),
      );
      expect(await screen.findByText("My pending note")).toBeTruthy();
      // Only the author sees a held comment, and is told so.
      expect(screen.getByText("Waiting for review · only you see this")).toBeTruthy();
      expect(screen.queryByText("Someone else pending")).toBeNull();
      expect(screen.queryByRole("button", { name: /^Likes/ })).toBeNull();
      // Own comment can be deleted, others' can be reported: in the "..." sheet.
      expect(await openMenu("mine")).toEqual(["delete-mine"]);
      await fireEvent.press(screen.getByTestId("comment-menu-mine-cancel"));
      expect(await openMenu("theirs")).toEqual(["mute-theirs", "report-theirs"]);
    });

    it("posts through the transport and tells them it awaits review", async () => {
      const transport = makeTransport();
      await renderHub(transport);
      await fireEvent.changeText(
        await screen.findByTestId("hub-composer-input"),
        "I felt it",
      );
      await fireEvent.press(screen.getByTestId("hub-composer-post"));
      await waitFor(() =>
        expect(transport.postComment).toHaveBeenCalledWith({
          eventUuid: "uuid-1",
          parentId: null,
          body: "I felt it",
        }),
      );
      expect(
        await screen.findByText("Thanks. Your comment is waiting for review."),
      ).toBeTruthy();
    });
  });

  describe("signed-in account", () => {
    beforeEach(() => {
      mockAccount = { status: "account", userId: "acct-1" };
    });

    it("has no review note, can post, and 1000 characters is the input limit", async () => {
      const transport = makeTransport();
      await renderHub(transport);
      const input = await screen.findByTestId("hub-composer-input");
      expect(input.props.maxLength).toBe(1000);
      expect(screen.queryByText(/appear after review/)).toBeNull();

      await fireEvent.changeText(input, "  Shaking for 10 seconds  ");
      await fireEvent.press(screen.getByTestId("hub-composer-post"));
      await waitFor(() =>
        expect(transport.postComment).toHaveBeenCalledWith({
          eventUuid: "uuid-1",
          parentId: null,
          body: "Shaking for 10 seconds",
        }),
      );
      await waitFor(() =>
        expect(screen.getByTestId("hub-composer-input").props.value).toBe(""),
      );
    });

    it("keeps Post disabled for an empty comment", async () => {
      await renderHub(makeTransport());
      const post = await screen.findByTestId("hub-composer-post");
      expect(post.props.accessibilityState.disabled).toBe(true);
    });

    it("shows a short message for the rate limit and for other failures", async () => {
      const postComment = jest
        .fn()
        .mockRejectedValueOnce(new HubError("rate_limited"))
        .mockRejectedValueOnce(new Error("boom"));
      await renderHub(makeTransport({}, { postComment }));
      await fireEvent.changeText(
        await screen.findByTestId("hub-composer-input"),
        "hello",
      );

      await fireEvent.press(screen.getByTestId("hub-composer-post"));
      expect(
        await screen.findByText("Too many comments. Wait a few minutes."),
      ).toBeTruthy();
      // The text is kept so nothing typed is lost.
      expect(screen.getByTestId("hub-composer-input").props.value).toBe("hello");

      await fireEvent.press(screen.getByTestId("hub-composer-post"));
      expect(await screen.findByText("Couldn't post. Try again.")).toBeTruthy();
    });

    it("toggles the heart (the Helpful mark) on someone else's comment, not on their own", async () => {
      const transport = makeTransport({
        comments: [
          buildComment({ id: "theirs", body: "Their note", helpfulCount: 1 }),
          buildComment({ id: "mine", userId: "acct-1", body: "My note" }),
        ],
        helped: ["theirs"],
      });
      await renderHub(transport);
      const helpful = await screen.findByRole("button", { name: /^Likes: .*1/ });
      expect(helpful.props.accessibilityState.selected).toBe(true);
      // Only one heart button: the account's own comment has none.
      expect(screen.queryAllByRole("button", { name: /^Likes/ })).toHaveLength(1);

      await fireEvent.press(helpful);
      await waitFor(() =>
        expect(transport.setHelpful).toHaveBeenCalledWith("theirs", false),
      );
    });

    it("replies into the thread, under the thread's root", async () => {
      const transport = makeTransport({
        comments: [buildComment({ id: "root-1", body: "Anyone else feel it?" })],
      });
      await renderHub(transport);
      await fireEvent.press(await screen.findByRole("button", { name: "Reply" }));
      // The docked composer takes the reply, and says to whom.
      const input = await screen.findByTestId("hub-composer-input");
      expect(input.props.placeholder).toBe("Write a reply");
      expect(screen.getByTestId("hub-reply-cancel")).toBeTruthy();
      await fireEvent.changeText(input, "Yes, strongly");
      await fireEvent.press(screen.getByTestId("hub-composer-post"));
      await waitFor(() =>
        expect(transport.postComment).toHaveBeenCalledWith({
          eventUuid: "uuid-1",
          parentId: "root-1",
          body: "Yes, strongly",
        }),
      );
      // Back to a plain comment once posted.
      await waitFor(() => expect(screen.queryByTestId("hub-reply-cancel")).toBeNull());
    });

    it("reports a comment with a reason", async () => {
      const transport = makeTransport({
        comments: [buildComment({ id: "c-bad", body: "Buy my stuff" })],
      });
      await renderHub(transport);
      await menuAction("c-bad", "report-c-bad");
      // The shared report sheet: reasons first, nothing is sent until one is chosen.
      expect(screen.getByText("Report this comment")).toBeTruthy();
      expect(screen.queryByTestId("report-sheet-c-bad-reason-impersonation")).toBeNull();
      expect(
        screen.getByTestId("report-sheet-c-bad-submit").props.accessibilityState.disabled,
      ).toBe(true);
      await fireEvent.press(
        screen.getByTestId("report-sheet-c-bad-reason-rumour_prediction"),
      );
      await fireEvent.changeText(
        screen.getByTestId("report-sheet-c-bad-note"),
        "  says a bigger one comes tonight  ",
      );
      await fireEvent.press(screen.getByTestId("report-sheet-c-bad-submit"));
      await waitFor(() =>
        expect(transport.flagComment).toHaveBeenCalledWith(
          "c-bad",
          "rumour_prediction",
          "says a bigger one comes tonight",
        ),
      );
      expect(await screen.findByText("Thanks. We will review it.")).toBeTruthy();
      expect(screen.queryByTestId("report-sheet-c-bad")).toBeNull();
    });

    it("sends a report without a note as null", async () => {
      const transport = makeTransport({
        comments: [buildComment({ id: "c-bad", body: "Buy my stuff" })],
      });
      await renderHub(transport);
      await menuAction("c-bad", "report-c-bad");
      await fireEvent.press(screen.getByTestId("report-sheet-c-bad-reason-spam"));
      await fireEvent.press(screen.getByTestId("report-sheet-c-bad-submit"));
      await waitFor(() =>
        expect(transport.flagComment).toHaveBeenCalledWith("c-bad", "spam", null),
      );
    });

    it("offers 'Withdraw report' for a comment reported earlier, and takes the report back", async () => {
      const transport = makeTransport({
        comments: [buildComment({ id: "c-bad", body: "Buy my stuff" })],
        flagged: ["c-bad"],
      });
      await renderHub(transport);
      expect(await screen.findByText("Thanks. We will review it.")).toBeTruthy();
      expect(await openMenu("c-bad")).not.toContain("report-c-bad");
      await fireEvent.press(screen.getByTestId("withdraw-report-c-bad"));
      await waitFor(() => expect(transport.withdrawFlag).toHaveBeenCalledWith("c-bad"));
      expect(await screen.findByTestId("report-withdrawn-c-bad")).toBeTruthy();
      // A withdrawn report cannot be raised again (the server keeps the row).
      const rows = await openMenu("c-bad");
      expect(rows).not.toContain("withdraw-report-c-bad");
      expect(rows).not.toContain("report-c-bad");
    });

    it("offers the withdraw button right after reporting", async () => {
      const transport = makeTransport({
        comments: [buildComment({ id: "c-bad", body: "Buy my stuff" })],
      });
      await renderHub(transport);
      await menuAction("c-bad", "report-c-bad");
      await fireEvent.press(screen.getByTestId("report-sheet-c-bad-reason-spam"));
      await fireEvent.press(screen.getByTestId("report-sheet-c-bad-submit"));
      await screen.findByTestId("comment-reported-c-bad");
      expect(await openMenu("c-bad")).toContain("withdraw-report-c-bad");
    });

    it("shows no withdraw button on a comment the viewer did not report", async () => {
      await renderHub(
        makeTransport({ comments: [buildComment({ id: "c1", body: "Fine" })] }),
      );
      await screen.findByText("Fine");
      expect(await openMenu("c1")).not.toContain("withdraw-report-c1");
    });

    it("still shows the thread when the viewer's own reports cannot be read (server without migration 0052)", async () => {
      const transport = makeTransport(
        { comments: [buildComment({ id: "c1", body: "Still here" })] },
        { fetchMyFlags: jest.fn(async () => Promise.reject(new Error("no column"))) },
      );
      await renderHub(transport);
      expect(await screen.findByText("Still here")).toBeTruthy();
      expect(await openMenu("c1")).toContain("report-c1");
    });

    it("says the daily report limit is reached instead of a generic error", async () => {
      const transport = makeTransport(
        { comments: [buildComment({ id: "c-bad", body: "Buy my stuff" })] },
        { flagComment: jest.fn(async () => Promise.reject(new HubError("flag_limit"))) },
      );
      await renderHub(transport);
      await menuAction("c-bad", "report-c-bad");
      await fireEvent.press(screen.getByTestId("report-sheet-c-bad-reason-spam"));
      await fireEvent.press(screen.getByTestId("report-sheet-c-bad-submit"));
      // The sheet stays open and says why, so the reader can close it.
      expect(
        await screen.findByText(
          "You've reached today's limit for reports. Try again tomorrow.",
        ),
      ).toBeTruthy();
      expect(screen.getByTestId("report-sheet-c-bad")).toBeTruthy();
    });

    it("deletes their own comment at once and offers Undo, which restores it", async () => {
      const transport = makeTransport({
        comments: [buildComment({ id: "mine", userId: "acct-1", body: "Oops" })],
      });
      await renderHub(transport);
      await menuAction("mine", "delete-mine");
      await waitFor(() => expect(transport.deleteComment).toHaveBeenCalledWith("mine"));
      expect(screen.queryByText("Delete this comment?")).toBeNull();
      expect(await screen.findByTestId("snackbar-message")).toHaveTextContent(
        "Comment deleted",
      );
      expect(transport.restoreComment).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId("snackbar-action"));
      await waitFor(() => expect(transport.restoreComment).toHaveBeenCalledWith("mine"));
    });

    it("says an action failed instead of failing silently", async () => {
      const transport = makeTransport(
        { comments: [buildComment({ id: "c1", body: "x", userId: "u-other" })] },
        { setHelpful: jest.fn(async () => Promise.reject(new HubError("network"))) },
      );
      await renderHub(transport);
      await fireEvent.press(await screen.findByRole("button", { name: /^Likes/ }));
      expect(await screen.findByText("Couldn't do that. Try again.")).toBeTruthy();
    });
  });

  describe("moderator", () => {
    const pending = buildComment({
      id: "p1",
      userId: "u-other",
      status: "pending",
      body: "Needs a look",
    });

    it("sees pending comments from others with Approve and Hide, which call moderate_comment", async () => {
      mockAccount = { status: "account", userId: "mod-1" };
      const transport = makeTransport({
        comments: [pending],
        roles: { "mod-1": [{ role: "moderator", orgName: null }] },
      });
      await renderHub(transport);
      expect(await screen.findByText("Needs a look")).toBeTruthy();
      expect(screen.getByText("Waiting for review")).toBeTruthy();

      await menuAction("p1", "approve-p1");
      await waitFor(() =>
        expect(transport.moderateComment).toHaveBeenCalledWith("p1", "approve"),
      );

      await menuAction("p1", "hide-p1");
      await waitFor(() =>
        expect(transport.moderateComment).toHaveBeenCalledWith("p1", "hide"),
      );
    });

    it("offers Undo after Hide, and Undo calls the admin restore", async () => {
      mockAccount = { status: "account", userId: "mod-1" };
      const transport = makeTransport({
        comments: [pending],
        roles: { "mod-1": [{ role: "moderator", orgName: null }] },
      });
      await renderHub(transport);
      await menuAction("p1", "hide-p1");
      await waitFor(() =>
        expect(transport.moderateComment).toHaveBeenCalledWith("p1", "hide"),
      );
      expect(await screen.findByTestId("snackbar-message")).toHaveTextContent(
        "Comment hidden",
      );
      await fireEvent.press(screen.getByTestId("snackbar-action"));
      await waitFor(() =>
        expect(transport.adminRestoreComment).toHaveBeenCalledWith("p1"),
      );
      expect(transport.restoreComment).not.toHaveBeenCalled();
    });

    it("treats an official the same way", async () => {
      mockAccount = { status: "account", userId: "off-1" };
      await renderHub(
        makeTransport({
          comments: [pending],
          roles: { "off-1": [{ role: "official", orgName: null }] },
        }),
      );
      expect(await openMenu("p1")).toContain("approve-p1");
    });

    it("never shows hidden comments, even to a moderator", async () => {
      mockAccount = { status: "account", userId: "mod-1" };
      await renderHub(
        makeTransport({
          comments: [buildComment({ id: "h", status: "hidden", body: "Removed text" })],
          roles: { "mod-1": [{ role: "moderator", orgName: null }] },
        }),
      );
      expect(await screen.findByText(/No comments yet/)).toBeTruthy();
      expect(screen.queryByText("Removed text")).toBeNull();
    });

    it("gives an ordinary account no moderation buttons and no view of others' pending comments", async () => {
      mockAccount = { status: "account", userId: "acct-1" };
      await renderHub(makeTransport({ comments: [pending] }));
      expect(await screen.findByText(/No comments yet/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
      expect(screen.queryByText("Needs a look")).toBeNull();
    });
  });

  describe("refreshing", () => {
    it("re-reads when the screen is pulled to refresh", async () => {
      const transport = makeTransport({ summary: EMPTY_SUMMARY });
      await renderHub(transport);
      await screen.findByText(/No comments yet/);
      const before = transport.fetchComments.mock.calls.length;
      const list = screen.getByTestId("hub-list");
      await act(async () => {
        list.props.refreshControl.props.onRefresh();
      });
      await waitFor(() =>
        expect(transport.fetchComments.mock.calls.length).toBeGreaterThan(before),
      );
    });
  });
});
