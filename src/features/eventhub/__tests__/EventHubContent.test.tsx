import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import { encodeGeohash } from "@/lib/felt-aggregation/geohash";

import { EventHubContent } from "../components/EventHubContent";
import { HubError } from "../types";
import {
  buildComment,
  buildEvent,
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

  describe("empty states", () => {
    it("says there are no reports and no comments yet", async () => {
      await renderHub(makeTransport());
      expect(await screen.findByText("No reports yet")).toBeTruthy();
      expect(
        await screen.findByText("No comments yet. Be the first to share what you felt."),
      ).toBeTruthy();
    });

    it("shows the people count, level distribution and first report time", async () => {
      await renderHub(
        makeTransport({
          summary: {
            reports: 14,
            people: 12,
            levels: { 3: 4, 5: 10 },
            firstReportAt: Date.UTC(2026, 9, 4, 10, 30),
            comments: 0,
          },
        }),
      );
      expect(await screen.findByText(/^People reported: .*12/)).toBeTruthy();
      expect(screen.getByTestId("hub-level-3")).toBeTruthy();
      expect(screen.getByTestId("hub-level-5")).toBeTruthy();
      // Once in the summary rows, once in the impact donut's legend.
      expect(screen.getAllByText("Weak shaking")).toHaveLength(2);
      expect(screen.getAllByText("Strong shaking")).toHaveLength(2);
      expect(screen.getByText(/^.{0,2}10.{0,2}$/)).toBeTruthy();
      expect(screen.getByText(/^First report: /)).toBeTruthy();
      expect(screen.queryByText("No reports yet")).toBeNull();
    });

    it("shows the impact donuts under the summary when there are reports", async () => {
      await renderHub(
        makeTransport({
          summary: {
            reports: 14,
            people: 12,
            levels: { 3: 4, 5: 10 },
            firstReportAt: Date.UTC(2026, 9, 4, 10, 30),
            comments: 0,
          },
        }),
      );
      expect(await screen.findByTestId("hub-impact")).toBeTruthy();
      expect(screen.getByTestId("hub-impact-felt")).toBeTruthy();
      // No SHAKEmap/damage product for this event, so no model charts.
      expect(screen.queryByTestId("hub-impact-damage")).toBeNull();
      expect(screen.queryByTestId("hub-impact-people")).toBeNull();
    });

    it("shows no impact section when there is nothing to chart", async () => {
      await renderHub(makeTransport());
      expect(await screen.findByTestId("hub-subtitle")).toBeTruthy();
      expect(screen.queryByTestId("hub-impact")).toBeNull();
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
      // Official mark: the Bumelerze icon, no text beside it.
      expect(screen.getByTestId("role-mark-official-icon")).toBeTruthy();
      // Area from the geohash, as a city, never coordinates.
      expect(screen.getByText("felt it near Slemani")).toBeTruthy();
      // Relative times.
      expect(screen.getByText("5m ago")).toBeTruthy();
      expect(screen.getByText("2h ago")).toBeTruthy();
      // Helpful count is visible to anonymous readers as plain text.
      expect(screen.getByText(/^Helpful: .*3/)).toBeTruthy();
    });

    it("indents replies one level under their thread", async () => {
      await renderHub(makeTransport(data));
      await screen.findByText("First reply");
      const root = screen.getByTestId("comment-root-new");
      const reply = screen.getByTestId("comment-reply-a");
      const flat = (node: { props: { style?: unknown } }) =>
        Object.assign({}, ...[node.props.style].flat(3).filter(Boolean));
      expect(flat(root).marginStart).toBeUndefined();
      expect(flat(reply).marginStart).toBe(24);
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
    it("is told the comment waits for review, with a sign-in link", async () => {
      await renderHub(makeTransport());
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
      expect(screen.getByText("Waiting for review")).toBeTruthy();
      expect(screen.queryByText("Someone else pending")).toBeNull();
      expect(screen.queryByRole("button", { name: "Helpful" })).toBeNull();
      // Own comment can be deleted, others' can be reported.
      expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
      expect(screen.getAllByRole("button", { name: "Report" })).toHaveLength(1);
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

    it("toggles Helpful on someone else's comment, not on their own", async () => {
      const transport = makeTransport({
        comments: [
          buildComment({ id: "theirs", body: "Their note", helpfulCount: 1 }),
          buildComment({ id: "mine", userId: "acct-1", body: "My note" }),
        ],
        helped: ["theirs"],
      });
      await renderHub(transport);
      const helpful = await screen.findByRole("button", { name: /^Helpful: .*1/ });
      expect(helpful.props.accessibilityState.selected).toBe(true);
      // Only one Helpful button: the account's own comment has none.
      expect(screen.queryAllByRole("button", { name: /^Helpful/ })).toHaveLength(1);

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
      const input = await screen.findByTestId("reply-composer-root-1-input");
      expect(input.props.placeholder).toBe("Write a reply");
      await fireEvent.changeText(input, "Yes, strongly");
      await fireEvent.press(screen.getByTestId("reply-composer-root-1-post"));
      await waitFor(() =>
        expect(transport.postComment).toHaveBeenCalledWith({
          eventUuid: "uuid-1",
          parentId: "root-1",
          body: "Yes, strongly",
        }),
      );
      // The reply box closes once posted.
      await waitFor(() =>
        expect(screen.queryByTestId("reply-composer-root-1")).toBeNull(),
      );
    });

    it("reports a comment with a reason", async () => {
      const transport = makeTransport({
        comments: [buildComment({ id: "c-bad", body: "Buy my stuff" })],
      });
      await renderHub(transport);
      await fireEvent.press(await screen.findByRole("button", { name: "Report" }));
      expect(screen.getByText("Why are you reporting this?")).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: "Spam" }));
      await waitFor(() =>
        expect(transport.flagComment).toHaveBeenCalledWith("c-bad", "spam"),
      );
      expect(await screen.findByText("Thanks. We will review it.")).toBeTruthy();
    });

    it("offers 'Withdraw report' for a comment reported earlier, and takes the report back", async () => {
      const transport = makeTransport({
        comments: [buildComment({ id: "c-bad", body: "Buy my stuff" })],
        flagged: ["c-bad"],
      });
      await renderHub(transport);
      expect(await screen.findByText("Thanks. We will review it.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
      await fireEvent.press(screen.getByTestId("withdraw-report-c-bad"));
      await waitFor(() => expect(transport.withdrawFlag).toHaveBeenCalledWith("c-bad"));
      expect(await screen.findByTestId("report-withdrawn-c-bad")).toBeTruthy();
      expect(screen.queryByTestId("withdraw-report-c-bad")).toBeNull();
      // A withdrawn report cannot be raised again (the server keeps the row).
      expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
    });

    it("offers the withdraw button right after reporting", async () => {
      const transport = makeTransport({
        comments: [buildComment({ id: "c-bad", body: "Buy my stuff" })],
      });
      await renderHub(transport);
      await fireEvent.press(await screen.findByRole("button", { name: "Report" }));
      await fireEvent.press(screen.getByRole("button", { name: "Spam" }));
      expect(await screen.findByTestId("withdraw-report-c-bad")).toBeTruthy();
    });

    it("shows no withdraw button on a comment the viewer did not report", async () => {
      await renderHub(
        makeTransport({ comments: [buildComment({ id: "c1", body: "Fine" })] }),
      );
      await screen.findByText("Fine");
      expect(screen.queryByTestId("withdraw-report-c1")).toBeNull();
    });

    it("still shows the thread when the viewer's own reports cannot be read (server without migration 0052)", async () => {
      const transport = makeTransport(
        { comments: [buildComment({ id: "c1", body: "Still here" })] },
        { fetchMyFlags: jest.fn(async () => Promise.reject(new Error("no column"))) },
      );
      await renderHub(transport);
      expect(await screen.findByText("Still here")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Report" })).toBeTruthy();
    });

    it("says the daily report limit is reached instead of a generic error", async () => {
      const transport = makeTransport(
        { comments: [buildComment({ id: "c-bad", body: "Buy my stuff" })] },
        { flagComment: jest.fn(async () => Promise.reject(new HubError("flag_limit"))) },
      );
      await renderHub(transport);
      await fireEvent.press(await screen.findByRole("button", { name: "Report" }));
      await fireEvent.press(screen.getByRole("button", { name: "Spam" }));
      expect(
        await screen.findByText(
          "You've reached today's limit for reports. Try again tomorrow.",
        ),
      ).toBeTruthy();
    });

    it("deletes their own comment at once and offers Undo, which restores it", async () => {
      const transport = makeTransport({
        comments: [buildComment({ id: "mine", userId: "acct-1", body: "Oops" })],
      });
      await renderHub(transport);
      await fireEvent.press(await screen.findByRole("button", { name: "Delete" }));
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
      await fireEvent.press(await screen.findByRole("button", { name: "Helpful" }));
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

      await fireEvent.press(screen.getByRole("button", { name: "Approve" }));
      await waitFor(() =>
        expect(transport.moderateComment).toHaveBeenCalledWith("p1", "approve"),
      );

      await fireEvent.press(screen.getByRole("button", { name: "Hide" }));
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
      await fireEvent.press(await screen.findByRole("button", { name: "Hide" }));
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
      expect(await screen.findByRole("button", { name: "Approve" })).toBeTruthy();
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
