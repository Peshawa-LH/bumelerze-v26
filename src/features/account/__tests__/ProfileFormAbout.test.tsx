import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";

import { formatDateOnly } from "@/features/events/format";
import i18n from "@/i18n";
import type { ProfileAbout } from "../about";
import { TERMS_VERSION } from "../constants";
import { ProfileForm } from "../components/ProfileForm";
import type { PrivateProfile, Profile } from "../types";

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack }),
}));
const mockSave = jest.fn();
jest.mock("../service", () => ({
  saveProfile: (input: unknown) => mockSave(input),
  pickAvatar: jest.fn(),
  getAvatarUrl: () => null,
}));
jest.mock("../store", () => ({
  refreshProfile: jest.fn(async () => undefined),
}));
jest.mock("@/features/community/transport", () => ({
  SupabaseCommunityTransport: { isUsernameAvailable: jest.fn(async () => true) },
}));
// The real place search reads the bundled town list and the device fix; this
// stand-in offers one town WITH coordinates, to prove they are dropped.
jest.mock("@/features/geo/components/PlaceSearch", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  return {
    PlaceSearch: ({ onSelect }: { onSelect: (place: unknown) => void }) => (
      <Pressable
        testID="fake-place-duhok"
        onPress={() =>
          onSelect({
            id: "duhok",
            kind: "city",
            lat: 36.8669,
            lon: 42.9503,
            names: { en: "Duhok", ckb: "دهۆک", kmr: "Duhok", ar: "دهوك" },
          })
        }
      >
        <Text>Duhok</Text>
      </Pressable>
    ),
  };
});

const PROFILE: Profile = {
  userId: "me",
  displayName: "Shilan",
  avatarPath: null,
  username: "shilan",
  isPrivate: false,
  communityReady: true,
};
const PRIVATE: PrivateProfile = {
  profession: null,
  locale: "en",
  termsVersion: TERMS_VERSION,
  termsAcceptedAt: "2026-01-01T00:00:00Z",
  researchConsentVersion: null,
  researchConsentAt: null,
  hideBadges: false,
};
const NOW = Date.UTC(2026, 9, 8, 12);
const ABOUT: ProfileAbout = {
  bio: null,
  city: null,
  pinnedPostId: null,
  usernameNextChangeAt: null,
  displayNameChangesLeft: 5,
  displayNameNextChangeAt: null,
};

/** `"missing"`: the server has no migration 0058 (no about data at all). */
async function renderForm(about: ProfileAbout | null | "missing" = ABOUT) {
  await render(
    <ProfileForm
      profile={PROFILE}
      privateProfile={PRIVATE}
      about={about === "missing" ? undefined : about}
      nowMs={NOW}
    />,
  );
}
async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}
function lastSaved(): Record<string, unknown> {
  return mockSave.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

describe("Edit profile: bio, city and name-change limits (0058)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockSave.mockResolvedValue(undefined);
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("hides bio and city when the server does not have them yet", async () => {
    await renderForm("missing");
    expect(screen.queryByTestId("profile-bio-input")).toBeNull();
    expect(screen.queryByTestId("profile-city-choose")).toBeNull();
    await press("profile-save");
    expect(lastSaved().about).toBeUndefined();
  });

  it("saves a bio and shows a live count", async () => {
    await renderForm();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("profile-bio-input"), "Volunteer in Duhok");
    });
    expect(screen.getByTestId("profile-bio-status")).toHaveTextContent(/18\/160/);
    await press("profile-save");
    expect(lastSaved().about).toEqual({ bio: "Volunteer in Duhok", city: null });
  });

  it("refuses a link or more than 160 characters, with a clear message", async () => {
    await renderForm();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("profile-bio-input"), "see www.spam.org");
    });
    expect(screen.getByTestId("profile-bio-status")).toHaveTextContent(
      i18n.t("account.errors.bio_link"),
    );
    expect(screen.getByTestId("profile-save").props.accessibilityState.disabled).toBe(
      true,
    );
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("profile-bio-input"), "x".repeat(161));
    });
    expect(screen.getByTestId("profile-bio-status")).toHaveTextContent(
      i18n.t("account.errors.bio_too_long"),
    );
  });

  it("the city label keeps only the place id and name, never coordinates", async () => {
    await renderForm();
    await press("profile-city-choose");
    await press("fake-place-duhok");
    expect(screen.getByTestId("profile-city-value")).toHaveTextContent("Lives in Duhok");
    await press("profile-save");
    const about = lastSaved().about as { city: unknown };
    expect(about.city).toEqual({ placeId: "duhok", name: "Duhok" });
    expect(JSON.stringify(lastSaved())).not.toMatch(/36\.86|42\.95|"lat"|"lon"/);
  });

  it("the city can be removed", async () => {
    await renderForm({ ...ABOUT, city: { placeId: "erbil", name: "Erbil" } });
    expect(screen.getByTestId("profile-city-value")).toHaveTextContent("Lives in Erbil");
    await press("profile-city-remove");
    expect(screen.queryByTestId("profile-city-value")).toBeNull();
    await press("profile-save");
    expect((lastSaved().about as { city: unknown }).city).toBeNull();
  });

  it("says the @username can change once every 30 days", async () => {
    await renderForm();
    expect(screen.getByTestId("profile-username-limit")).toHaveTextContent(
      i18n.t("account.profile.usernameOncePerMonth"),
    );
    expect(screen.getByTestId("profile-username-input").props.editable).toBe(true);
  });

  it("locks the @username until the date the server gives, and says when", async () => {
    const next = NOW + 10 * 86_400_000;
    await renderForm({ ...ABOUT, usernameNextChangeAt: next });
    expect(screen.getByTestId("profile-username-input").props.editable).toBe(false);
    expect(screen.getByTestId("profile-username-limit")).toHaveTextContent(
      i18n.t("account.profile.usernameLocked", {
        date: formatDateOnly(next, "en", i18n.t),
      }),
    );
  });

  it("counts down the last display-name changes", async () => {
    await renderForm({ ...ABOUT, displayNameChangesLeft: 2 });
    expect(screen.getByTestId("profile-name-limit")).toHaveTextContent(
      i18n.t("account.profile.nameChangesLeft", { number: "2" }),
    );
    expect(screen.getByTestId("profile-name-input").props.editable).toBe(true);
  });

  it("locks the display name at zero changes left and says when it opens", async () => {
    const next = NOW + 3 * 86_400_000;
    await renderForm({
      ...ABOUT,
      displayNameChangesLeft: 0,
      displayNameNextChangeAt: next,
    });
    expect(screen.getByTestId("profile-name-input").props.editable).toBe(false);
    expect(screen.getByTestId("profile-name-limit")).toHaveTextContent(
      i18n.t("account.profile.nameLocked", { date: formatDateOnly(next, "en", i18n.t) }),
    );
  });

  it("shows nothing about limits while plenty of changes are left", async () => {
    await renderForm();
    expect(screen.queryByTestId("profile-name-limit")).toBeNull();
  });

  it("words the server's limit refusal", async () => {
    const { AccountError } = jest.requireActual("../types");
    mockSave.mockRejectedValueOnce(new AccountError("username_change_limit"));
    await renderForm();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("profile-username-input"), "shilan2");
    });
    await press("profile-save");
    expect(screen.getByRole("alert")).toHaveTextContent(
      i18n.t("account.errors.username_change_limit"),
    );
  });

  it("Sorani: labels in Sorani, the bio follows its own direction", async () => {
    await i18n.changeLanguage("ckb");
    await renderForm({ ...ABOUT, bio: "خۆبەخش لە دهۆک" });
    expect(screen.getByText(i18n.t("account.profile.bioLabel"))).toBeTruthy();
    const input = screen.getByTestId("profile-bio-input");
    expect(input.props.value).toBe("خۆبەخش لە دهۆک");
    const style = Array.isArray(input.props.style)
      ? Object.assign({}, ...input.props.style.flat())
      : input.props.style;
    expect(style.textAlign).toBe("auto");
    await i18n.changeLanguage("en");
  });
});
