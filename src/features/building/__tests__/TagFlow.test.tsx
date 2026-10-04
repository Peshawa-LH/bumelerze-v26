import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import { NewHomeScreen } from "../components/NewHomeScreen";
import {
  QUESTIONNAIRE_VERSION,
  QUESTIONS,
  visibleQuestions,
  type Answers,
} from "../questionnaire";
import { HomeError } from "../types";
import {
  TAG,
  clearQueryClients,
  member,
  mockTransport,
  renderWithProviders,
  resetMockTransport,
} from "../__fixtures__/testing";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    canGoBack: () => true,
  }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));

let mockAccount: { status: string; userId: string | null } = {
  status: "account",
  userId: "u-owner",
};
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => mockAccount,
}));

jest.mock("../transport", () => ({
  ...jest.requireActual("../transport"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  SupabaseHomeTransport: require("../__fixtures__/testing").mockTransport,
}));

const mockRequestPermission = jest.fn();
const mockGetPosition = jest.fn();
jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: () => mockRequestPermission(),
  getCurrentPositionAsync: () => mockGetPosition(),
  PermissionStatus: { GRANTED: "granted", DENIED: "denied" },
  Accuracy: { Balanced: 3 },
}));

jest.mock("../components/PinMap", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  const { createElement } = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  const { Pressable } = require("react-native");
  return {
    PIN_MAP_AVAILABLE: true,
    // Stands in for the web map: one press drops the pin at a fixed point.
    PinMap: ({ onPoint }: { onPoint: (point: { lat: number; lon: number }) => void }) =>
      createElement(Pressable, {
        testID: "pin-stub",
        onPress: () => onPoint({ lat: 36.2512341, lon: 44.0123456 }),
      }),
  };
});

const mockPickPhoto = jest.fn();
jest.mock("../photos", () => ({
  ...jest.requireActual("../photos"),
  pickHomePhoto: (source: string) => mockPickPhoto(source),
  readHomePhoto: async () => new ArrayBuffer(4),
}));

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

async function pressText(text: string) {
  await act(async () => {
    fireEvent.press(screen.getByText(text));
  });
}

function nextDisabled(): boolean {
  return screen.getByTestId("flow-next").props.accessibilityState?.disabled === true;
}

/** Walks every question of the flow, answering with `pick`. */
async function answerAll(pick: (id: string) => string) {
  for (let guard = 0; guard < 30; guard += 1) {
    const option = QUESTIONS.map((question) => question.id).find((id) =>
      screen.queryByTestId(`option-${id}-${pick(id)}`),
    );
    if (!option) {
      return;
    }
    await press(`option-${option}-${pick(option)}`);
    await press("flow-next");
  }
}

async function reachQuestions() {
  await press("kind-house");
  await press("flow-next");
  await pressText("Erbil");
  await press("flow-next");
}

/** Past the location and the first question ("use"), on the floors screen. */
async function reachFloors() {
  await reachQuestions();
  await press("option-use-house");
  await press("flow-next");
}

describe("Tag my building flow", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetMockTransport();
    mockAccount = { status: "account", userId: "u-owner" };
    mockRequestPermission.mockResolvedValue({ status: "granted" });
    mockGetPosition.mockResolvedValue({ coords: { latitude: 36.2, longitude: 44.0 } });
    mockPickPhoto.mockResolvedValue("file://photo.jpg");
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(async () => {
    cleanup();
    await clearQueryClients();
  });

  it("an anonymous user sees the account card instead of the flow", async () => {
    mockAccount = { status: "anonymous", userId: "a1" };
    await renderWithProviders(<NewHomeScreen />);
    expect(screen.getByText("Create an account to tag your home.")).toBeTruthy();
    expect(screen.queryByTestId("flow-next")).toBeNull();
    await press("home-gate-sign-in");
    expect(mockPush).toHaveBeenCalledWith("/account/sign-in");
  });

  it("starts with house or apartment and only enables Next after a choice", async () => {
    await renderWithProviders(<NewHomeScreen />);
    expect(screen.getByText("What are you tagging?")).toBeTruthy();
    expect(nextDisabled()).toBe(true);
    expect(screen.queryByTestId("flow-unit")).toBeNull();
    await press("kind-apartment");
    expect(screen.getByTestId("flow-unit")).toBeTruthy();
    expect(nextDisabled()).toBe(false);
  });

  it("asks for the location privately, by GPS or by town", async () => {
    await renderWithProviders(<NewHomeScreen />);
    await press("kind-house");
    await press("flow-next");
    expect(screen.getByText("Your exact location stays private.")).toBeTruthy();
    expect(nextDisabled()).toBe(true);
    await pressText("Erbil");
    expect(nextDisabled()).toBe(false);
    expect(screen.getByText(/A town centre is less exact/)).toBeTruthy();
  });

  it("uses one GPS fix when asked and says so", async () => {
    await renderWithProviders(<NewHomeScreen />);
    await press("kind-house");
    await press("flow-next");
    await press("location-gps");
    expect(await screen.findByText("Location set.")).toBeTruthy();
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(nextDisabled()).toBe(false);
  });

  it("falls back to the town list when location is refused", async () => {
    mockRequestPermission.mockResolvedValue({ status: "denied" });
    await renderWithProviders(<NewHomeScreen />);
    await press("kind-house");
    await press("flow-next");
    await press("location-gps");
    expect(
      await screen.findByText("Could not get your location. Choose a town."),
    ).toBeTruthy();
    expect(nextDisabled()).toBe(true);
  });

  it("shows one question per screen with a progress bar and an 'I don't know' option", async () => {
    await renderWithProviders(<NewHomeScreen />);
    await reachFloors();
    expect(screen.getByText("How many floors above the ground?")).toBeTruthy();
    expect(screen.getByTestId("option-floors-dk")).toBeTruthy();
    expect(screen.getByText("I don't know")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.props.accessibilityValue).toMatchObject({ min: 0, now: 4 });
    expect(nextDisabled()).toBe(true);
    await press("option-floors-f2");
    expect(nextDisabled()).toBe(false);
    await press("flow-next");
    expect(screen.getByText("Is there a basement?")).toBeTruthy();
    expect(screen.getByRole("progressbar").props.accessibilityValue.now).toBe(5);
  });

  it("every question offers 'I don't know' and large option buttons", async () => {
    for (const question of QUESTIONS) {
      expect(question.options).toContain("dk");
    }
    await renderWithProviders(<NewHomeScreen />);
    await reachFloors();
    const option = screen.getByTestId("option-floors-f2");
    const flat = Array.isArray(option.props.style)
      ? Object.assign({}, ...option.props.style.flat())
      : option.props.style;
    expect(flat.minHeight).toBeGreaterThanOrEqual(44);
  });

  it("Back returns to the previous question with its answer kept", async () => {
    await renderWithProviders(<NewHomeScreen />);
    await reachFloors();
    await press("option-floors-f3");
    await press("flow-next");
    await press("flow-back");
    expect(screen.getByText("How many floors above the ground?")).toBeTruthy();
    expect(screen.getByTestId("option-floors-f3").props.accessibilityState.selected).toBe(
      true,
    );
  });

  it("Back on the first screen leaves the flow", async () => {
    await renderWithProviders(<NewHomeScreen />);
    await press("flow-back");
    expect(mockBack).toHaveBeenCalled();
  });

  it("branches: block walls ask about belts and the roof, a frame does not", async () => {
    await renderWithProviders(<NewHomeScreen />);
    await reachFloors();
    await press("option-floors-f2");
    await press("flow-next");
    await press("option-basement-none");
    await press("flow-next");
    await press("option-age-a10_25");
    await press("flow-next");
    await press("option-builder-builder");
    await press("flow-next");
    await press("option-structure-block");
    await press("flow-next");
    expect(screen.getByText(/concrete belts or columns/)).toBeTruthy();
    await press("option-belts-yes");
    await press("flow-next");
    expect(screen.getByText("What are the roof and floors made of?")).toBeTruthy();
  });

  it("creates the home: tag, survey, assessment, then the report", async () => {
    await renderWithProviders(<NewHomeScreen />);
    await reachQuestions();
    await answerAll((id) =>
      id === "structure" ? "frame" : id === "floors" ? "f2" : "dk",
    );
    // photos step: skip
    expect(screen.getByText("Photos (optional)")).toBeTruthy();
    expect(screen.getByText("Skip")).toBeTruthy();
    await press("flow-next");
    expect(screen.getByText("Check your answers")).toBeTruthy();
    await press("flow-submit");

    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(mockTransport.createTag).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "house", lat: 36.19, lon: 44.01 }),
    );
    const survey = mockTransport.saveSurvey.mock.calls[0]?.[0];
    expect(survey.tagId).toBe("tag-1");
    expect(survey.version).toBe("q-v1");
    expect(QUESTIONNAIRE_VERSION).toBe("q-v1");
    expect(survey.answers).toMatchObject({
      structure: "frame",
      floors: "f2",
      location_quality: "town",
    });
    const saved = mockTransport.saveAssessment.mock.calls[0]?.[0];
    expect(saved.assessment.method).toBe("auto-v0");
    expect(saved.assessment.ims_type_probs["RC1-L"]).toBeGreaterThan(0);
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/home/[tagId]/report",
      params: { tagId: "tag-1" },
    });
  });

  it("uploads picked photos after the report is saved", async () => {
    await renderWithProviders(<NewHomeScreen />);
    await reachQuestions();
    await answerAll(() => "dk");
    await press("photo-front-library");
    await waitFor(() => expect(mockPickPhoto).toHaveBeenCalledWith("library"));
    expect(screen.getByTestId("photo-front-remove")).toBeTruthy();
    expect(screen.getByText("Next")).toBeTruthy();
    await press("flow-next");
    await press("flow-submit");
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(mockTransport.uploadPhoto).toHaveBeenCalledTimes(1);
    expect(mockTransport.uploadPhoto.mock.calls[0]?.[0]).toMatchObject({
      tagId: "tag-1",
      contentType: "image/jpeg",
    });
  });

  it("a photo can be removed again", async () => {
    await renderWithProviders(<NewHomeScreen />);
    await reachQuestions();
    await answerAll(() => "dk");
    await press("photo-side-camera");
    await waitFor(() => expect(screen.getByTestId("photo-side-remove")).toBeTruthy());
    await press("photo-side-remove");
    expect(screen.queryByTestId("photo-side-remove")).toBeNull();
    expect(screen.getByText("Skip")).toBeTruthy();
  });

  it("review rows change an answer and return to the review", async () => {
    await renderWithProviders(<NewHomeScreen />);
    await reachQuestions();
    await answerAll(() => "dk");
    await press("flow-next");
    expect(screen.getAllByText("I don't know").length).toBeGreaterThan(3);
    await press("review-floors");
    expect(screen.getByText("How many floors above the ground?")).toBeTruthy();
    await press("option-floors-f4_5");
    await press("flow-next");
    expect(screen.getByText("Check your answers")).toBeTruthy();
    expect(
      screen.getByLabelText(/How many floors above the ground\?: 4 or 5/),
    ).toBeTruthy();
  });

  it("shows a short message and keeps the answers when saving fails", async () => {
    mockTransport.createTag.mockRejectedValueOnce(new HomeError("homes_limit"));
    await renderWithProviders(<NewHomeScreen />);
    await reachQuestions();
    await answerAll(() => "dk");
    await press("flow-next");
    await press("flow-submit");
    expect(await screen.findByText("Limit reached: 5 homes per account.")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByText("Check your answers")).toBeTruthy();
  });

  it("a retry after a late failure reuses the tag it already created", async () => {
    mockTransport.saveSurvey.mockRejectedValueOnce(new HomeError("network"));
    await renderWithProviders(<NewHomeScreen />);
    await reachQuestions();
    await answerAll(() => "dk");
    await press("flow-next");
    await press("flow-submit");
    expect(await screen.findByText("No connection. Try again.")).toBeTruthy();
    await press("flow-submit");
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(mockTransport.createTag).toHaveBeenCalledTimes(1);
  });

  it("the research questions are saved with the survey; the optional ones can be skipped", async () => {
    await renderWithProviders(<NewHomeScreen />);
    await reachQuestions();
    const picks: Record<string, string> = {
      use: "shop_below",
      basement: "part",
      adjacency: "one_side",
      size: "s100_200",
      peopleDay: "p6_10",
      structure: "frame",
      floors: "f3",
    };
    // Everything but the people questions; those are skipped without an answer.
    await answerAll((id) => (id === "peopleNight" ? "skip" : (picks[id] ?? "dk")));
    expect(screen.getByText(/How many people are usually inside at night/)).toBeTruthy();
    expect(nextDisabled()).toBe(false);
    expect(screen.getByText("Skip")).toBeTruthy();
    await press("flow-next");
    await press("flow-next");
    await press("flow-submit");
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    const survey = mockTransport.saveSurvey.mock.calls[0]?.[0];
    expect(survey.version).toBe("q-v1");
    expect(survey.answers).toMatchObject({
      use: "shop_below",
      basement: "part",
      adjacency: "one_side",
      size: "s100_200",
      peopleDay: "p6_10",
    });
    expect(survey.answers.peopleNight).toBeUndefined();
  });

  it("review lists the research answers", async () => {
    await renderWithProviders(<NewHomeScreen />);
    await reachQuestions();
    await answerAll((id) => (id === "adjacency" ? "both_sides" : "dk"));
    await press("flow-next");
    expect(
      screen.getByLabelText(
        /Is it joined to a neighbouring building\?: Yes, on both sides/,
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("review-size")).toBeTruthy();
  });

  describe("place on map", () => {
    async function openPinMap() {
      await renderWithProviders(<NewHomeScreen />);
      await press("kind-house");
      await press("flow-next");
      await press("location-pin");
    }

    it("offers the map as a third choice next to GPS and towns", async () => {
      await renderWithProviders(<NewHomeScreen />);
      await press("kind-house");
      await press("flow-next");
      expect(screen.getByTestId("location-gps")).toBeTruthy();
      expect(screen.getByTestId("location-pin")).toBeTruthy();
      expect(screen.getByText("Erbil")).toBeTruthy();
    });

    it("the pin cannot be confirmed until it is moved, then sets the location", async () => {
      await openPinMap();
      expect(screen.getByText("Place the pin")).toBeTruthy();
      expect(
        screen.getByTestId("location-pin-confirm").props.accessibilityState?.disabled,
      ).toBe(true);
      await press("pin-stub");
      expect(
        screen.getByTestId("location-pin-confirm").props.accessibilityState?.disabled,
      ).toBeFalsy();
      await press("location-pin-confirm");
      expect(screen.getByText("Pin placed.")).toBeTruthy();
      expect(nextDisabled()).toBe(false);
    });

    it("cancel leaves the location unset", async () => {
      await openPinMap();
      await press("location-pin-cancel");
      expect(screen.getByText("Your exact location stays private.")).toBeTruthy();
      expect(nextDisabled()).toBe(true);
    });

    it("the pinned point is what the home is created with", async () => {
      await openPinMap();
      await press("pin-stub");
      await press("location-pin-confirm");
      await press("flow-next");
      await answerAll(() => "dk");
      await press("flow-next");
      expect(screen.getByText("Pin on map")).toBeTruthy();
      await press("flow-submit");
      await waitFor(() => expect(mockReplace).toHaveBeenCalled());
      expect(mockTransport.createTag).toHaveBeenCalledWith(
        expect.objectContaining({ lat: 36.251234, lon: 44.012346 }),
      );
      expect(mockTransport.saveSurvey.mock.calls[0]?.[0].answers).toMatchObject({
        location_quality: "pin",
      });
    });
  });

  describe("retake", () => {
    const stored: Answers = { floors: "f3", structure: "stone", stone: "dressed" };

    beforeEach(() => {
      mockTransport.fetchTags.mockResolvedValue([TAG]);
      mockTransport.fetchMemberships.mockResolvedValue([
        member("u-owner", { role: "owner" }),
      ]);
      mockTransport.fetchLatestSurvey.mockResolvedValue({
        surveyId: "survey-9",
        tagId: "tag-1",
        version: "q-v0",
        answers: { ...stored, location_quality: "gps" },
        createdAt: "2026-10-04T10:00:00Z",
      });
    });

    it("starts at the questions with the last answers selected, without kind or location", async () => {
      await renderWithProviders(<NewHomeScreen tagId="tag-1" />);
      expect(await screen.findByText("What is the building used for?")).toBeTruthy();
      await press("option-use-dk");
      await press("flow-next");
      expect(screen.getByText("How many floors above the ground?")).toBeTruthy();
      expect(
        screen.getByTestId("option-floors-f3").props.accessibilityState.selected,
      ).toBe(true);
      expect(screen.queryByTestId("kind-house")).toBeNull();
    });

    it("saves a new survey and assessment for the same tag", async () => {
      await renderWithProviders(<NewHomeScreen tagId="tag-1" />);
      await screen.findByText("What is the building used for?");
      expect(visibleQuestions({ ...stored }).length).toBeGreaterThan(3);
      const picks: Record<string, string> = {
        floors: "f4_5",
        structure: "stone",
        stone: "dressed",
      };
      await answerAll((id) => picks[id] ?? "dk");
      expect(screen.getByText("Check your answers")).toBeTruthy();
      expect(screen.getByText("Save")).toBeTruthy();
      await press("flow-submit");
      await waitFor(() => expect(mockReplace).toHaveBeenCalled());
      expect(mockTransport.createTag).not.toHaveBeenCalled();
      expect(mockTransport.saveSurvey.mock.calls[0]?.[0].tagId).toBe("tag-1");
      expect(mockTransport.saveAssessment).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: "/home/[tagId]/report",
        params: { tagId: "tag-1" },
      });
    });
  });

  it("renders in Sorani without raw keys", async () => {
    await i18n.changeLanguage("ckb");
    await renderWithProviders(<NewHomeScreen />);
    expect(screen.getByText("چی تۆمار دەکەیت؟")).toBeTruthy();
    expect(screen.queryByText(/building\./)).toBeNull();
    await press("kind-house");
    await press("flow-next");
    await pressText("هەولێر");
    await press("flow-next");
    expect(screen.getByText("بینایەکە بۆ چی بەکاردێت؟")).toBeTruthy();
    await press("option-use-house");
    await press("flow-next");
    expect(screen.getByText("چەند نهۆم لەسەر زەوییە؟")).toBeTruthy();
    expect(screen.getByText("نازانم")).toBeTruthy();
  });
});
