import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { enqueueTier1Report, useFeltQueueStore, useTier2DraftStore } from "../";
import type { FeltLocation } from "../types";

/**
 * Window 3 — comment + photo + "add more detail" + Submit (2026-08-15 flow
 * restructure, owner directive). Photo capture is mocked at the
 * `expo-image-picker` boundary (wave brief scope item 6: "photo attach
 * (mocked picker)") — no real native module or filesystem I/O in tests.
 */

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCanDismiss = jest.fn(() => false);
const mockDismiss = jest.fn();

// Mutable so each test can point the mocked route params at whatever real
// tier-1 report id `beforeEach` actually created (enqueueTier2Report throws
// for an unknown feltReportId, so this must be a real queued id, not a
// fixed literal).
const routeParams = { feltReportId: "unset", eventId: "evt-1" };

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => routeParams,
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    canDismiss: mockCanDismiss,
    dismiss: mockDismiss,
  }),
}));

const mockLaunchImageLibraryAsync = jest.fn();
jest.mock("expo-image-picker", () => ({
  MediaTypeOptions: { Images: "Images" },
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: () => {
    const g = globalThis as { __detailsTestUuidCounter?: number };
    g.__detailsTestUuidCounter = (g.__detailsTestUuidCounter ?? 0) + 1;
    return `test-details-uuid-${g.__detailsTestUuidCounter}`;
  },
}));

// eslint-disable-next-line import/first -- after the mocks above, see comment
import DetailsReportScreen from "../../../../app/felt-report/details";

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

describe("Window 3 — details screen (comment + photo + submit)", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    mockPush.mockClear();
    mockReplace.mockClear();
    mockLaunchImageLibraryAsync.mockReset();
    useFeltQueueStore.setState({ items: [] });
    useTier2DraftStore.getState().reset();
    // A real queued tier-1 report to upgrade, same as window 1 would have
    // produced (enqueueTier2Report throws for an unknown feltReportId).
    const tier1 = await enqueueTier1Report({
      cartoonLevel: 5,
      location: SAMPLE_LOCATION,
      eventId: "evt-1",
    });
    routeParams.feltReportId = tier1.reportId;
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("adding a photo shows a preview and a remove option; removing clears it", async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///tmp/damage.jpg" }],
    });

    await act(async () => {
      renderWithProviders(<DetailsReportScreen />);
    });

    const addButton = screen.getByRole("button", {
      name: i18n.t("felt.details.photo.addLabel"),
    });
    await act(async () => {
      fireEvent.press(addButton);
    });

    expect(useTier2DraftStore.getState().photoUri).toBe("file:///tmp/damage.jpg");
    expect(
      screen.getByRole("button", { name: i18n.t("felt.details.photo.removeLabel") }),
    ).toBeTruthy();

    fireEvent.press(
      screen.getByRole("button", { name: i18n.t("felt.details.photo.removeLabel") }),
    );
    expect(useTier2DraftStore.getState().photoUri).toBeNull();
  });

  it("a canceled picker leaves the draft photo untouched", async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });

    await act(async () => {
      renderWithProviders(<DetailsReportScreen />);
    });

    const addButton = screen.getByRole("button", {
      name: i18n.t("felt.details.photo.addLabel"),
    });
    await act(async () => {
      fireEvent.press(addButton);
    });

    expect(useTier2DraftStore.getState().photoUri).toBeNull();
  });

  it("Submit upgrades the same queue item in place (comment + photo), then navigates to the shared done screen", async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///tmp/damage.jpg" }],
    });

    await act(async () => {
      renderWithProviders(<DetailsReportScreen />);
    });

    const commentInput = screen.getByPlaceholderText(
      i18n.t("felt.details.commentPlaceholder"),
    );
    await act(async () => {
      fireEvent.changeText(commentInput, "  Wall cracked near the window.  ");
    });

    const addButton = screen.getByRole("button", {
      name: i18n.t("felt.details.photo.addLabel"),
    });
    await act(async () => {
      fireEvent.press(addButton);
    });

    const submitButton = screen.getByRole("button", {
      name: i18n.t("felt.tier2.submit"),
    });
    await act(async () => {
      fireEvent.press(submitButton);
      await Promise.resolve();
      await Promise.resolve();
    });

    const items = useFeltQueueStore.getState().items;
    // Still ONE queue item — the upgrade superseded the tier-1 record in
    // place rather than creating a second one (D18 §3.2 supersede
    // semantics, extended to windows 2/3 by the 2026-08-15 directive).
    expect(items).toHaveLength(1);
    expect(items[0]?.tier2?.answers.comment).toBe("Wall cracked near the window.");
    expect(items[0]?.tier2?.photoUri).toBe("file:///tmp/damage.jpg");

    expect(mockReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/felt-report/done",
        params: expect.objectContaining({ eventId: "evt-1" }),
      }),
    );

    // The draft is cleared after a successful submit, same as the old
    // tier-2 comment screen used to do.
    expect(useTier2DraftStore.getState().feltReportId).toBeNull();
  });

  it("'Add more detail' commits the in-progress comment to the draft before navigating to the questionnaire", async () => {
    await act(async () => {
      renderWithProviders(<DetailsReportScreen />);
    });

    const commentInput = screen.getByPlaceholderText(
      i18n.t("felt.details.commentPlaceholder"),
    );
    await act(async () => {
      fireEvent.changeText(commentInput, "Books fell off the shelf.");
    });

    const addMoreDetailButton = screen.getByRole("button", {
      name: i18n.t("felt.details.addMoreDetail"),
    });
    await act(async () => {
      fireEvent.press(addMoreDetailButton);
    });

    expect(useTier2DraftStore.getState().answers.comment).toBe(
      "Books fell off the shelf.",
    );
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/felt-report/step/[step]",
        params: expect.objectContaining({
          step: "0",
          feltReportId: routeParams.feltReportId,
        }),
      }),
    );
  });
});
