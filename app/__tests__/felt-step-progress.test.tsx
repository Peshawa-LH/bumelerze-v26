import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  enqueueTier1Report,
  TIER2_QUESTIONS,
  useFeltQueueStore,
  useTier2DraftStore,
  type FeltLocation,
} from "@/features/felt";
import i18n from "@/i18n";

/**
 * A-13: the "Add more detail" questionnaire shows where the reader is
 * ("Step 1 of 9") and never asks "Did you feel the earthquake?" again when
 * window 1 already recorded how strongly it was felt — that answer is
 * written into the draft and the question is stepped over. Without a
 * window-1 pick (the standalone path) the question is still asked.
 */
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();

const routeParams: { step: string; feltReportId: string; eventId?: string } = {
  step: "0",
  feltReportId: "unset",
  eventId: "evt-1",
};

jest.mock("expo-router", () => ({
  useNavigation: () => ({
    getParent: () => ({ canGoBack: () => true, goBack: jest.fn() }),
  }),
  useLocalSearchParams: () => routeParams,
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    canGoBack: () => true,
  }),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: () => {
    const g = globalThis as { __progressTestUuidCounter?: number };
    g.__progressTestUuidCounter = (g.__progressTestUuidCounter ?? 0) + 1;
    return `progress-test-uuid-${g.__progressTestUuidCounter}`;
  },
}));

// eslint-disable-next-line import/first -- after the mocks above, see comment
import Tier2StepScreen from "../felt-report/step/[step]";

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderWithProviders(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

const SAMPLE_LOCATION: FeltLocation = { quality: "gps", lat: 36.19, lon: 44.01 };
const FELT_INDEX = TIER2_QUESTIONS.findIndex((question) => question.field === "felt");

describe("Questionnaire progress and the pre-answered felt question (A-13)", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    mockPush.mockClear();
    mockReplace.mockClear();
    useFeltQueueStore.setState({ items: [] });
    useTier2DraftStore.getState().reset();
    routeParams.step = "0";
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("the felt question is the second science-pack question", () => {
    expect(FELT_INDEX).toBe(1);
  });

  it("shows 'Step 1 of 9' on the first question when window 1 already recorded a felt level", async () => {
    const tier1 = await enqueueTier1Report({
      cartoonLevel: 6,
      location: SAMPLE_LOCATION,
      eventId: "evt-1",
    });
    routeParams.feltReportId = tier1.reportId;

    await act(async () => {
      renderWithProviders(<Tier2StepScreen />);
    });

    expect(screen.getByText("Step 1 of 9")).toBeTruthy();
    expect(screen.getByText(i18n.t("felt.tier2.questions.situation.title"))).toBeTruthy();
  });

  it("answering the first question steps over the felt question, recording the window-1 answer", async () => {
    const tier1 = await enqueueTier1Report({
      cartoonLevel: 6,
      location: SAMPLE_LOCATION,
      eventId: "evt-1",
    });
    routeParams.feltReportId = tier1.reportId;

    await act(async () => {
      renderWithProviders(<Tier2StepScreen />);
    });
    await act(async () => {
      fireEvent.press(screen.getByText(i18n.t("felt.tier2.questions.situation.options.inside")));
      await Promise.resolve();
    });

    expect(useTier2DraftStore.getState().answers.situation).toBe("inside");
    // Level 6 ("Strong shaking") means yes, it was felt.
    expect(useTier2DraftStore.getState().answers.felt).toBe("yes");
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/felt-report/step/[step]",
        params: expect.objectContaining({ step: String(FELT_INDEX + 1) }),
      }),
    );
  });

  it("records 'no' for the 'Not felt' level (1) and still skips the question", async () => {
    const tier1 = await enqueueTier1Report({
      cartoonLevel: 1,
      location: SAMPLE_LOCATION,
      eventId: "evt-1",
    });
    routeParams.feltReportId = tier1.reportId;

    await act(async () => {
      renderWithProviders(<Tier2StepScreen />);
    });
    await act(async () => {
      fireEvent.press(screen.getByText(i18n.t("felt.tier2.questions.situation.options.outside")));
      await Promise.resolve();
    });

    expect(useTier2DraftStore.getState().answers.felt).toBe("no");
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ step: "2" }) }),
    );
  });

  it("landing directly on the felt step redirects past it when the level is known", async () => {
    const tier1 = await enqueueTier1Report({
      cartoonLevel: 4,
      location: SAMPLE_LOCATION,
      eventId: "evt-1",
    });
    routeParams.feltReportId = tier1.reportId;
    routeParams.step = String(FELT_INDEX);

    await act(async () => {
      renderWithProviders(<Tier2StepScreen />);
    });

    expect(screen.queryByText(i18n.t("felt.tier2.questions.felt.title"))).toBeNull();
    expect(useTier2DraftStore.getState().answers.felt).toBe("yes");
    expect(mockReplace).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ step: String(FELT_INDEX + 1) }) }),
    );
  });

  it("keeps asking the felt question, with 10 steps, when no window-1 level exists (standalone path)", async () => {
    routeParams.feltReportId = "report-without-tier1";
    routeParams.step = String(FELT_INDEX);

    await act(async () => {
      renderWithProviders(<Tier2StepScreen />);
    });

    expect(screen.getByText(i18n.t("felt.tier2.questions.felt.title"))).toBeTruthy();
    expect(screen.getByText("Step 2 of 10")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("renders the progress line in Sorani digits", async () => {
    await i18n.changeLanguage("ckb");
    const tier1 = await enqueueTier1Report({
      cartoonLevel: 6,
      location: SAMPLE_LOCATION,
      eventId: "evt-1",
    });
    routeParams.feltReportId = tier1.reportId;

    await act(async () => {
      renderWithProviders(<Tier2StepScreen />);
    });

    expect(screen.getByText("هەنگاوی ١ لە ٩")).toBeTruthy();
  });
});
