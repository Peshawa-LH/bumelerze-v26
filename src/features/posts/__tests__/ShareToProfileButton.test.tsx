import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import { CommunityError } from "@/features/community/types";
import i18n from "@/i18n";

import { ShareToProfileButton } from "../components/ShareToProfileButton";
import { makeFake } from "../__fixtures__/fake-posts";

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

const PREVIEW = { magnitude: 5.1, lat: 35.18, lon: 45.98, time: Date.UTC(2026, 9, 1, 3) };

async function renderButton(
  eventRef: string | null = "bml2026abc",
  fake = makeFake([]),
  guidelines = { accept: jest.fn(async () => undefined) },
) {
  await renderWithProviders(
    <ShareToProfileButton
      eventRef={eventRef}
      preview={PREVIEW}
      transport={fake}
      guidelinesTransport={guidelines}
    />,
  );
  return { fake, guidelines };
}

describe("Share to my profile (P2-11)", () => {
  beforeEach(async () => {
    mockAccount = { status: "account", userId: "me", profile: { username: "shilan" } };
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("is hidden for a guest", async () => {
    mockAccount = { status: "anonymous", userId: "g", profile: null };
    await renderButton();
    expect(screen.queryByTestId("share-to-profile")).toBeNull();
  });

  it("is hidden for an account without a @username (no public profile to post on)", async () => {
    mockAccount = { status: "account", userId: "me", profile: { username: null } };
    await renderButton();
    expect(screen.queryByTestId("share-to-profile")).toBeNull();
  });

  it("is hidden until the event's id is known", async () => {
    await renderButton(null);
    expect(screen.queryByTestId("share-to-profile")).toBeNull();
  });

  it("previews the card, says no location is added, and shares the event id with my words", async () => {
    const { fake } = await renderButton();
    await fireEvent.press(screen.getByTestId("share-to-profile"));
    expect(screen.getByTestId("share-to-profile-preview-magnitude")).toHaveTextContent(
      "M 5.1",
    );
    expect(screen.getByTestId("share-to-profile-privacy")).toHaveTextContent(
      i18n.t("posts.share.noLocation"),
    );
    await fireEvent.changeText(
      screen.getByTestId("share-to-profile-input"),
      "  I felt it in Sulaymaniyah  ",
    );
    await fireEvent.press(screen.getByTestId("share-to-profile-submit"));
    await waitFor(() =>
      expect(fake.shareEvent).toHaveBeenCalledWith(
        "bml2026abc",
        "I felt it in Sulaymaniyah",
      ),
    );
    expect(await screen.findByTestId("share-to-profile-done")).toHaveTextContent(
      i18n.t("posts.share.done"),
    );
    expect(screen.queryByTestId("share-to-profile-sheet")).toBeNull();
    // only the event reference and the text: the transport has no place for a location
    expect(fake.shareEvent.mock.calls[0]).toHaveLength(2);
  });

  it("allows sharing with no words, and blocks more than 280 characters", async () => {
    const { fake } = await renderButton();
    await fireEvent.press(screen.getByTestId("share-to-profile"));
    await fireEvent.changeText(
      screen.getByTestId("share-to-profile-input"),
      "z".repeat(281),
    );
    expect(
      screen.getByTestId("share-to-profile-submit").props.accessibilityState.disabled,
    ).toBe(true);
    expect(screen.getByTestId("share-to-profile-counter").props.children).toContain(
      "281/280",
    );
    await fireEvent.changeText(screen.getByTestId("share-to-profile-input"), "");
    await fireEvent.press(screen.getByTestId("share-to-profile-submit"));
    await waitFor(() => expect(fake.shareEvent).toHaveBeenCalledWith("bml2026abc", ""));
  });

  it("asks for the community guidelines first, then shares", async () => {
    const fake = makeFake([]);
    fake.shareEvent
      .mockRejectedValueOnce(new CommunityError("guidelines_required"))
      .mockResolvedValueOnce("p1");
    const { guidelines } = await renderButton("bml2026abc", fake);
    await fireEvent.press(screen.getByTestId("share-to-profile"));
    await fireEvent.press(screen.getByTestId("share-to-profile-submit"));
    await fireEvent.press(await screen.findByTestId("guidelines-sheet-age"));
    await fireEvent.press(screen.getByTestId("guidelines-sheet-agree"));
    await waitFor(() => expect(fake.shareEvent).toHaveBeenCalledTimes(2));
    expect(guidelines.accept).toHaveBeenCalled();
  });

  it("explains a limited account and keeps the text", async () => {
    const fake = makeFake([]);
    fake.shareEvent.mockRejectedValueOnce(new CommunityError("restricted"));
    await renderButton("bml2026abc", fake);
    await fireEvent.press(screen.getByTestId("share-to-profile"));
    await fireEvent.changeText(screen.getByTestId("share-to-profile-input"), "words");
    await fireEvent.press(screen.getByTestId("share-to-profile-submit"));
    expect(await screen.findByTestId("share-to-profile-error")).toHaveTextContent(
      i18n.t("community.errors.restricted"),
    );
    expect(screen.getByTestId("share-to-profile-input").props.value).toBe("words");
  });
});
