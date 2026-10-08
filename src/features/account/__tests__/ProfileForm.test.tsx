import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";

import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { ProfileForm } from "../components/ProfileForm";

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack }),
}));

const mockSave = jest.fn();
const mockPick = jest.fn();
jest.mock("../service", () => ({
  saveProfile: (input: unknown) => mockSave(input),
  pickAvatar: () => mockPick(),
  getAvatarUrl: () => null,
}));
const mockRefresh = jest.fn();
jest.mock("../store", () => ({
  refreshProfile: () => mockRefresh(),
}));

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}
async function typeName(value: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId("profile-name-input"), value);
  });
}
function saveDisabled(): boolean {
  return screen.getByTestId("profile-save").props.accessibilityState?.disabled === true;
}

describe("ProfileForm", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockSave.mockResolvedValue(undefined);
    mockRefresh.mockResolvedValue(undefined);
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("keeps Save disabled until the name is 2-40 characters AND the terms are accepted", async () => {
    await render(<ProfileForm profile={null} privateProfile={null} />);
    expect(saveDisabled()).toBe(true);

    await typeName("A");
    await press("profile-terms");
    expect(saveDisabled()).toBe(true); // name too short

    await typeName("Shilan");
    expect(saveDisabled()).toBe(false);

    await press("profile-terms"); // untick
    expect(saveDisabled()).toBe(true); // consent required
  });

  it("the terms line covers the community guidelines and being 13 or older, and the guidelines can be read from the form", async () => {
    await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 360, height: 640 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <ProfileForm profile={null} privateProfile={null} />
      </SafeAreaProvider>,
    );
    expect(
      screen.getByText(
        "I agree to the Terms, the Privacy Policy and the Community guidelines, and I am 13 or older.",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("profile-guidelines")).toBeNull();
    await press("profile-guidelines-link");
    expect(screen.getByTestId("profile-guidelines")).toBeTruthy();
    // reading them is not agreeing: no agree button here, the checkbox above is the agreement
    expect(screen.queryByTestId("profile-guidelines-agree")).toBeNull();
    await press("profile-guidelines-close-button");
    expect(screen.queryByTestId("profile-guidelines")).toBeNull();
  });

  it("lists every profession plus prefer-not-to-say, and research consent is optional", async () => {
    await render(<ProfileForm profile={null} privateProfile={null} />);
    for (const key of [
      "none",
      "engineer",
      "architect",
      "construction",
      "teacher",
      "health",
      "student",
      "public_service",
      "business",
      "agriculture",
      "other",
    ]) {
      expect(screen.getByTestId(`profession-${key}`)).toBeTruthy();
    }

    await typeName("Shilan");
    await press("profile-terms");
    expect(saveDisabled()).toBe(false); // research box left unticked
  });

  it("saves the trimmed values and closes", async () => {
    await render(<ProfileForm profile={null} privateProfile={null} />);
    await typeName("Shilan");
    await press("profession-engineer");
    await press("profile-terms");
    await press("profile-research");
    await press("profile-save");

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: "Shilan",
        profession: "engineer",
        termsAccepted: true,
        researchConsent: true,
        avatar: { kind: "keep" },
        locale: "en",
      }),
    );
    expect(mockRefresh).toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalled();
  });

  it("sends a newly picked photo and shows save errors", async () => {
    mockPick.mockResolvedValueOnce("file:///photo.jpg");
    mockSave.mockRejectedValueOnce(new Error("nope"));
    await render(<ProfileForm profile={null} privateProfile={null} />);
    await typeName("Shilan");
    await press("profile-terms");
    await press("profile-photo-choose");
    await press("profile-save");

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ avatar: { kind: "new", uri: "file:///photo.jpg" } }),
    );
    expect(screen.getByText("Something went wrong. Try again.")).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });
});
