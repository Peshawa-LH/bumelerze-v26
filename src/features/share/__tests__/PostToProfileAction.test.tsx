import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { CommunityError } from "@/features/community/types";
import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import { makeFake } from "@/features/posts/__fixtures__/fake-posts";
import i18n from "@/i18n";

import { PostToProfileAction } from "../PostToProfileAction";

let mockAccount: {
  status: string;
  userId: string | null;
  profile: { username: string | null } | null;
} = { status: "account", userId: "me", profile: { username: "shilan" } };
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => mockAccount,
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

const CAPTION =
  "M5.1 earthquake · Halabja · 1 Oct 06:00 · https://bumelerze.com/e/x #Bumelerze";

async function renderAction(
  eventRef: string | null = "bml2026abc",
  fake = makeFake([]),
  caption = CAPTION,
  guidelines = { accept: jest.fn(async () => undefined) },
) {
  await renderWithProviders(
    <PostToProfileAction
      eventRef={eventRef}
      caption={caption}
      transport={fake}
      guidelinesTransport={guidelines}
    />,
  );
  return { fake, guidelines };
}

describe("Post to my profile, in the share sheet (review notes 2.1, 4.2)", () => {
  beforeEach(async () => {
    mockAccount = { status: "account", userId: "me", profile: { username: "shilan" } };
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("is hidden for a guest", async () => {
    mockAccount = { status: "anonymous", userId: "g", profile: null };
    await renderAction();
    expect(screen.queryByTestId("share-post-profile")).toBeNull();
  });

  it("is hidden for an account without a @username (no public profile to post on)", async () => {
    mockAccount = { status: "account", userId: "me", profile: { username: null } };
    await renderAction();
    expect(screen.queryByTestId("share-post-profile")).toBeNull();
  });

  it("is hidden until the event's id is known", async () => {
    await renderAction(null);
    expect(screen.queryByTestId("share-post-profile")).toBeNull();
  });

  it("posts the event with the sheet's caption, never a location, and says so", async () => {
    const { fake } = await renderAction("bml2026abc", makeFake([]), `  ${CAPTION}  `);
    expect(screen.getByTestId("share-post-profile")).toHaveTextContent(
      /Post to my profile/,
    );
    await fireEvent.press(screen.getByTestId("share-post-profile"));
    await waitFor(() =>
      expect(fake.shareEvent).toHaveBeenCalledWith("bml2026abc", CAPTION),
    );
    // only the event reference and the text: the transport has no place for a location
    expect(fake.shareEvent.mock.calls[0]).toHaveLength(2);
    expect(await screen.findByTestId("share-post-profile-done")).toHaveTextContent(
      i18n.t("share.postedToProfile"),
    );
    // posted once: the option is now done
    expect(
      screen.getByTestId("share-post-profile").props.accessibilityState.disabled,
    ).toBe(true);
  });

  it("refuses a caption over 280 characters without calling the server", async () => {
    const { fake } = await renderAction("bml2026abc", makeFake([]), "z".repeat(281));
    await fireEvent.press(screen.getByTestId("share-post-profile"));
    expect(screen.getByTestId("share-post-profile-error")).toHaveTextContent(
      "Too long. The limit is 280 characters.",
    );
    expect(fake.shareEvent).not.toHaveBeenCalled();
  });

  it("asks for the community guidelines first, then posts", async () => {
    const fake = makeFake([]);
    fake.shareEvent
      .mockRejectedValueOnce(new CommunityError("guidelines_required"))
      .mockResolvedValueOnce("p1");
    const { guidelines } = await renderAction("bml2026abc", fake);
    await fireEvent.press(screen.getByTestId("share-post-profile"));
    await fireEvent.press(await screen.findByTestId("guidelines-sheet-age"));
    await fireEvent.press(screen.getByTestId("guidelines-sheet-agree"));
    await waitFor(() => expect(fake.shareEvent).toHaveBeenCalledTimes(2));
    expect(guidelines.accept).toHaveBeenCalled();
    expect(await screen.findByTestId("share-post-profile-done")).toBeTruthy();
  });

  it("explains a limited account and lets the person try again", async () => {
    const fake = makeFake([]);
    fake.shareEvent.mockRejectedValueOnce(new CommunityError("restricted"));
    await renderAction("bml2026abc", fake);
    await fireEvent.press(screen.getByTestId("share-post-profile"));
    expect(await screen.findByTestId("share-post-profile-error")).toHaveTextContent(
      i18n.t("community.errors.restricted"),
    );
    expect(
      screen.getByTestId("share-post-profile").props.accessibilityState.disabled,
    ).toBe(false);
  });
});
