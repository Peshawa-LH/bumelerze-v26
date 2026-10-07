import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { ProfileForm } from "../components/ProfileForm";
import { TERMS_VERSION } from "../constants";
import type { PrivateProfile, Profile } from "../types";

jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn() }) }));

const mockSave = jest.fn();
jest.mock("../service", () => ({
  saveProfile: (input: unknown) => mockSave(input),
  pickAvatar: jest.fn(),
  getAvatarUrl: () => null,
}));
jest.mock("../store", () => ({ refreshProfile: jest.fn(async () => undefined) }));

const mockAvailable = jest.fn();
jest.mock("@/features/community/transport", () => ({
  SupabaseCommunityTransport: {
    isUsernameAvailable: (name: string) => mockAvailable(name),
  },
}));

const PROFILE: Profile = {
  userId: "u1",
  displayName: "Shilan",
  avatarPath: null,
  username: null,
  isPrivate: false,
  communityReady: true,
};
const PRIVATE: PrivateProfile = {
  profession: null,
  locale: "en",
  termsVersion: TERMS_VERSION,
  termsAcceptedAt: "x",
  researchConsentVersion: null,
  researchConsentAt: null,
  hideBadges: false,
};

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}
async function type(testID: string, value: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId(testID), value);
  });
}
function saveDisabled(): boolean {
  return screen.getByTestId("profile-save").props.accessibilityState?.disabled === true;
}

// The stored consent is current, so the terms box starts ticked.
describe("ProfileForm: username and privacy", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockSave.mockResolvedValue(undefined);
    mockAvailable.mockResolvedValue(true);
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it("suggests a username from the display name and fills it on tap", async () => {
    await render(<ProfileForm profile={PROFILE} privateProfile={PRIVATE} />);
    const chip = screen.getByTestId("profile-username-suggest");
    expect(chip).toBeTruthy();
    await press("profile-username-suggest");
    expect(screen.getByTestId("profile-username-input").props.value).toBe("shilan");
    expect(screen.queryByTestId("profile-username-suggest")).toBeNull();
  });

  it("checks availability after typing stops and shows the result", async () => {
    await render(<ProfileForm profile={PROFILE} privateProfile={PRIVATE} />);
    await type("profile-username-input", "Shilan.K");
    expect(screen.getByTestId("profile-username-status").props.children).toBe(
      "Checking…",
    );
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(mockAvailable).toHaveBeenCalledWith("shilan.k");
    expect(screen.getByTestId("profile-username-status").props.children).toBe(
      "Available",
    );
  });

  it("blocks Save when the name is taken", async () => {
    mockAvailable.mockResolvedValue(false);
    await render(<ProfileForm profile={PROFILE} privateProfile={PRIVATE} />);
    await type("profile-username-input", "taken");
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(screen.getByText("That username is taken.")).toBeTruthy();
    expect(saveDisabled()).toBe(true);
  });

  it("rejects an invalid username on the spot, without asking the server", async () => {
    await render(<ProfileForm profile={PROFILE} privateProfile={PRIVATE} />);
    await type("profile-username-input", "no spaces!");
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(mockAvailable).not.toHaveBeenCalled();
    expect(
      screen.getByText("Use 3–24 letters, digits, dots or underscores."),
    ).toBeTruthy();
    expect(saveDisabled()).toBe(true);
  });

  it("keeps the handle left to right in a right-to-left language", async () => {
    await render(<ProfileForm profile={PROFILE} privateProfile={PRIVATE} />);
    const style = [screen.getByTestId("profile-username-input").props.style].flat(2);
    expect(style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ writingDirection: "ltr", textAlign: "left" }),
      ]),
    );
  });

  it("saves the username, the private switch and the badge switch", async () => {
    await render(<ProfileForm profile={PROFILE} privateProfile={PRIVATE} />);
    await type("profile-username-input", "shilan.k");
    await press("profile-private");
    await press("profile-show-badges"); // ticked by default -> off
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    await press("profile-save");
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "shilan.k",
        isPrivate: true,
        hideBadges: true,
      }),
    );
  });

  it("shows badges by default (the switch is on)", async () => {
    await render(<ProfileForm profile={PROFILE} privateProfile={PRIVATE} />);
    expect(
      screen.getByTestId("profile-show-badges").props.accessibilityState.checked,
    ).toBe(true);
    expect(screen.getByTestId("profile-private").props.accessibilityState.checked).toBe(
      false,
    );
  });

  it("hides the community fields and sends none of them when the server lacks the columns", async () => {
    await render(
      <ProfileForm
        profile={{ ...PROFILE, communityReady: false }}
        privateProfile={PRIVATE}
      />,
    );
    expect(screen.queryByTestId("profile-username-input")).toBeNull();
    expect(screen.queryByTestId("profile-private")).toBeNull();
    await press("profile-save");
    const input = mockSave.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input).not.toHaveProperty("username");
    expect(input).not.toHaveProperty("isPrivate");
    expect(input).not.toHaveProperty("hideBadges");
  });
});
