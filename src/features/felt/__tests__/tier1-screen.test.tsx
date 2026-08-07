import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { AccessibilityInfo } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { CARTOON_LEVELS } from "../types";

/**
 * Tier-1 select-submit flow (wave brief scope item 6: "tier-1 select-submit
 * flow (renders 12 tiles, tap queues + shows confirmation)"). Everything
 * downstream of the tap (device id, the offline queue, AsyncStorage) runs
 * for REAL here, same "only mock the network/native boundary" philosophy as
 * `features/events/__tests__/home-screen.test.tsx` — this test exercises
 * the actual queueing pipeline, not a mocked stand-in for it.
 */

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockCanDismiss = jest.fn(() => false);
const mockDismiss = jest.fn();

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    canDismiss: mockCanDismiss,
    dismiss: mockDismiss,
  }),
}));

// No location permission granted — exercises the manual-town fallback path
// (spec-v1.md §4.6: "never blocks submission").
jest.mock("expo-location", () => ({
  PermissionStatus: {
    GRANTED: "granted",
    DENIED: "denied",
    UNDETERMINED: "undetermined",
  },
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: () => Promise.resolve({ status: "denied" }),
  getLastKnownPositionAsync: () => Promise.resolve(null),
  getCurrentPositionAsync: () => Promise.resolve(null),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: () => {
    const g = globalThis as { __tier1TestUuidCounter?: number };
    g.__tier1TestUuidCounter = (g.__tier1TestUuidCounter ?? 0) + 1;
    return `test-tier1-uuid-${g.__tier1TestUuidCounter}`;
  },
}));

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import Tier1FeltReportScreen from "../../../../app/felt-report/index";
// eslint-disable-next-line import/first -- see comment above
import { useFeltQueueStore } from "../queue";

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderWithProviders(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Tier 1 felt-report screen", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    mockPush.mockClear();
    mockBack.mockClear();
    mockCanDismiss.mockClear();
    mockDismiss.mockClear();
    // Fresh queue between tests — this suite intentionally exercises the
    // REAL store (not a mock), so it must not leak state across tests.
    useFeltQueueStore.setState({ items: [] });
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("renders all 12 EMS-98 level tiles, none disabled, before any selection", async () => {
    await renderWithProviders(<Tier1FeltReportScreen />);
    await flush();

    for (const level of CARTOON_LEVELS) {
      const label = i18n.t(`felt.tier1.levels.${level}.label`);
      const tile = screen.getByLabelText(`${level}. ${label}`);
      expect(tile).toBeTruthy();
      expect(tile.props.accessibilityState?.disabled).not.toBe(true);
    }

    // Levels 10-12 render under the "severe destruction" sub-header
    // (science pack §1.2) — the header text itself is present.
    expect(screen.getByText(i18n.t("felt.tier1.severeDestructionHeader"))).toBeTruthy();
  });

  it("one tap selects AND submits (queues) a level, then shows the confirmation state", async () => {
    await renderWithProviders(<Tier1FeltReportScreen />);
    await flush();

    const level5Label = i18n.t("felt.tier1.levels.5.label");
    const tile = screen.getByLabelText(`5. ${level5Label}`);

    await act(async () => {
      fireEvent.press(tile);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    // Confirmation state replaces the grid — thanks message + queued
    // indicator + "add more detail" CTA, per spec-v1.md §4.6.
    expect(screen.getByText(i18n.t("felt.tier1.confirmation.title"))).toBeTruthy();
    expect(
      screen.getByText(i18n.t("felt.tier1.confirmation.queuedMessage")),
    ).toBeTruthy();
    expect(screen.getByText(i18n.t("felt.tier1.confirmation.addDetail"))).toBeTruthy();

    // The grid itself is gone — this really is a one-screen, one-tap flow,
    // not a navigation to a separate confirmation route.
    expect(screen.queryByLabelText(`5. ${level5Label}`)).toBeNull();

    // And the report genuinely reached the durable local queue (D8: no
    // report is ever lost) — verified via the real (non-mocked) store.
    const items = useFeltQueueStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.tier1.cartoonLevel).toBe(5);
    expect(items[0]?.tier1.eventId).toBeNull();
    expect(items[0]?.tier1.location.quality).toBe("manual");
  });

  it("announces the submission to screen readers (blind users get an audible confirmation, not just a visual one)", async () => {
    const announceSpy = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => undefined);

    await renderWithProviders(<Tier1FeltReportScreen />);
    await flush();

    const level5Label = i18n.t("felt.tier1.levels.5.label");
    const tile = screen.getByLabelText(`5. ${level5Label}`);

    await act(async () => {
      fireEvent.press(tile);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(announceSpy).toHaveBeenCalledWith(
      expect.stringContaining(i18n.t("felt.tier1.confirmation.title")),
    );
    expect(announceSpy).toHaveBeenCalledWith(
      expect.stringContaining(i18n.t("felt.tier1.confirmation.queuedMessage")),
    );

    announceSpy.mockRestore();
  });

  it("tapping 'add more detail' navigates into the tier-2 flow with the just-created report id", async () => {
    await renderWithProviders(<Tier1FeltReportScreen />);
    await flush();

    const level1Label = i18n.t("felt.tier1.levels.1.label");
    const tile = screen.getByLabelText(`1. ${level1Label}`);
    await act(async () => {
      fireEvent.press(tile);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    const addDetailButton = screen.getByRole("button", {
      name: i18n.t("felt.tier1.confirmation.addDetail"),
    });
    fireEvent.press(addDetailButton);

    const createdReportId = useFeltQueueStore.getState().items[0]?.tier1.reportId;
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/felt-report/step/[step]",
        params: expect.objectContaining({ step: "0", feltReportId: createdReportId }),
      }),
    );
  });
});
