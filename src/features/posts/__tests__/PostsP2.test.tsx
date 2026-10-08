import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import { CommunityError, type PublicProfile } from "@/features/community/types";
import { isolateNumeric } from "@/features/events/format";
import i18n from "@/i18n";

import { PostsSection } from "../components/PostsSection";
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
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: jest.fn(),
  messageDialog: jest.fn(),
}));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

async function renderSection(profile: PublicProfile, transport: PostsTransport) {
  return renderWithProviders(
    <PostsSection
      profile={profile}
      transport={transport}
      hubTransport={makeTransport()}
    />,
  );
}

/** "Helpful: N" exactly as shown (the number is wrapped in direction isolates). */
const helpful = (n: number) =>
  i18n.t("posts.helpfulCount", { number: isolateNumeric(String(n)) });

const own = (extra: Record<string, unknown> = {}) =>
  profileOf({ is_self: true, user_id: "me", ...extra });

describe("profile posts P2", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    mockAccount = { status: "account", userId: "me" };
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  describe("edit with an 'edited' mark", () => {
    it("edits my post, sends the trimmed text and shows the edited mark", async () => {
      const fake = makeFake([post("mine", 30, { userId: "me", body: "typo hre" })]);
      await renderSection(own(), fake);
      await fireEvent.press(await screen.findByTestId("post-edit-mine"));
      const input = screen.getByTestId("post-edit-input-mine");
      expect(input.props.value).toBe("typo hre");
      await fireEvent.changeText(input, "  typo here  ");
      await fireEvent.press(screen.getByTestId("post-edit-save-mine"));
      await waitFor(() =>
        expect(fake.editPost).toHaveBeenCalledWith("mine", "typo here"),
      );
      expect(await screen.findByTestId("post-edited-mine")).toBeTruthy();
      expect(screen.getByTestId("post-body-mine").props.children).toBe("typo here");
    });

    it("shows 'Edited' with the time of the last edit", async () => {
      const at = Date.now() - 3 * 60_000;
      await renderSection(profileOf(), makeFake([post("p", 60, { editedAt: at })]));
      const mark = await screen.findByTestId("post-edited-p");
      expect(mark.props.children).toContain(
        i18n.t("posts.edited", {
          time: i18n.t("events.relativeTime.minutes", { value: "3" }),
        }),
      );
    });

    it("is locked while the post is reported: no editor, a calm note, no call", async () => {
      const fake = makeFake([post("mine", 5, { userId: "me", editLocked: true })]);
      await renderSection(own(), fake);
      await fireEvent.press(await screen.findByTestId("post-edit-mine"));
      expect(screen.queryByTestId("post-edit-input-mine")).toBeNull();
      expect(screen.getByTestId("post-edit-locked-mine")).toHaveTextContent(
        i18n.t("posts.editLocked"),
      );
      expect(fake.editPost).not.toHaveBeenCalled();
    });

    it("words the server's lock when a report arrived after the page loaded", async () => {
      const fake = makeFake([post("mine", 5, { userId: "me" })]);
      fake.editPost.mockRejectedValueOnce(new CommunityError("edit_locked"));
      await renderSection(own(), fake);
      await fireEvent.press(await screen.findByTestId("post-edit-mine"));
      await fireEvent.changeText(screen.getByTestId("post-edit-input-mine"), "bait");
      await fireEvent.press(screen.getByTestId("post-edit-save-mine"));
      expect(await screen.findByTestId("post-error-mine")).toHaveTextContent(
        i18n.t("community.errors.edit_locked"),
      );
      // the editor stays open with the text
      expect(screen.getByTestId("post-edit-input-mine").props.value).toBe("bait");
    });

    it("keeps Save off for an empty text post and over the limit", async () => {
      await renderSection(own(), makeFake([post("mine", 5, { userId: "me" })]));
      await fireEvent.press(await screen.findByTestId("post-edit-mine"));
      await fireEvent.changeText(screen.getByTestId("post-edit-input-mine"), "  ");
      expect(
        screen.getByTestId("post-edit-save-mine").props.accessibilityState.disabled,
      ).toBe(true);
      await fireEvent.changeText(
        screen.getByTestId("post-edit-input-mine"),
        "x".repeat(501),
      );
      expect(
        screen.getByTestId("post-edit-save-mine").props.accessibilityState.disabled,
      ).toBe(true);
    });

    it("offers no Edit on someone else's post", async () => {
      await renderSection(profileOf(), makeFake([post("theirs", 5)]));
      await screen.findByTestId("post-theirs");
      expect(screen.queryByTestId("post-edit-theirs")).toBeNull();
    });

    it("offers no Edit or Pin on a removed post", async () => {
      await renderSection(
        own(),
        makeFake([post("gone", 5, { userId: "me", status: "removed", body: "" })]),
      );
      await screen.findByTestId("post-removed-gone");
      expect(screen.queryByTestId("post-edit-gone")).toBeNull();
      expect(screen.queryByTestId("post-pin-gone")).toBeNull();
    });
  });

  describe("Helpful (no likes)", () => {
    it("toggles my mark and shows the server's count", async () => {
      const fake = makeFake([post("p", 5, { helpfulCount: 2 })]);
      await renderSection(profileOf(), fake);
      const button = await screen.findByTestId("post-helpful-p");
      expect(button).toHaveTextContent(helpful(2));
      expect(button.props.accessibilityState.selected).toBe(false);
      await fireEvent.press(button);
      await waitFor(() => expect(fake.setHelpful).toHaveBeenCalledWith("p", true));
      await waitFor(() =>
        expect(screen.getByTestId("post-helpful-p")).toHaveTextContent(helpful(3)),
      );
      expect(screen.getByTestId("post-helpful-p").props.accessibilityState.selected).toBe(
        true,
      );
      await fireEvent.press(screen.getByTestId("post-helpful-p"));
      await waitFor(() => expect(fake.setHelpful).toHaveBeenLastCalledWith("p", false));
      await waitFor(() =>
        expect(screen.getByTestId("post-helpful-p")).toHaveTextContent(helpful(2)),
      );
    });

    it("guests cannot mark; they only read the count", async () => {
      mockAccount = { status: "anonymous", userId: "guest" };
      await renderSection(profileOf(), makeFake([post("p", 5, { helpfulCount: 4 })]));
      await screen.findByTestId("post-p");
      expect(screen.queryByTestId("post-helpful-p")).toBeNull();
      expect(screen.getByTestId("post-helpful-count-p")).toHaveTextContent(helpful(4));
    });

    it("is not offered on my own post (the count still shows)", async () => {
      await renderSection(
        own(),
        makeFake([post("mine", 5, { userId: "me", helpfulCount: 1 })]),
      );
      await screen.findByTestId("post-mine");
      expect(screen.queryByTestId("post-helpful-mine")).toBeNull();
      expect(screen.getByTestId("post-helpful-count-mine")).toHaveTextContent(helpful(1));
    });

    it("says so when the account is limited", async () => {
      const fake = makeFake([post("p", 5)]);
      fake.setHelpful.mockRejectedValueOnce(new CommunityError("restricted"));
      await renderSection(profileOf(), fake);
      await fireEvent.press(await screen.findByTestId("post-helpful-p"));
      expect(await screen.findByTestId("post-error-p")).toHaveTextContent(
        i18n.t("community.errors.restricted"),
      );
    });
  });

  describe("pinned post", () => {
    it("shows the pinned post first, once, with a 'Pinned' line", async () => {
      const fake = makeFake([post("new", 1), post("old", 300), post("mid", 30)], 5);
      await renderSection(profileOf({ pinned_post_id: "old" }), fake);
      expect(await screen.findByTestId("post-pinned-old")).toBeTruthy();
      await waitFor(() => {
        const ids = screen.getAllByTestId(/^post-body-/).map((n) => n.props.testID);
        expect(ids).toEqual(["post-body-old", "post-body-new", "post-body-mid"]);
      });
      expect(fake.fetchPost).toHaveBeenCalledWith("author", "old");
    });

    it("pins my own post", async () => {
      const fake = makeFake(
        [post("a", 1, { userId: "me" }), post("b", 2, { userId: "me" })],
        5,
      );
      await renderSection(own(), fake);
      const pin = await screen.findByTestId("post-pin-b");
      expect(pin).toHaveTextContent(i18n.t("posts.pin"));
      await fireEvent.press(pin);
      await waitFor(() => expect(fake.setPinned).toHaveBeenCalledWith("b"));
    });

    it("unpins my pinned post", async () => {
      const fake = makeFake(
        [post("a", 1, { userId: "me" }), post("b", 2, { userId: "me" })],
        5,
      );
      await renderSection(own({ pinned_post_id: "b" }), fake);
      await screen.findByTestId("post-pinned-b");
      const unpin = screen.getByTestId("post-pin-b");
      expect(unpin).toHaveTextContent(i18n.t("posts.unpin"));
      await fireEvent.press(unpin);
      await waitFor(() => expect(fake.setPinned).toHaveBeenLastCalledWith(null));
    });

    it("offers no Pin on someone else's posts", async () => {
      await renderSection(profileOf(), makeFake([post("x", 1)]));
      await screen.findByTestId("post-x");
      expect(screen.queryByTestId("post-pin-x")).toBeNull();
    });
  });

  describe("an earthquake shared to a profile", () => {
    const eventPost = (id: string, ref: string | null, body = "") =>
      post(id, 10, {
        kind: "event",
        body,
        event: {
          ref,
          magnitude: 5.1,
          lat: 35.18,
          lon: 45.98,
          time: Date.UTC(2026, 9, 1, 3),
        },
      });

    it("renders a card (magnitude, our place line, time) and opens the event", async () => {
      await renderSection(
        profileOf(),
        makeFake([eventPost("e1", "bml2026abc", "I felt it")]),
      );
      const card = await screen.findByTestId("post-event-e1");
      expect(screen.getByTestId("post-event-e1-magnitude")).toHaveTextContent("M 5.1");
      expect(screen.getByTestId("post-event-e1-place").props.children).toBeTruthy();
      expect(screen.getByTestId("post-event-e1-time").props.children).toBeTruthy();
      expect(screen.getByTestId("post-body-e1").props.children).toBe("I felt it");
      await fireEvent.press(card);
      expect(mockPush).toHaveBeenCalledWith("/event/bml2026abc");
    });

    it("shows no empty text line when the share has no words", async () => {
      await renderSection(profileOf(), makeFake([eventPost("e2", "bml2026abc")]));
      await screen.findByTestId("post-event-e2");
      expect(screen.queryByTestId("post-body-e2")).toBeNull();
    });

    it("an earthquake no longer listed reads as a note and opens nothing", async () => {
      await renderSection(profileOf(), makeFake([eventPost("e3", null)]));
      expect(await screen.findByTestId("post-event-e3-gone")).toHaveTextContent(
        i18n.t("posts.event.unavailable"),
      );
      await act(async () => {
        fireEvent.press(screen.getByTestId("post-event-e3"));
      });
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("an event post's text may be edited up to 280 and may be emptied", async () => {
      const fake = makeFake([
        { ...eventPost("e4", "bml2026abc", "words"), userId: "me" },
      ]);
      await renderSection(own(), fake);
      await fireEvent.press(await screen.findByTestId("post-edit-e4"));
      await fireEvent.changeText(screen.getByTestId("post-edit-input-e4"), "");
      expect(
        screen.getByTestId("post-edit-save-e4").props.accessibilityState.disabled,
      ).toBe(false);
      await fireEvent.changeText(
        screen.getByTestId("post-edit-input-e4"),
        "y".repeat(281),
      );
      expect(
        screen.getByTestId("post-edit-save-e4").props.accessibilityState.disabled,
      ).toBe(true);
      expect(screen.getByTestId("post-edit-counter-e4").props.children).toContain(
        "281/280",
      );
    });
  });

  it("works right to left in Sorani (labels translated, text follows its own direction)", async () => {
    await i18n.changeLanguage("ckb");
    await renderSection(
      profileOf(),
      makeFake([post("p", 5, { helpfulCount: 2, body: "سڵاو" })]),
    );
    expect(await screen.findByTestId("post-helpful-p")).toHaveTextContent(/سوودبەخش/);
    expect(screen.getByTestId("post-body-p").props.style.textAlign).toBe("auto");
    await i18n.changeLanguage("en");
  });
});
