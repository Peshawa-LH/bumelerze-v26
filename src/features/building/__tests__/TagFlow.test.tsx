import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";

import i18n from "@/i18n";
import { NewHomeScreen } from "../components/NewHomeScreen";
import { useHomePhotoQueueStore } from "../photo-queue";
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

jest.mock("expo-crypto", () => ({
  randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}-0000`,
}));

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

/** Walks every choice question of the flow, answering with `pick`, then passes
 * the remarks screen (typing `remarks` first when given). */
async function answerAll(pick: (id: string) => string, remarks?: string) {
  for (let guard = 0; guard < 30; guard += 1) {
    const option = QUESTIONS.map((question) => question.id).find((id) =>
      screen.queryByTestId(`option-${id}-${pick(id)}`),
    );
    if (!option) {
      break;
    }
    await press(`option-${option}-${pick(option)}`);
    await press("flow-next");
  }
  if (screen.queryByTestId("input-remarks")) {
    if (remarks !== undefined) {
      await act(async () => {
        fireEvent.changeText(screen.getByTestId("input-remarks"), remarks);
      });
    }
    await press("flow-next");
  }
}

/** Past the building type and the location, on the floors screen. */
async function reachQuestions(use = "house_single") {
  await press(`option-use-${use}`);
  await press("flow-next");
  await pressText("Hawler");
  await press("flow-next");
}

async function reachFloors() {
  await reachQuestions();
}

describe("Tag my building flow", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetMockTransport();
    mockAccount = { status: "account", userId: "u-owner" };
    mockRequestPermission.mockResolvedValue({ status: "granted" });
    mockGetPosition.mockResolvedValue({ coords: { latitude: 36.2, longitude: 44.0 } });
    mockPickPhoto.mockResolvedValue("file://photo.jpg");
    useHomePhotoQueueStore.getState()._clear();
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

  it("starts with one question about the kind of building and only enables Next after a choice (N7)", async () => {
    await renderWithProviders(<NewHomeScreen />);
    expect(screen.getByText("What kind of building is it?")).toBeTruthy();
    for (const label of [
      "A house for one family",
      "A house for several families",
      "An apartment in a building or complex",
      "Homes above shops or offices",
      "A shop or office building",
      "A warehouse or workshop",
      "A school, mosque or other public building",
      "Something else",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByText("I don't know")).toBeNull();
    expect(nextDisabled()).toBe(true);
    expect(screen.queryByTestId("flow-unit")).toBeNull();
    await press("option-use-house_single");
    expect(nextDisabled()).toBe(false);
    expect(screen.queryByTestId("flow-unit")).toBeNull();
  });

  it.each([
    ["house_single", "house", "residential", false],
    ["house_multi", "apartment", "residential", true],
    ["apartment", "apartment", "residential", true],
    ["mixed", "apartment", "residential", true],
    ["commercial", "house", "commercial", false],
    ["industrial", "house", "industrial", false],
    ["public", "house", "public", false],
    ["other", "house", "other", false],
  ])(
    "the building type %s creates a %s tag with occupancy %s (unit name asked: %s)",
    async (use, kind, occupancy, asksUnit) => {
      await renderWithProviders(<NewHomeScreen />);
      await press(`option-use-${use}`);
      expect(!!screen.queryByTestId("flow-unit")).toBe(asksUnit);
      await press("flow-next");
      await pressText("Hawler");
      await press("flow-next");
      await answerAll(() => "dk");
      await press("flow-next");
      await press("flow-submit");
      await waitFor(() => expect(mockReplace).toHaveBeenCalled());
      expect(mockTransport.createTag).toHaveBeenCalledWith(
        expect.objectContaining({ kind }),
      );
      expect(mockTransport.saveSurvey.mock.calls[0]?.[0].answers).toMatchObject({
        use,
        occupancy,
      });
    },
  );

  it("asks for the location privately, by GPS or by place", async () => {
    await renderWithProviders(<NewHomeScreen />);
    await press("option-use-house_single");
    await press("flow-next");
    expect(screen.getByText("Your exact location stays private.")).toBeTruthy();
    expect(nextDisabled()).toBe(true);
    await pressText("Hawler");
    expect(nextDisabled()).toBe(false);
    expect(screen.getByText(/A place centre is less exact/)).toBeTruthy();
  });

  it("finds a village with the place search, by any spelling, and uses its centre", async () => {
    await renderWithProviders(<NewHomeScreen />);
    await press("option-use-house_single");
    await press("flow-next");
    await fireEvent.changeText(screen.getByLabelText("Search for a place"), "Sehbiyax");
    await press("location-place-search-result-n9852690211");
    expect(nextDisabled()).toBe(false);
    expect(screen.getByText(/A place centre is less exact/)).toBeTruthy();
    expect(
      screen.getByTestId("location-place-search-result-n9852690211").props
        .accessibilityState,
    ).toEqual(expect.objectContaining({ selected: true }));
  });

  it("uses one GPS fix when asked and says so", async () => {
    await renderWithProviders(<NewHomeScreen />);
    await press("option-use-house_single");
    await press("flow-next");
    await press("location-gps");
    expect(await screen.findByText("Location set.")).toBeTruthy();
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(nextDisabled()).toBe(false);
  });

  it("falls back to the place search when location is refused", async () => {
    mockRequestPermission.mockResolvedValue({ status: "denied" });
    await renderWithProviders(<NewHomeScreen />);
    await press("option-use-house_single");
    await press("flow-next");
    await press("location-gps");
    expect(
      await screen.findByText("Could not get your location. Choose a place."),
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
    expect(bar.props.accessibilityValue).toMatchObject({ min: 0, now: 3 });
    expect(nextDisabled()).toBe(true);
    await press("option-floors-f2");
    expect(nextDisabled()).toBe(false);
    await press("flow-next");
    expect(screen.getByText("Is there a basement?")).toBeTruthy();
    expect(screen.getByRole("progressbar").props.accessibilityValue.now).toBe(4);
  });

  it("every question offers 'I don't know' and large option buttons", async () => {
    // Every choice offers "I don't know", except the home type (first screen).
    for (const question of QUESTIONS) {
      if (question.id !== "use" && question.input !== "text") {
        expect(question.options).toContain("dk");
      }
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
    expect(survey.version).toBe("q-v3");
    expect(QUESTIONNAIRE_VERSION).toBe("q-v3");
    expect(survey.answers).toMatchObject({
      use: "house_single",
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

  it("queues picked photos with the report and uploads them in the background", async () => {
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
    await waitFor(() => expect(mockTransport.uploadPhoto).toHaveBeenCalledTimes(1));
    expect(mockTransport.uploadPhoto.mock.calls[0]?.[0]).toMatchObject({
      tagId: "tag-1",
      contentType: "image/jpeg",
      fileName: expect.stringMatching(/^front-/),
    });
  });

  it("offers ten suggested photos, each with its drawing and label (N11)", async () => {
    await renderWithProviders(<NewHomeScreen />);
    await reachQuestions();
    await answerAll(() => "dk");
    for (const [slot, label] of [
      ["front", "Front"],
      ["back", "Back"],
      ["left", "Left side"],
      ["right", "Right side"],
      ["ground", "Ground floor or shops"],
      ["roof", "Roof"],
      ["column", "A column or wall inside"],
      ["ceiling", "A ceiling inside"],
      ["cracks", "Cracks or damage"],
      ["basement", "Basement"],
    ] as const) {
      expect(
        within(screen.getByTestId(`photo-slot-${slot}`)).getByText(label),
      ).toBeTruthy();
    }
    expect(screen.getByText("Add more photos")).toBeTruthy();
    expect(screen.getByText("Photos: 0 of 30")).toBeTruthy();
  });

  it("a photo can be removed again", async () => {
    await renderWithProviders(<NewHomeScreen />);
    await reachQuestions();
    await answerAll(() => "dk");
    await press("photo-back-camera");
    await waitFor(() => expect(screen.getByTestId("photo-back-remove")).toBeTruthy());
    await press("photo-back-remove");
    expect(screen.queryByTestId("photo-back-remove")).toBeNull();
    expect(screen.getByText("Skip")).toBeTruthy();
  });

  it("extra photos each take a short caption and upload as 'more'", async () => {
    mockPickPhoto
      .mockResolvedValueOnce("file://one.jpg")
      .mockResolvedValueOnce("file://two.jpg");
    await renderWithProviders(<NewHomeScreen />);
    await reachQuestions();
    await answerAll(() => "dk");
    await press("photo-more-library");
    await press("photo-more-camera");
    await waitFor(() => expect(screen.getByTestId("photo-extra-1")).toBeTruthy());
    expect(screen.getByText("Photos: 2 of 30")).toBeTruthy();
    await act(async () => {
      fireEvent.changeText(
        screen.getByTestId("photo-extra-0-caption"),
        " crack by the door ",
      );
    });
    await press("photo-extra-1-remove");
    expect(screen.queryByTestId("photo-extra-1")).toBeNull();
    await press("flow-next");
    await press("flow-submit");
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    await waitFor(() => expect(mockTransport.savePhotoMeta).toHaveBeenCalledTimes(1));
    expect(mockTransport.uploadPhoto.mock.calls[0]?.[0].fileName).toMatch(/^more-/);
    expect(mockTransport.savePhotoMeta).toHaveBeenCalledWith(
      expect.objectContaining({ slot: "more", caption: "crack by the door" }),
    );
  });

  it("stops offering photos at the limit of 30 per home", async () => {
    let n = 0;
    mockPickPhoto.mockImplementation(async () => `file://p${(n += 1)}.jpg`);
    await renderWithProviders(<NewHomeScreen />);
    await reachQuestions();
    await answerAll(() => "dk");
    // 10 suggested slots, then 20 extras
    for (const slot of [
      "front",
      "back",
      "left",
      "right",
      "ground",
      "roof",
      "column",
      "ceiling",
      "cracks",
      "basement",
    ]) {
      await press(`photo-${slot}-library`);
    }
    for (let i = 0; i < 20; i += 1) {
      await press("photo-more-library");
    }
    expect(screen.getByText("Limit reached: 30 photos.")).toBeTruthy();
    expect(
      screen.getByTestId("photo-more-library").props.accessibilityState?.disabled,
    ).toBe(true);
    expect(
      screen.getByTestId("photo-more-camera").props.accessibilityState?.disabled,
    ).toBe(true);
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

  it("the research answers, including the remarks, are saved with the survey", async () => {
    await renderWithProviders(<NewHomeScreen />);
    await press("option-use-mixed");
    await press("flow-next");
    await pressText("Hawler");
    await press("flow-next");
    const picks: Record<string, string> = {
      basement: "part",
      adjacency: "one_side",
      size: "s100_200",
      people: "p6_10",
      structure: "frame",
      floors: "f3",
    };
    await answerAll((id) => picks[id] ?? "dk", "Shop below, big glass front.");
    await press("flow-next");
    expect(
      screen.getByLabelText(
        /Anything else you want to tell us.*Shop below, big glass front\./,
      ),
    ).toBeTruthy();
    await press("flow-submit");
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    const survey = mockTransport.saveSurvey.mock.calls[0]?.[0];
    expect(survey.version).toBe("q-v3");
    expect(survey.answers).toMatchObject({
      use: "mixed",
      basement: "part",
      adjacency: "one_side",
      size: "s100_200",
      people: "p6_10",
      remarks: "Shop below, big glass front.",
    });
    expect(mockTransport.createTag).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "apartment" }),
    );
  });

  it("the optional size question can be passed without an answer", async () => {
    await renderWithProviders(<NewHomeScreen />);
    await reachQuestions();
    const picks: Record<string, string> = { structure: "frame", people: "p3_5" };
    // Stop at the size question (no option is picked for it).
    await answerAll((id) => (id === "size" ? "skip" : (picks[id] ?? "dk")));
    expect(screen.getByText(/Roughly how big is one floor/)).toBeTruthy();
    expect(nextDisabled()).toBe(false);
    expect(screen.getByText("Skip")).toBeTruthy();
    await press("flow-next");
    // people, then the remarks
    await press("option-people-p3_5");
    await press("flow-next");
    expect(screen.getByTestId("input-remarks")).toBeTruthy();
    await press("flow-next");
    await press("flow-next");
    await press("flow-submit");
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    const survey = mockTransport.saveSurvey.mock.calls[0]?.[0];
    expect(survey.version).toBe("q-v3");
    expect(survey.answers).toMatchObject({
      use: "house_single",
      people: "p3_5",
      structure: "frame",
    });
    expect(survey.answers.size).toBeUndefined();
    expect(survey.answers.remarks).toBeUndefined();
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

  describe("N8: what holds the building up", () => {
    async function reachStructure() {
      await renderWithProviders(<NewHomeScreen />);
      await reachQuestions();
      await answerAll((id) => (id === "structure" ? "__stop__" : "dk"));
    }

    it("shows picture choices with short labels and the corner-column helper", async () => {
      await reachStructure();
      expect(screen.getByText("What holds the building up?")).toBeTruthy();
      expect(screen.getByTestId("helper-structure")).toBeTruthy();
      expect(
        screen.getByText("Look at a corner: is there a concrete column?"),
      ).toBeTruthy();
      for (const label of [
        "Concrete frame",
        "Block walls",
        "Brick walls",
        "Stone walls",
        "Mud walls",
        "Steel frame",
        "Wood",
        "I don't know",
      ]) {
        expect(screen.getByLabelText(label)).toBeTruthy();
      }
      expect(screen.getAllByRole("radio").length).toBeGreaterThanOrEqual(8);
    });

    it("'I don't know' asks whether columns can be seen at the corners", async () => {
      await reachStructure();
      await press("option-structure-dk");
      await press("flow-next");
      expect(
        screen.getByText("Can you see concrete columns at the corners?"),
      ).toBeTruthy();
      await press("option-cornerColumns-yes");
      await press("flow-next");
      // a frame: no belts, no roof question; straight on to the shape-of-building group
      expect(screen.queryByText(/concrete belts/)).toBeNull();
      expect(screen.getByText("Were floors added later on top?")).toBeTruthy();
    });

    it("'no columns' asks for the roof and floors next", async () => {
      await reachStructure();
      await press("option-structure-dk");
      await press("flow-next");
      await press("option-cornerColumns-no");
      await press("flow-next");
      expect(screen.getByText("What are the roof and floors made of?")).toBeTruthy();
    });

    it("a known structure skips the follow-up", async () => {
      await reachStructure();
      await press("option-structure-frame");
      await press("flow-next");
      expect(
        screen.queryByText("Can you see concrete columns at the corners?"),
      ).toBeNull();
    });

    it("the follow-up answer is saved and the assessment follows the frame route", async () => {
      await renderWithProviders(<NewHomeScreen />);
      await reachQuestions();
      await answerAll((id) =>
        id === "structure" ? "dk" : id === "cornerColumns" ? "yes" : "dk",
      );
      await press("flow-next");
      await press("flow-submit");
      await waitFor(() => expect(mockReplace).toHaveBeenCalled());
      const survey = mockTransport.saveSurvey.mock.calls[0]?.[0];
      expect(survey.answers).toMatchObject({ structure: "dk", cornerColumns: "yes" });
      const saved = mockTransport.saveAssessment.mock.calls[0]?.[0];
      expect(
        Object.keys(saved.assessment.ims_type_probs).every((t: string) =>
          t.startsWith("RC1"),
        ),
      ).toBe(true);
    });
  });

  describe("N9: the shape of the building", () => {
    it("shows four picture choices with labels that contain no Latin letters in Sorani", async () => {
      await i18n.changeLanguage("ckb");
      await renderWithProviders(<NewHomeScreen />);
      await press("option-use-house_single");
      await press("flow-next");
      await pressText("هەولێر");
      await press("flow-next");
      await answerAll((id) => (id === "shape" ? "__stop__" : "dk"));
      for (const option of ["box", "irregular", "overhang", "dk"]) {
        const label = screen.getByTestId(`option-shape-${option}`).props
          .accessibilityLabel;
        expect(label).not.toMatch(/[A-Za-z]/);
      }
    });

    it("English labels", async () => {
      await renderWithProviders(<NewHomeScreen />);
      await reachQuestions();
      await answerAll((id) => (id === "shape" ? "__stop__" : "dk"));
      for (const label of [
        "Simple rectangle",
        "A corner or wing sticks out",
        "Upper floors stick out",
        "I don't know",
      ]) {
        expect(screen.getByLabelText(label)).toBeTruthy();
      }
    });
  });

  describe("people wording follows the building type", () => {
    it.each(["house_single", "house_multi", "apartment", "mixed"])(
      "a %s asks how many people live in this home",
      async (use) => {
        await renderWithProviders(<NewHomeScreen />);
        await reachQuestions(use);
        await answerAll((id) => (id === "people" ? "__stop__" : "dk"));
        expect(
          screen.getByText("How many people live in this home? (optional)"),
        ).toBeTruthy();
      },
    );

    it.each(["commercial", "industrial", "public", "other"])(
      "a %s asks how many people are usually inside, with the same bands, and the review says so",
      async (use) => {
        await renderWithProviders(<NewHomeScreen />);
        await reachQuestions(use);
        await answerAll((id) => (id === "people" ? "__stop__" : "dk"));
        expect(
          screen.getByText("How many people are usually inside? (optional)"),
        ).toBeTruthy();
        expect(screen.queryByText(/live in this home/)).toBeNull();
        for (const label of ["1 or 2", "3 to 5", "6 to 10", "More than 10"]) {
          expect(screen.getByText(label)).toBeTruthy();
        }
        await answerAll((id) => (id === "people" ? "p3_5" : "dk"));
        await press("flow-next");
        expect(screen.getByLabelText(/usually inside.*3 to 5/)).toBeTruthy();
      },
    );

    it("the name field no longer says 'house'", async () => {
      await renderWithProviders(<NewHomeScreen />);
      expect(screen.getByPlaceholderText("e.g. My building")).toBeTruthy();
    });

    it("a warehouse saves the use, its occupancy and a house tag", async () => {
      await renderWithProviders(<NewHomeScreen />);
      await reachQuestions("industrial");
      await answerAll(() => "dk");
      await press("flow-next");
      await press("flow-submit");
      await waitFor(() => expect(mockReplace).toHaveBeenCalled());
      expect(mockTransport.createTag).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "house" }),
      );
      expect(mockTransport.saveSurvey.mock.calls[0]?.[0].answers).toMatchObject({
        use: "industrial",
        occupancy: "industrial",
      });
    });
  });

  describe("N10 and N12: people and remarks", () => {
    it("asks once how many people live in the home, optional", async () => {
      await renderWithProviders(<NewHomeScreen />);
      await reachQuestions();
      await answerAll((id) => (id === "people" ? "__stop__" : "dk"));
      expect(
        screen.getByText("How many people live in this home? (optional)"),
      ).toBeTruthy();
      for (const label of [
        "1 or 2",
        "3 to 5",
        "6 to 10",
        "More than 10",
        "I don't know",
      ]) {
        expect(screen.getByLabelText(label)).toBeTruthy();
      }
      expect(screen.queryByText(/during the day|at night/)).toBeNull();
      expect(nextDisabled()).toBe(false);
      expect(screen.getByText("Skip")).toBeTruthy();
    });

    it("the last question is an optional remark with a gentle hint about phone numbers", async () => {
      await renderWithProviders(<NewHomeScreen />);
      await reachQuestions();
      // stop on the remarks screen by answering the choices only
      for (
        let guard = 0;
        guard < 30 && !screen.queryByTestId("input-remarks");
        guard += 1
      ) {
        const id = QUESTIONS.map((q) => q.id).find((q) =>
          screen.queryByTestId(`option-${q}-dk`),
        );
        if (!id) break;
        await press(`option-${id}-dk`);
        await press("flow-next");
      }
      expect(
        screen.getByText("Anything else you want to tell us about this building?"),
      ).toBeTruthy();
      expect(
        screen.getByText("Optional. Please do not write phone numbers."),
      ).toBeTruthy();
      const input = screen.getByTestId("input-remarks");
      expect(input.props.maxLength).toBe(1000);
      expect(input.props.multiline).toBe(true);
      expect(nextDisabled()).toBe(false);
      expect(screen.getByText("Skip")).toBeTruthy();
      expect(screen.getByText("0 of 1000 characters")).toBeTruthy();
      await act(async () => {
        fireEvent.changeText(input, "A crack by the stairs");
      });
      expect(screen.getByText("Next")).toBeTruthy();
      expect(screen.getByText("21 of 1000 characters")).toBeTruthy();
    });
  });

  describe("place on map", () => {
    async function openPinMap() {
      await renderWithProviders(<NewHomeScreen />);
      await press("option-use-house_single");
      await press("flow-next");
      await press("location-pin");
    }

    it("offers the map as a third choice next to GPS and towns", async () => {
      await renderWithProviders(<NewHomeScreen />);
      await press("option-use-house_single");
      await press("flow-next");
      expect(screen.getByTestId("location-gps")).toBeTruthy();
      expect(screen.getByTestId("location-pin")).toBeTruthy();
      expect(screen.getByText("Hawler")).toBeTruthy();
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
      // no home-type screen on a retake: straight to the floors question
      expect(await screen.findByText("How many floors above the ground?")).toBeTruthy();
      expect(screen.queryByText("What kind of building is it?")).toBeNull();
      expect(
        screen.getByTestId("option-floors-f3").props.accessibilityState.selected,
      ).toBe(true);
      expect(screen.queryByTestId("kind-house")).toBeNull();
    });

    it("a q-v1 survey loads: its answers are selected, 'night' becomes 'live here', and it saves as q-v3", async () => {
      mockTransport.fetchLatestSurvey.mockResolvedValue({
        surveyId: "survey-8",
        tagId: "tag-1",
        version: "q-v1",
        answers: {
          use: "mixed",
          floors: "f2",
          basement: "none",
          age: "a25_50",
          builder: "builder",
          structure: "frame",
          added: "no",
          openGround: "yes",
          shape: "irregular",
          adjacency: "one_side",
          strengthened: "no",
          cracks: "none",
          pastDamage: "none",
          size: "s100_200",
          peopleDay: "p21p",
          peopleNight: "p11_20",
          location_quality: "gps",
        },
        createdAt: "2026-10-04T10:00:00Z",
      });
      await renderWithProviders(<NewHomeScreen tagId="tag-1" />);
      await screen.findByText("How many floors above the ground?");
      for (
        let guard = 0;
        guard < 30 && !screen.queryByText("Check your answers");
        guard += 1
      ) {
        await press("flow-next");
      }
      expect(screen.getByLabelText(/live in this home.*More than 10/)).toBeTruthy();
      expect(
        screen.getByLabelText(/What is the shape\?: A corner or wing sticks out/),
      ).toBeTruthy();
      expect(
        screen.getByLabelText(/What holds the building up\?: Concrete frame/),
      ).toBeTruthy();
      await press("flow-submit");
      await waitFor(() => expect(mockReplace).toHaveBeenCalled());
      const survey = mockTransport.saveSurvey.mock.calls[0]?.[0];
      expect(survey.version).toBe("q-v3");
      expect(survey.answers).toMatchObject({
        use: "mixed",
        people: "p11p",
        shape: "irregular",
      });
      expect(survey.answers.peopleNight).toBeUndefined();
      expect(survey.answers.peopleDay).toBeUndefined();
    });

    it("saves a new survey and assessment for the same tag", async () => {
      await renderWithProviders(<NewHomeScreen tagId="tag-1" />);
      await screen.findByText("How many floors above the ground?");
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
    expect(screen.getByText("بیناکە چ جۆرێکە؟")).toBeTruthy();
    expect(screen.queryByText(/building\./)).toBeNull();
    await press("option-use-house_single");
    await press("flow-next");
    await pressText("هەولێر");
    await press("flow-next");
    expect(screen.getByText("چەند نهۆم لەسەر زەوییە؟")).toBeTruthy();
    expect(screen.getByText("نازانم")).toBeTruthy();
  });

  it.each(["ckb", "kmr", "ar"])(
    "walks the whole flow in %s without a raw key on any screen",
    async (locale) => {
      await i18n.changeLanguage(locale);
      await renderWithProviders(<NewHomeScreen />);
      const noRawKeys = () => expect(screen.queryByText(/building\.[a-zA-Z]/)).toBeNull();
      noRawKeys();
      await press("option-use-apartment");
      noRawKeys();
      await press("flow-next");
      noRawKeys();
      await press("location-gps");
      await press("flow-next");
      for (
        let guard = 0;
        guard < 30 && !screen.queryByTestId("input-remarks");
        guard += 1
      ) {
        const id = QUESTIONS.map((q) => q.id).find((q) =>
          screen.queryByTestId(`option-${q}-dk`),
        );
        if (!id) break;
        noRawKeys();
        await press(`option-${id}-dk`);
        await press("flow-next");
      }
      noRawKeys();
      await press("flow-next"); // remarks -> photos
      noRawKeys();
      await press("flow-next"); // photos -> review
      noRawKeys();
    },
  );
});
