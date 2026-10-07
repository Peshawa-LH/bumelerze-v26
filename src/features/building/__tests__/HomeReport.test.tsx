import { act, cleanup, fireEvent, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import {
  collectText,
  ROMAN_NUMERAL,
} from "@/features/shakemap/__fixtures__/roman-numerals";
import { useHomePhotoQueueStore } from "../photo-queue";
import { expectedDamageTable } from "../assessment";
import { HomeReportScreen } from "../components/HomeReport";
import {
  ANSWERS,
  TAG,
  clearQueryClients,
  member,
  mockTransport,
  renderWithProviders,
  resetMockTransport,
  storedAssessment,
} from "../__fixtures__/testing";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
  }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: jest.fn(),
  messageDialog: jest.fn(),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
let mockAccount: { status: string; userId: string | null } = {
  status: "account",
  userId: "u-owner",
};
jest.mock("@/features/account/use-account", () => ({ useAccount: () => mockAccount }));
jest.mock("../transport", () => ({
  ...jest.requireActual("../transport"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  SupabaseHomeTransport: require("../__fixtures__/testing").mockTransport,
}));

function load(assessment = storedAssessment()) {
  mockTransport.fetchTags.mockResolvedValue([TAG]);
  mockTransport.fetchMemberships.mockResolvedValue([
    member("u-owner", { role: "owner" }),
  ]);
  mockTransport.fetchLatestAssessments.mockResolvedValue(
    assessment ? { "tag-1": assessment } : {},
  );
}

describe("Building report", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetMockTransport();
    mockAccount = { status: "account", userId: "u-owner" };
    load();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(async () => {
    cleanup();
    await clearQueryClients();
  });

  it("shows the tag code, the big class badge and what it means", async () => {
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    expect(await screen.findByText(/BMH-7K3Q9P/)).toBeTruthy();
    expect(screen.getByText("Our house")).toBeTruthy();
    const badge = screen.getByTestId("report-vc-badge");
    const vc = storedAssessment().vcMostLikely;
    expect(badge.props.accessibilityLabel).toBe(`Vulnerability class ${vc}`);
    expect(vc).toBe("A");
    expect(screen.getByText("Most vulnerable")).toBeTruthy();
    expect(
      screen.getByText(/Heavy damage is likely in a strong earthquake/),
    ).toBeTruthy();
  });

  it("gives the likely range and the confidence", async () => {
    const assessment = storedAssessment(ANSWERS, {
      vcRange: "A–B".replace("–", "-"),
      confidence: 0.67,
    });
    load(assessment);
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    expect(await screen.findByTestId("report-range")).toBeTruthy();
    expect(screen.getByText(/Likely range: A–B/)).toBeTruthy();
    expect(screen.getByText(/Confidence: .*67%/)).toBeTruthy();
  });

  describe("non-residential buildings", () => {
    const NOTE = "Estimate based on typical homes; this building's use may change it.";
    const survey = (answers: Record<string, string>) =>
      mockTransport.fetchLatestSurvey.mockResolvedValue({
        surveyId: "survey-1",
        tagId: "tag-1",
        version: "q-v3",
        answers,
        createdAt: "2026-10-04T10:00:00Z",
      });

    it.each(["commercial", "industrial", "public", "other"])(
      "a %s building gets the short note and the same confidence",
      async (use) => {
        survey({ ...ANSWERS, use, occupancy: use });
        const assessment = storedAssessment(ANSWERS, { confidence: 0.67 });
        load(assessment);
        await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
        expect(await screen.findByText(NOTE)).toBeTruthy();
        expect(screen.getByTestId("report-nonresidential-note")).toBeTruthy();
        expect(screen.getByText(/Confidence: .*67%/)).toBeTruthy();
      },
    );

    it.each(["house_single", "house_multi", "apartment", "mixed"])(
      "a %s building gets no note",
      async (use) => {
        survey({ ...ANSWERS, use, occupancy: "residential" });
        await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
        await screen.findByTestId("report-vc");
        expect(screen.queryByText(NOTE)).toBeNull();
      },
    );

    it("a q-v1 or q-v2 survey (shop_below, house) and a survey without a type get no note", async () => {
      for (const answers of [
        { ...ANSWERS, use: "shop_below" },
        { ...ANSWERS, use: "house" },
        { ...ANSWERS },
      ]) {
        survey(answers);
        await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
        await screen.findByTestId("report-vc");
        expect(screen.queryByText(NOTE)).toBeNull();
        cleanup();
        await clearQueryClients();
      }
    });

    it("the note is translated", async () => {
      await i18n.changeLanguage("ckb");
      survey({ ...ANSWERS, use: "commercial" });
      await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
      expect(await screen.findByTestId("report-nonresidential-note")).toBeTruthy();
      expect(screen.queryByText(/building\.report/)).toBeNull();
    });
  });

  it("omits the range line when the class is certain", async () => {
    load(storedAssessment(ANSWERS, { vcRange: "A" }));
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    await screen.findByTestId("report-vc");
    expect(screen.queryByTestId("report-range")).toBeNull();
  });

  it("describes the building type in plain words with the IMS code as a small line", async () => {
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    expect(
      await screen.findByText("Brick or block walls with concrete floors"),
    ).toBeTruthy();
    expect(
      screen.getByText(/Could also be: Brick or block walls held by concrete belts/),
    ).toBeTruthy();
    expect(screen.getByText("IMS-25 type: M6")).toBeTruthy();
  });

  it("shows the ground, the design PGA and its source", async () => {
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    expect(
      await screen.findByText(/Ground: class B, Vs30 about .*410.* m\/s/),
    ).toBeTruthy();
    expect(screen.getByText(/Design PGA: .*0\.31.* g \(zone III\)/)).toBeTruthy();
    expect(screen.getByText("Source: ISC-2025")).toBeTruthy();
  });

  it("says so when the place has no hazard data", async () => {
    load(
      storedAssessment(ANSWERS, {
        hazard: {
          pga_g: null,
          zone: null,
          vs30: null,
          site_class: null,
          source: "ISC-2025",
        },
      }),
    );
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    expect(await screen.findByText("No ground data for this place.")).toBeTruthy();
    expect(screen.getByText("This place is outside the design map.")).toBeTruthy();
  });

  it("lists expected damage at intensity VI, VII and VIII in plain words", async () => {
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    await screen.findByTestId("report-damage");
    expect(screen.getByTestId("damage-VI")).toBeTruthy();
    expect(screen.getByTestId("damage-VII")).toBeTruthy();
    expect(screen.getByTestId("damage-VIII")).toBeTruthy();
    expect(screen.getByText("Intensity VII (very strong shaking)")).toBeTruthy();
    // class A, from the IMS-25 damage logic
    expect(expectedDamageTable("A")[1]?.damage).toEqual([
      { grade: 3, quantity: "many" },
      { grade: 4, quantity: "few" },
    ]);
    expect(screen.getByText("Many buildings like yours: heavy damage")).toBeTruthy();
    expect(
      screen.getByText("A few buildings like yours: very heavy damage"),
    ).toBeTruthy();
    expect(screen.getByText("Many buildings like yours: slight damage")).toBeTruthy();
  });

  it.each([
    ["ckb", "٧"],
    ["ar", "٧"],
    ["kmr", "VII"],
  ])("prints the intensity in %s as %s", async (code, level) => {
    await i18n.changeLanguage(code);
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    await screen.findByTestId("report-damage");
    const texts = collectText(screen.getByTestId("damage-VII").parent);
    expect(texts.some((text) => text.includes(level))).toBe(true);
    expect(texts.some((text) => ROMAN_NUMERAL.test(text))).toBe(code === "kmr");
  });

  it("says 'little or no damage' for a strong class", async () => {
    load(storedAssessment({ structure: "frame", builder: "eng_full", age: "under10" }));
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    await screen.findByTestId("report-damage");
    expect(screen.getAllByText("Little or no damage expected.").length).toBeGreaterThan(
      0,
    );
  });

  it("gives three tips for the building family", async () => {
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    await screen.findByTestId("report-tips");
    expect(screen.getByText(/Ask an engineer about concrete tie beams/)).toBeTruthy();
    expect(
      screen.getByText(/Never add floors or remove walls without an engineer/),
    ).toBeTruthy();
    expect(screen.getByText(/Have large cracks checked and repaired/)).toBeTruthy();
  });

  it("gives frame tips for a concrete frame", async () => {
    load(storedAssessment({ structure: "frame", age: "over50", builder: "self" }));
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    expect(
      await screen.findByText(/check the ground-floor columns and walls/),
    ).toBeTruthy();
    expect(screen.getByText("Concrete frame")).toBeTruthy();
  });

  it("says the report is automatic, and shows a reviewed one differently", async () => {
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    expect(
      await screen.findByText("Automatically generated. Engineer review is coming soon."),
    ).toBeTruthy();
    cleanup();
    await clearQueryClients();
    load(storedAssessment(ANSWERS, { reviewStatus: "engineer_reviewed" }));
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    expect(await screen.findByText("Reviewed by an engineer.")).toBeTruthy();
  });

  it("opens the family screen, the retake and the safety guides", async () => {
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    await screen.findByTestId("report-vc");
    await act(async () => {
      fireEvent.press(screen.getByTestId("report-family"));
    });
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/home/[tagId]/family",
      params: { tagId: "tag-1" },
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("report-retake"));
    });
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/home/new",
      params: { tagId: "tag-1" },
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("report-safety"));
    });
    expect(mockPush).toHaveBeenCalledWith("/safety");
  });

  it("shows the home's photos when there are any", async () => {
    mockTransport.fetchPhotos.mockResolvedValue([
      { url: "https://signed/1", slot: "front", caption: null, fileName: "front-1.jpg" },
      { url: "https://signed/2", slot: "more", caption: "Crack", fileName: "more-2.jpg" },
    ]);
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    expect(await screen.findByTestId("report-photos")).toBeTruthy();
    // a suggested slot is named by its slot, an extra by its caption
    expect(screen.getByText("Front")).toBeTruthy();
    expect(screen.getByText("Crack")).toBeTruthy();
  });

  it("says photos are still uploading while any wait in the queue", async () => {
    useHomePhotoQueueStore.getState()._clear();
    useHomePhotoQueueStore.getState()._add([
      {
        id: "p1",
        tagId: "tag-1",
        uri: "file://a.jpg",
        slot: "front",
        caption: "",
        fileName: "front-1.jpg",
        createdAt: 1,
        failures: 0,
        attempts: 0,
        nextRetryAt: null,
      },
    ]);
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    expect(await screen.findByTestId("report-photos-uploading")).toBeTruthy();
    expect(screen.getByText("Uploading photos…")).toBeTruthy();
    useHomePhotoQueueStore.getState()._clear();
  });

  it("the owner finds 'Delete this home' at the foot of the report", async () => {
    load();
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    await screen.findByTestId("report-vc");
    expect(screen.getByTestId("home-delete")).toBeTruthy();
    expect(screen.getByText("Delete this home")).toBeTruthy();
  });

  it("the owner also finds it before the questions are answered", async () => {
    load(null as never);
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    await screen.findByText("No report yet.");
    expect(screen.getByTestId("home-delete")).toBeTruthy();
  });

  it("a family member does not see Delete", async () => {
    load();
    mockAccount = { status: "account", userId: "u-2" };
    mockTransport.fetchMemberships.mockResolvedValue([member("u-2")]);
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    await screen.findByTestId("report-vc");
    expect(screen.queryByTestId("home-delete")).toBeNull();
    expect(screen.queryByText("Delete this home")).toBeNull();
  });

  it("invites the questions when there is no assessment yet", async () => {
    mockTransport.fetchLatestAssessments.mockResolvedValue({});
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    expect(await screen.findByText("No report yet.")).toBeTruthy();
    expect(screen.getByText("Answer the questions")).toBeTruthy();
    expect(screen.queryByTestId("report-vc")).toBeNull();
  });

  it("says so when the home is not visible to this account", async () => {
    mockTransport.fetchTags.mockResolvedValue([]);
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    expect(await screen.findByText("This home is not available.")).toBeTruthy();
  });

  it("an anonymous user sees the account card", async () => {
    mockAccount = { status: "anonymous", userId: "a1" };
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    expect(screen.getByText("Create an account to tag your home.")).toBeTruthy();
    expect(mockTransport.fetchTags).not.toHaveBeenCalled();
  });

  it.each([
    ["ckb", "ڕاپۆرتی بینا"],
    ["kmr", "Raporta avahiyê"],
    ["ar", "تقرير المبنى"],
  ])("renders fully translated in %s, without raw keys", async (locale, title) => {
    await i18n.changeLanguage(locale);
    await renderWithProviders(<HomeReportScreen tagId="tag-1" />);
    await screen.findByTestId("report-vc");
    expect(screen.queryByText(/building\.[a-z]/i)).toBeNull();
    expect(screen.getByTestId("report-damage")).toBeTruthy();
    expect(screen.getByTestId("report-tips")).toBeTruthy();
    // the header title is set through the stack; the section titles are visible
    expect(screen.getAllByText(/\S/).length).toBeGreaterThan(10);
    expect(title.length).toBeGreaterThan(0);
  });
});
