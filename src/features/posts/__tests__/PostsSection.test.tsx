import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";
import { CommunityError, type PublicProfile } from "@/features/community/types";
import i18n from "@/i18n";

import { PostsSection } from "../components/PostsSection";
import { POST_MAX_LENGTH } from "../constants";
import type { PostsTransport } from "../transport";
import { makeFake, post, profileOf } from "../__fixtures__/fake-posts";

let mockAccount: { status: string; userId: string | null } = {
  status: "account",
  userId: "me",
};
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => mockAccount,
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
const mockConfirm = jest.fn();
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: (options: unknown) => mockConfirm(options),
  messageDialog: jest.fn(),
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

function lastConfirm() {
  const options = mockConfirm.mock.calls.at(-1)?.[0] as
    { onConfirm: () => void; destructive?: boolean } | undefined;
  if (!options) {
    throw new Error("no confirm dialog was shown");
  }
  return options;
}

async function renderSection(
  profile: PublicProfile,
  transport: PostsTransport,
  permissions: Permission[] = [],
) {
  const hub = makeTransport({ permissions });
  return renderWithProviders(
    <PostsSection profile={profile} transport={transport} hubTransport={hub} />,
  );
}

describe("PostsSection", () => {
  beforeEach(async () => {
    mockConfirm.mockClear();
    mockAccount = { status: "account", userId: "me" };
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  describe("the list on anyone's profile", () => {
    it("shows visible posts newest first with relative time and no composer", async () => {
      const fake = makeFake([post("old", 90), post("new", 5)], 5);
      await renderSection(profileOf(), fake);
      expect(await screen.findByTestId("post-new")).toBeTruthy();
      const bodies = screen
        .getAllByTestId(/^post-body-/)
        .map((node) => node.props.children);
      expect(bodies).toEqual(["text of new", "text of old"]);
      expect(screen.getByText("Posts")).toBeTruthy();
      expect(
        screen.getByText(i18n.t("events.relativeTime.minutes", { value: "5" })),
      ).toBeTruthy();
      expect(screen.queryByTestId("post-composer")).toBeNull();
      expect(fake.fetchPosts).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "author", includeRemoved: false }),
      );
    });

    it("says so when there are no posts", async () => {
      await renderSection(profileOf(), makeFake([]));
      expect(await screen.findByTestId("posts-empty")).toBeTruthy();
    });

    it("loads older posts with 'Show more' and hides the button on the last page", async () => {
      const fake = makeFake([post("a", 1), post("b", 2), post("c", 3), post("d", 4)]);
      await renderSection(profileOf(), fake);
      expect(await screen.findByTestId("post-a")).toBeTruthy();
      expect(screen.queryByTestId("post-c")).toBeNull();
      await fireEvent.press(screen.getByTestId("posts-load-more"));
      expect(await screen.findByTestId("post-c")).toBeTruthy();
      expect(screen.getByTestId("post-d")).toBeTruthy();
      expect(screen.queryByTestId("posts-load-more")).toBeNull();
      expect(fake.fetchPosts).toHaveBeenCalledTimes(2);
      expect(fake.fetchPosts.mock.calls[1]?.[0]).toMatchObject({
        before: expect.any(String),
      });
    });

    it("lets mixed-language text align to its own direction", async () => {
      await renderSection(
        profileOf(),
        makeFake([post("mix", 1, { body: "سڵاو hello زەوی" })]),
      );
      const body = await screen.findByTestId("post-body-mix");
      expect(body.props.style.textAlign).toBe("auto");
    });
  });

  describe("private accounts", () => {
    it("tells a non-follower that posts are for followers and loads nothing", async () => {
      const fake = makeFake([post("secret", 1)]);
      await renderSection(
        profileOf({ is_private: true, can_view_full: false, follow_status: "none" }),
        fake,
      );
      expect(screen.getByTestId("posts-gate")).toBeTruthy();
      expect(screen.getByText("Posts are visible to followers.")).toBeTruthy();
      expect(screen.queryByTestId("posts-section")).toBeNull();
      expect(fake.fetchPosts).not.toHaveBeenCalled();
      expect(screen.queryByText("text of secret")).toBeNull();
    });

    it("gives a pending requester the same gate", async () => {
      const fake = makeFake([post("secret", 1)]);
      await renderSection(
        profileOf({ is_private: true, can_view_full: false, follow_status: "pending" }),
        fake,
      );
      expect(screen.getByTestId("posts-gate")).toBeTruthy();
      expect(fake.fetchPosts).not.toHaveBeenCalled();
    });

    it("shows an accepted follower the list", async () => {
      const fake = makeFake([post("secret", 1)]);
      await renderSection(
        profileOf({ is_private: true, can_view_full: true, follow_status: "accepted" }),
        fake,
      );
      expect(await screen.findByText("text of secret")).toBeTruthy();
      expect(screen.queryByTestId("posts-gate")).toBeNull();
    });

    it("shows nothing at all for a blocked profile", async () => {
      const fake = makeFake([post("x", 1)]);
      await renderSection(
        profileOf({ is_blocked: true, can_view_full: false, is_private: true }),
        fake,
      );
      expect(screen.queryByTestId("posts-gate")).toBeNull();
      expect(screen.queryByTestId("posts-section")).toBeNull();
      expect(fake.fetchPosts).not.toHaveBeenCalled();
    });
  });

  describe("own profile: composer", () => {
    const own = () => profileOf({ is_self: true, user_id: "me" });

    it("keeps Post off for empty or whitespace text and shows a live counter", async () => {
      await renderSection(own(), makeFake([]));
      const input = await screen.findByTestId("post-composer-input");
      const button = screen.getByTestId("post-composer-post");
      expect(button.props.accessibilityState.disabled).toBe(true);
      expect(screen.getByTestId("post-composer-counter").props.children).toContain(
        "0/500",
      );

      await fireEvent.changeText(input, "   ");
      expect(
        screen.getByTestId("post-composer-post").props.accessibilityState.disabled,
      ).toBe(true);

      await fireEvent.changeText(input, "hello");
      expect(
        screen.getByTestId("post-composer-post").props.accessibilityState.disabled,
      ).toBe(false);
      expect(screen.getByTestId("post-composer-counter").props.children).toContain(
        "5/500",
      );
    });

    it("blocks text over 500 characters and says so", async () => {
      await renderSection(own(), makeFake([]));
      const input = await screen.findByTestId("post-composer-input");
      await fireEvent.changeText(input, "x".repeat(POST_MAX_LENGTH));
      expect(
        screen.getByTestId("post-composer-post").props.accessibilityState.disabled,
      ).toBe(false);
      expect(screen.queryByTestId("post-composer-too-long")).toBeNull();

      await fireEvent.changeText(input, "x".repeat(POST_MAX_LENGTH + 1));
      expect(
        screen.getByTestId("post-composer-post").props.accessibilityState.disabled,
      ).toBe(true);
      expect(screen.getByTestId("post-composer-too-long")).toBeTruthy();
      expect(screen.getByTestId("post-composer-counter").props.children).toContain(
        "501/500",
      );
    });

    it("posts the trimmed text, clears the box and shows it at the top", async () => {
      const fake = makeFake([post("older", 30, { userId: "me" })]);
      await renderSection(own(), fake);
      const input = await screen.findByTestId("post-composer-input");
      await fireEvent.changeText(input, "  my new post  ");
      await fireEvent.press(screen.getByTestId("post-composer-post"));
      await waitFor(() =>
        expect(fake.createPost).toHaveBeenCalledWith("me", "my new post"),
      );
      await waitFor(() =>
        expect(screen.getByTestId("post-composer-input").props.value).toBe(""),
      );
      await waitFor(() => {
        const bodies = screen.getAllByTestId(/^post-body-/).map((n) => n.props.children);
        expect(bodies).toEqual(["my new post", "text of older"]);
      });
    });

    it("keeps the text and shows a message when posting fails", async () => {
      const fake = makeFake([]);
      fake.createPost.mockRejectedValueOnce(new CommunityError("rate_limited"));
      await renderSection(own(), fake);
      const input = await screen.findByTestId("post-composer-input");
      await fireEvent.changeText(input, "will fail");
      await fireEvent.press(screen.getByTestId("post-composer-post"));
      expect(await screen.findByTestId("post-composer-error")).toBeTruthy();
      expect(screen.getByText("Too many tries. Wait a bit.")).toBeTruthy();
      expect(screen.getByTestId("post-composer-input").props.value).toBe("will fail");
    });

    it("asks for the author's removed posts too and shows 'Removed by moderators'", async () => {
      const fake = makeFake([
        post("gone", 10, { userId: "me", status: "removed", body: "" }),
        post("fine", 20, { userId: "me" }),
      ]);
      await renderSection(own(), fake);
      expect(await screen.findByTestId("post-removed-gone")).toBeTruthy();
      expect(screen.getByText("Removed by moderators")).toBeTruthy();
      expect(fake.fetchPosts).toHaveBeenCalledWith(
        expect.objectContaining({ includeRemoved: true }),
      );
    });

    it("deletes an own post at once, with no confirmation, and offers Undo", async () => {
      const fake = makeFake([
        post("mine", 3, { userId: "me" }),
        post("also", 4, { userId: "me" }),
      ]);
      await renderSection(own(), fake);
      await fireEvent.press(await screen.findByTestId("post-delete-mine"));
      expect(mockConfirm).not.toHaveBeenCalled();
      await waitFor(() => expect(fake.deletePost).toHaveBeenCalledWith("mine"));
      await waitFor(() => expect(screen.queryByTestId("post-mine")).toBeNull());
      expect(screen.getByTestId("post-also")).toBeTruthy();
      expect(await screen.findByTestId("snackbar-message")).toHaveTextContent(
        "Post deleted",
      );
      expect(fake.restorePost).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId("snackbar-action"));
      await waitFor(() => expect(fake.restorePost).toHaveBeenCalledWith("mine"));
    });

    it("offers no Delete on a post an admin removed (the author cannot delete evidence)", async () => {
      const fake = makeFake([post("gone", 10, { userId: "me", status: "removed" })]);
      await renderSection(own(), fake);
      expect(await screen.findByTestId("post-removed-gone")).toBeTruthy();
      expect(screen.queryByTestId("post-delete-gone")).toBeNull();
    });

    it("offers no Report or Remove on one's own posts", async () => {
      await renderSection(own(), makeFake([post("mine", 3, { userId: "me" })]), [
        "posts.delete",
      ]);
      await screen.findByTestId("post-mine");
      expect(screen.queryByTestId("post-report-mine")).toBeNull();
      expect(screen.queryByTestId("post-remove-mine")).toBeNull();
    });
  });

  describe("reporting someone else's post", () => {
    it("asks for a reason, sends it, and thanks the reader", async () => {
      const fake = makeFake([post("p1", 2)]);
      await renderSection(profileOf(), fake);
      await fireEvent.press(await screen.findByTestId("post-report-p1"));
      expect(screen.getByText("Report this post")).toBeTruthy();
      await fireEvent.press(screen.getByTestId("post-report-sheet-p1-reason-spam"));
      await fireEvent.changeText(
        screen.getByTestId("post-report-sheet-p1-note"),
        "ad for a shop",
      );
      await fireEvent.press(screen.getByTestId("post-report-sheet-p1-submit"));
      await waitFor(() =>
        expect(fake.reportPost).toHaveBeenCalledWith("p1", "spam", "ad for a shop"),
      );
      expect(await screen.findByTestId("post-reported-p1")).toBeTruthy();
      expect(screen.queryByTestId("post-report-p1")).toBeNull();
    });

    it("offers the shared reasons (impersonation is for profiles only)", async () => {
      await renderSection(profileOf(), makeFake([post("p1", 2)]));
      await fireEvent.press(await screen.findByTestId("post-report-p1"));
      for (const reason of [
        "spam",
        "abuse_harassment",
        "rumour_prediction",
        "private_info",
        "sexual_violent",
        "other",
      ]) {
        expect(screen.getByTestId(`post-report-sheet-p1-reason-${reason}`)).toBeTruthy();
      }
      expect(
        screen.queryByTestId("post-report-sheet-p1-reason-impersonation"),
      ).toBeNull();
      expect(screen.getByText("Fake earthquake prediction or rumour")).toBeTruthy();
    });

    it("can be cancelled without sending anything", async () => {
      const fake = makeFake([post("p1", 2)]);
      await renderSection(profileOf(), fake);
      await fireEvent.press(await screen.findByTestId("post-report-p1"));
      await fireEvent.press(screen.getByTestId("post-report-sheet-p1-close"));
      expect(screen.queryByTestId("post-report-sheet-p1")).toBeNull();
      expect(fake.reportPost).not.toHaveBeenCalled();
    });

    it("shows no Report to someone without any session", async () => {
      mockAccount = { status: "anonymous", userId: null };
      await renderSection(profileOf(), makeFake([post("p1", 2)]));
      await screen.findByTestId("post-p1");
      expect(screen.queryByTestId("post-report-p1")).toBeNull();
    });
  });

  describe("admin removal", () => {
    it("offers Remove with a reason and a confirmation to an official", async () => {
      const fake = makeFake([post("p1", 2)]);
      await renderSection(profileOf(), fake, ["posts.delete"]);
      await fireEvent.press(await screen.findByTestId("post-remove-p1"));
      await fireEvent.press(screen.getByTestId("remove-reason-abuse"));
      expect(mockConfirm).toHaveBeenCalledTimes(1);
      expect(fake.adminRemovePost).not.toHaveBeenCalled();
      await act(async () => {
        lastConfirm().onConfirm();
      });
      await waitFor(() =>
        expect(fake.adminRemovePost).toHaveBeenCalledWith("p1", "abuse"),
      );
    });

    it("gives a moderator (comments.moderate only) no Remove", async () => {
      await renderSection(profileOf(), makeFake([post("p1", 2)]), ["comments.moderate"]);
      await screen.findByTestId("post-p1");
      expect(screen.queryByTestId("post-remove-p1")).toBeNull();
    });

    it("gives an ordinary reader no Remove", async () => {
      await renderSection(profileOf(), makeFake([post("p1", 2)]), []);
      await screen.findByTestId("post-p1");
      expect(screen.queryByTestId("post-remove-p1")).toBeNull();
    });

    it("gives no Remove when the server predates my_permissions", async () => {
      const hub = makeTransport({});
      hub.fetchRoles.mockResolvedValue({ me: [{ role: "official", orgName: null }] });
      await renderWithProviders(
        <PostsSection
          profile={profileOf()}
          transport={makeFake([post("p1", 2)])}
          hubTransport={hub}
        />,
      );
      await screen.findByTestId("post-p1");
      expect(screen.queryByTestId("post-remove-p1")).toBeNull();
    });
  });

  describe("before migration 0050 is applied", () => {
    it("hides the whole section, composer included, with no error text", async () => {
      const fake = makeFake([]);
      fake.fetchPosts.mockRejectedValue(new CommunityError("unavailable"));
      await renderSection(profileOf({ is_self: true, user_id: "me" }), fake);
      await waitFor(() => expect(fake.fetchPosts).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByTestId("posts-section")).toBeNull());
      expect(screen.queryByTestId("post-composer")).toBeNull();
      expect(screen.queryByTestId("posts-error")).toBeNull();
      expect(screen.queryByText("Posts")).toBeNull();
    });

    it("shows a retry, not a crash, for an ordinary failure", async () => {
      const fake = makeFake([]);
      fake.fetchPosts.mockRejectedValueOnce(new CommunityError("network"));
      fake.fetchPosts.mockRejectedValueOnce(new CommunityError("network"));
      await renderSection(profileOf(), fake);
      expect(
        await screen.findByTestId("posts-error", {}, { timeout: 4000 }),
      ).toBeTruthy();
      expect(screen.getByText("Couldn't load posts.")).toBeTruthy();
    });
  });

  describe("in Sorani (right to left)", () => {
    beforeEach(async () => {
      await i18n.changeLanguage("ckb");
    });
    afterEach(async () => {
      cleanup();
      await i18n.changeLanguage("en");
    });

    it("renders the section, the posts and the composer in Sorani with Eastern Arabic digits", async () => {
      const fake = makeFake([post("k", 5, { userId: "me", body: "ئەمڕۆ زەوی لەرزی" })]);
      await renderSection(profileOf({ is_self: true, user_id: "me" }), fake);
      expect(await screen.findByText("ئەمڕۆ زەوی لەرزی")).toBeTruthy();
      expect(screen.getByText("پۆستەکان")).toBeTruthy();
      expect(screen.getByTestId("post-composer-input").props.placeholder).toBe(
        "پۆستێک بنووسە",
      );
      expect(screen.getByTestId("post-composer-post")).toBeTruthy();
      expect(screen.getByText("سڕینەوە")).toBeTruthy();
      expect(screen.getByTestId("post-composer-counter").props.children).toContain(
        "٠/٥٠٠",
      );
      expect(screen.getByTestId("post-body-k").props.style.textAlign).toBe("auto");
      // no Latin brand name or placeholder leaks into the Arabic-script UI
      expect(JSON.stringify(screen.toJSON())).not.toMatch(/Bumelerze|\{\{/);
    });

    it("words the private gate in Sorani", async () => {
      await renderSection(
        profileOf({ is_private: true, can_view_full: false }),
        makeFake([]),
      );
      expect(screen.getByText("پۆستەکان بۆ شوێنکەوتووان دیارن.")).toBeTruthy();
    });
  });
});
