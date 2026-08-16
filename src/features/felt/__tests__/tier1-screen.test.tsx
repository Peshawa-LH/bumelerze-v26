import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { AccessibilityInfo } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { CARTOON_LEVELS } from "../types";

/**
 * Window 1 — the panic-time tap (2026-08-15 flow restructure, owner
 * directive: EXACTLY the original tier-1 grid, unchanged tap behavior, but
 * a tap now navigates straight into window 2 instead of showing an in-place
 * confirmation). Everything downstream of the tap (device id, the offline
 * queue, AsyncStorage) runs for REAL here, same "only mock the network/
 * native boundary" philosophy as `features/events/__tests__/home-screen.
 * test.tsx` — this test exercises the actual queueing pipeline, not a
 * mocked stand-in for it.
 */

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockCanDismiss = jest.fn(() => false);
const mockDismiss = jest.fn();

/** Mutable per-test route params — most tests want the original `() => ({})`
 * (no eventId/eventReg, Home usage); the `eventReg` parsing tests below
 * override this before rendering. Reset in `afterEach` so it never leaks
 * between tests. */
let mockSearchParams: Record<string, string | undefined> = {};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockSearchParams,
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

describe("Window 1 — tier-1 felt-report screen", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    mockPush.mockClear();
    mockBack.mockClear();
    mockCanDismiss.mockClear();
    mockDismiss.mockClear();
    mockSearchParams = {};
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

  it("renders all 12 EMS-98 level tiles, none disabled", async () => {
    await renderWithProviders(<Tier1FeltReportScreen />);
    await flush();

    for (const level of CARTOON_LEVELS) {
      const label = i18n.t(`felt.tier1.levels.${level}.label`);
      const tile = screen.getByLabelText(`${level}. ${label}`);
      expect(tile).toBeTruthy();
      expect(tile.props.accessibilityState?.disabled).not.toBe(true);
      // A blind user needs to know a tap durably records their report even
      // though the screen is about to navigate away (accessibility-tester
      // Phase 5 audit).
      expect(tile.props.accessibilityHint).toBe(i18n.t("felt.tier1.levelA11yHint"));
    }

    // Levels 10-12 render under the "severe destruction" sub-header
    // (science pack §1.2) — the header text itself is present.
    expect(screen.getByText(i18n.t("felt.tier1.severeDestructionHeader"))).toBeTruthy();
  });

  it("one tap queues a tier-1-only report (the one-tap promise) AND navigates into window 2 (damage)", async () => {
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

    // The report genuinely reached the durable local queue (D8: no report
    // is ever lost) BEFORE navigation — verified via the real (non-mocked)
    // store. This is the "quit after window 1" safety guarantee: even if
    // the user closes the app right here, this record already exists.
    const items = useFeltQueueStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.tier1.cartoonLevel).toBe(5);
    expect(items[0]?.tier1.eventId).toBeNull();
    expect(items[0]?.tier1.location.quality).toBe("manual");
    expect(items[0]?.tier2).toBeNull();

    const createdReportId = items[0]?.tier1.reportId;
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/felt-report/damage",
        params: expect.objectContaining({ feltReportId: createdReportId, eventId: "" }),
      }),
    );
  });

  it("announces the queued report to screen readers before navigating on", async () => {
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

    expect(announceSpy).toHaveBeenCalledWith(i18n.t("felt.tier1.queuedAnnouncement"));

    announceSpy.mockRestore();
  });

  describe("eventReg route param (migration 0011: FeltReportPill's registration snapshot)", () => {
    it("parses a valid eventReg JSON param onto the queued item's eventRegistration", async () => {
      mockSearchParams = {
        eventId: "us1000abcd",
        eventReg: JSON.stringify({
          provider: "usgs",
          providerId: "us1000abcd",
          originTime: 1_700_000_000_000,
          lat: 35.56,
          lon: 45.43,
          depthKm: 10,
          magnitude: 5.4,
          magType: "mww",
          placeName: "32 km SE of Halabja, Iraq",
        }),
      };

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

      const items = useFeltQueueStore.getState().items;
      expect(items).toHaveLength(1);
      expect(items[0]?.tier1.eventId).toBe("us1000abcd");
      expect(items[0]?.tier1.eventRegistration).toEqual({
        provider: "usgs",
        providerId: "us1000abcd",
        originTime: 1_700_000_000_000,
        lat: 35.56,
        lon: 45.43,
        depthKm: 10,
        magnitude: 5.4,
        magType: "mww",
        placeName: "32 km SE of Halabja, Iraq",
      });
    });

    it("degrades to eventRegistration: null (never throws) when eventReg is malformed JSON", async () => {
      mockSearchParams = { eventId: "us1000abcd", eventReg: "{not valid json" };

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

      const items = useFeltQueueStore.getState().items;
      expect(items).toHaveLength(1);
      // The one-tap promise still holds even with a corrupt route param —
      // the report is still queued, just without a registration snapshot.
      expect(items[0]?.tier1.eventId).toBe("us1000abcd");
      expect(items[0]?.tier1.eventRegistration).toBeNull();
    });
  });
});
