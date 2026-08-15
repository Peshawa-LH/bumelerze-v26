import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { enqueueTier1Report, useFeltQueueStore } from "../";
import type { FeltLocation } from "../types";

/**
 * Shared completion screen (2026-08-15 flow restructure, owner directive)
 * — reached from either window 3's Submit or the questionnaire's last
 * step. Subscribes to the same report's live queue state, same
 * queued/sent wording the old tier-1 confirmation screen used.
 */

const mockBack = jest.fn();
const mockCanDismiss = jest.fn(() => false);
const mockDismiss = jest.fn();
const routeParams = { feltReportId: "unset", eventId: "evt-1" };

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => routeParams,
  useRouter: () => ({
    back: mockBack,
    canDismiss: mockCanDismiss,
    dismiss: mockDismiss,
  }),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: () => {
    const g = globalThis as { __doneTestUuidCounter?: number };
    g.__doneTestUuidCounter = (g.__doneTestUuidCounter ?? 0) + 1;
    return `test-done-uuid-${g.__doneTestUuidCounter}`;
  },
}));

// eslint-disable-next-line import/first -- after the mocks above, see comment
import FeltReportDoneScreen from "../../../../app/felt-report/done";

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

describe("Shared done screen", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    mockBack.mockClear();
    mockCanDismiss.mockClear();
    mockDismiss.mockClear();
    useFeltQueueStore.setState({ items: [] });
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("shows the queued message while the report hasn't reached a real backend (PendingTransport, no Supabase project this wave)", async () => {
    const tier1 = await enqueueTier1Report({
      cartoonLevel: 4,
      location: SAMPLE_LOCATION,
      eventId: "evt-1",
    });
    routeParams.feltReportId = tier1.reportId;

    await act(async () => {
      renderWithProviders(<FeltReportDoneScreen />);
    });

    expect(screen.getByText(i18n.t("felt.done.title"))).toBeTruthy();
    expect(screen.getByText(i18n.t("felt.done.queuedMessage"))).toBeTruthy();
  });

  it("Close dismisses the modal", async () => {
    const tier1 = await enqueueTier1Report({
      cartoonLevel: 4,
      location: SAMPLE_LOCATION,
      eventId: "evt-1",
    });
    routeParams.feltReportId = tier1.reportId;
    mockCanDismiss.mockReturnValue(true);

    await act(async () => {
      renderWithProviders(<FeltReportDoneScreen />);
    });

    fireEvent.press(screen.getByRole("button", { name: i18n.t("felt.done.close") }));
    expect(mockDismiss).toHaveBeenCalled();
  });
});
