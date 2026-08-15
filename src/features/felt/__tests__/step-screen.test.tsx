import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import {
  enqueueTier1Report,
  TIER2_QUESTIONS,
  useFeltQueueStore,
  useTier2DraftStore,
} from "../";
import type { FeltLocation } from "../types";

/**
 * "Add more detail" questionnaire (Q1-Q9 + Q11, Q10 removed — 2026-08-15
 * flow restructure, owner directive). Reached only from window 3; the last
 * question submits directly (no separate comment step anymore) and hands
 * off to the shared `done` screen.
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
    const g = globalThis as { __stepTestUuidCounter?: number };
    g.__stepTestUuidCounter = (g.__stepTestUuidCounter ?? 0) + 1;
    return `test-step-uuid-${g.__stepTestUuidCounter}`;
  },
}));

// eslint-disable-next-line import/first -- after the mocks above, see comment
import Tier2StepScreen from "../../../../app/felt-report/step/[step]";

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

describe("Questionnaire step screen (Q1-Q9 + Q11, Q10 removed)", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    mockPush.mockClear();
    mockReplace.mockClear();
    useFeltQueueStore.setState({ items: [] });
    useTier2DraftStore.getState().reset();
    const tier1 = await enqueueTier1Report({
      cartoonLevel: 6,
      location: SAMPLE_LOCATION,
      eventId: "evt-1",
    });
    routeParams.feltReportId = tier1.reportId;
    routeParams.step = "0";
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("has exactly 10 questions and never shows a building-damage question (window 2 supersedes it)", () => {
    expect(TIER2_QUESTIONS).toHaveLength(10);
    // `buildingDamageLevel` isn't even in `Tier2QuestionDef["field"]`'s type
    // anymore (see questions.ts) — this cast-through-string check keeps
    // that fact provable at the value level too, without a `@ts-expect-
    // error` the compiler would otherwise force on a same-typed comparison.
    const fields: string[] = TIER2_QUESTIONS.map((q) => q.field);
    expect(fields).not.toContain("buildingDamageLevel");
  });

  it("step 0 renders Q1 (situation) — the science-pack question order is unchanged", async () => {
    await act(async () => {
      renderWithProviders(<Tier2StepScreen />);
    });

    expect(screen.getByText(i18n.t("felt.tier2.questions.situation.title"))).toBeTruthy();
  });

  it("the last step (index 9) is Q11 (road damage), keyed stably as roadDamageLevel", async () => {
    routeParams.step = "9";
    await act(async () => {
      renderWithProviders(<Tier2StepScreen />);
    });

    expect(
      screen.getByText(i18n.t("felt.tier2.questions.roadDamageLevel.title")),
    ).toBeTruthy();
  });

  it("answering the last question submits the accumulated draft and navigates to the shared done screen", async () => {
    // Seed window 2/3 answers into the draft, as if the user had already
    // walked through damage + comment before reaching "add more detail".
    useTier2DraftStore.getState().initDraft(routeParams.feltReportId, "evt-1");
    useTier2DraftStore.getState().setAnswer("buildingDamageLevel", 3);
    useTier2DraftStore.getState().setAnswer("damageTypology", "lowrise");
    useTier2DraftStore.getState().setAnswer("comment", "Books fell off the shelf.");
    useTier2DraftStore.getState().setPhotoUri("file:///tmp/damage.jpg");

    routeParams.step = "9";
    await act(async () => {
      renderWithProviders(<Tier2StepScreen />);
    });

    const firstOption = TIER2_QUESTIONS[9]?.options[0];
    const optionLabel = i18n.t(
      `felt.tier2.questions.roadDamageLevel.options.${firstOption}`,
    );
    await act(async () => {
      fireEvent.press(screen.getByText(optionLabel));
      await Promise.resolve();
      await Promise.resolve();
    });

    const items = useFeltQueueStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.tier2?.answers.roadDamageLevel).toBe(0);
    // The full draft (windows 2/3 + this question) all rode along in the
    // SAME submission — nothing from earlier in the flow was lost.
    expect(items[0]?.tier2?.answers.buildingDamageLevel).toBe(3);
    expect(items[0]?.tier2?.answers.damageTypology).toBe("lowrise");
    expect(items[0]?.tier2?.answers.comment).toBe("Books fell off the shelf.");
    expect(items[0]?.tier2?.photoUri).toBe("file:///tmp/damage.jpg");

    expect(mockReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/felt-report/done",
        params: expect.objectContaining({ feltReportId: routeParams.feltReportId }),
      }),
    );
    expect(useTier2DraftStore.getState().feltReportId).toBeNull();
  });

  it("Skip on the last question still submits (every question is independently skippable)", async () => {
    useTier2DraftStore.getState().initDraft(routeParams.feltReportId, "evt-1");
    routeParams.step = "9";
    await act(async () => {
      renderWithProviders(<Tier2StepScreen />);
    });

    await act(async () => {
      fireEvent.press(screen.getByText(i18n.t("felt.tier2.skip")));
      await Promise.resolve();
      await Promise.resolve();
    });

    const items = useFeltQueueStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.tier2?.answers.roadDamageLevel).toBeNull();
    expect(mockReplace).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/felt-report/done" }),
    );
  });
});
