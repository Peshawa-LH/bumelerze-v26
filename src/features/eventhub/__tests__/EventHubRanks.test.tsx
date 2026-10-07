import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";

import { EventHubContent } from "../components/EventHubContent";
import {
  buildComment,
  buildEvent,
  makeTransport,
  renderWithProviders,
} from "../__fixtures__/testing";

const mockPush = jest.fn();
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  const { useEffect } = require("react");
  return {
    useRouter: () => ({ push: mockPush }),
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
  status: "account",
  userId: "acct-1",
};
jest.mock("@/features/account", () => ({
  ...jest.requireActual("@/features/account"),
  useAccount: () => mockAccount,
}));

const mockConfirm = jest.fn();
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: (options: unknown) => mockConfirm(options),
  messageDialog: jest.fn(),
}));

async function renderHub(transport: ReturnType<typeof makeTransport>) {
  await renderWithProviders(
    <EventHubContent event={buildEvent()} transport={transport} />,
  );
}

describe("Event hub: ranks, removal, profiles and follows", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    mockConfirm.mockClear();
    mockAccount = { status: "account", userId: "acct-1" };
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  describe("admin removal (comments.delete)", () => {
    const visible = buildComment({ id: "c1", userId: "u-other", body: "Rude words" });

    it("lets an admin pick a reason, confirm, and soft-delete through the RPC", async () => {
      mockAccount = { status: "account", userId: "admin-1" };
      const transport = makeTransport({
        comments: [visible],
        roles: { "admin-1": [{ role: "official", orgName: null }] },
        permissions: [
          "comments.moderate",
          "comments.delete",
          "badges.grant",
          "hubs.feature",
        ],
      });
      await renderHub(transport);
      await fireEvent.press(await screen.findByTestId("remove-c1"));
      await fireEvent.press(await screen.findByTestId("remove-reason-abuse"));

      expect(mockConfirm).toHaveBeenCalledTimes(1);
      const options = mockConfirm.mock.calls[0]?.[0] as {
        destructive: boolean;
        onConfirm: () => void;
      };
      expect(options.destructive).toBe(true);
      expect(transport.adminDeleteComment).not.toHaveBeenCalled(); // nothing before the confirm
      options.onConfirm();
      await waitFor(() =>
        expect(transport.adminDeleteComment).toHaveBeenCalledWith("c1", "abuse"),
      );
    });

    it("shows no Remove to a moderator, who keeps Approve and Hide", async () => {
      mockAccount = { status: "account", userId: "mod-1" };
      await renderHub(
        makeTransport({
          comments: [
            visible,
            buildComment({ id: "p1", status: "pending", body: "Wait" }),
          ],
          roles: { "mod-1": [{ role: "moderator", orgName: null }] },
          permissions: ["comments.moderate"],
        }),
      );
      expect(await screen.findByRole("button", { name: "Approve" })).toBeTruthy();
      expect(screen.queryByTestId("remove-c1")).toBeNull();
    });

    it("shows no Remove to an ordinary account", async () => {
      await renderHub(makeTransport({ comments: [visible], permissions: [] }));
      await screen.findByText("Rude words");
      expect(screen.queryByTestId("remove-c1")).toBeNull();
    });

    it("keeps moderators working but gives no Remove when the server has no my_permissions yet", async () => {
      mockAccount = { status: "account", userId: "off-1" };
      await renderHub(
        makeTransport({
          comments: [
            visible,
            buildComment({ id: "p1", status: "pending", body: "Wait" }),
          ],
          roles: { "off-1": [{ role: "official", orgName: null }] },
        }),
      );
      expect(await screen.findByRole("button", { name: "Approve" })).toBeTruthy();
      expect(screen.queryByTestId("remove-c1")).toBeNull();
    });

    it("does not offer Remove on the admin's own comment (they have Delete)", async () => {
      mockAccount = { status: "account", userId: "admin-1" };
      await renderHub(
        makeTransport({
          comments: [buildComment({ id: "own", userId: "admin-1", body: "Mine" })],
          permissions: ["comments.moderate", "comments.delete"],
        }),
      );
      await screen.findByText("Mine");
      expect(screen.queryByTestId("remove-own")).toBeNull();
    });
  });

  describe("removed comments", () => {
    it("shows a 'Comment removed' placeholder with no author or text, and keeps the replies", async () => {
      await renderHub(
        makeTransport({
          comments: [
            buildComment({ id: "root", status: "removed", body: "", userId: "u-bad" }),
            buildComment({
              id: "reply",
              parentId: "root",
              userId: "u-ok",
              body: "I agree with the point",
              createdAt: Date.now() - 60_000,
            }),
          ],
          authors: {
            "u-bad": { displayName: "Bad Actor" },
            "u-ok": { displayName: "Dilan" },
          },
        }),
      );
      expect(await screen.findByText("Comment removed")).toBeTruthy();
      expect(screen.getByText("I agree with the point")).toBeTruthy();
      expect(screen.queryByText("Bad Actor")).toBeNull();
      // a placeholder has no actions
      expect(screen.queryByTestId("remove-root")).toBeNull();
    });
  });

  describe("profile links", () => {
    it("opens the public profile from the name and from the photo", async () => {
      await renderHub(
        makeTransport({
          comments: [buildComment({ id: "c1", userId: "u-1" })],
          authors: { "u-1": { displayName: "Dilan", username: "dilan.k" } },
        }),
      );
      await fireEvent.press(await screen.findByTestId("comment-name-link-c1"));
      expect(mockPush).toHaveBeenLastCalledWith("/u/dilan.k");
      await fireEvent.press(screen.getByTestId("comment-avatar-link-c1"));
      expect(mockPush).toHaveBeenCalledTimes(2);
    });

    it("shows a plain name when the author has not chosen a username", async () => {
      await renderHub(
        makeTransport({
          comments: [buildComment({ id: "c1", userId: "u-1" })],
          authors: { "u-1": { displayName: "Dilan" } },
        }),
      );
      await screen.findByText("Dilan");
      expect(screen.queryByTestId("comment-name-link-c1")).toBeNull();
      expect(screen.queryByTestId("comment-avatar-link-c1")).toBeNull();
    });
  });

  describe("people you follow", () => {
    it("lists their threads first and marks them 'Following'", async () => {
      await renderHub(
        makeTransport({
          comments: [
            buildComment({
              id: "new",
              userId: "u-stranger",
              body: "Newest",
              createdAt: Date.now() - 1_000,
            }),
            buildComment({
              id: "old",
              userId: "u-friend",
              body: "Older",
              createdAt: Date.now() - 600_000,
            }),
          ],
          authors: {
            "u-friend": { displayName: "Friend" },
            "u-stranger": { displayName: "Stranger" },
          },
          following: ["u-friend"],
        }),
      );
      await screen.findByText("Older");
      const list = screen.getByTestId("hub-list");
      const order = list.props.data.map(
        (thread: { root: { id: string } }) => thread.root.id,
      );
      expect(order).toEqual(["old", "new"]);
      expect(screen.getByTestId("comment-following-old")).toBeTruthy();
      expect(screen.queryByTestId("comment-following-new")).toBeNull();
    });
  });
});
