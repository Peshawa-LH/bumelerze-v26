import { act, fireEvent, render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { useFeltQueueStore, useTier2DraftStore } from "../";

/**
 * End-to-end coverage of the 2026-08-15 flow restructure (owner directive)
 * across all three windows against the REAL queue store — each window's
 * own unit tests (`tier1-screen`, `damage-screen`, `details-screen`,
 * `step-screen`) cover their individual behavior; this file chains them the
 * way a real user would, simulating navigation by feeding each screen's
 * captured `router.push`/`replace` params into the next screen's mocked
 * route params (there is no real navigator mounted in a unit test).
 *
 * Each step keeps its OWN `render()` result (not the global `screen`
 * singleton) and explicitly `unmount()`s it before mounting the next
 * screen — chaining several manual mount/unmount cycles through the
 * shared global `screen` binding proved flaky (RNTL's internal renderer
 * registry didn't always rebind cleanly), so this file deliberately avoids
 * that pattern even though every OTHER felt-report test file uses `screen`.
 */

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCanDismiss = jest.fn(() => false);
const mockDismiss = jest.fn();

const routeParams: Record<string, string> = {};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => routeParams,
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    canGoBack: () => true,
    canDismiss: mockCanDismiss,
    dismiss: mockDismiss,
  }),
}));

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
    const g = globalThis as { __flowTestUuidCounter?: number };
    g.__flowTestUuidCounter = (g.__flowTestUuidCounter ?? 0) + 1;
    return `test-flow-uuid-${g.__flowTestUuidCounter}`;
  },
}));

const mockLaunchImageLibraryAsync = jest.fn();
jest.mock("expo-image-picker", () => ({
  MediaTypeOptions: { Images: "Images" },
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
}));

/* eslint-disable import/first -- after the mocks above, see top-of-file comment */
import Tier1FeltReportScreen from "../../../../app/felt-report/index";
import DamageReportScreen from "../../../../app/felt-report/damage";
import DetailsReportScreen from "../../../../app/felt-report/details";
/* eslint-enable import/first */

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderScreen(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

/** Flushes pending microtasks (fire-and-forget queue-sync promises, in
 * particular — `enqueueTier1Report`/`enqueueTier2Report` both kick off a
 * `void processQueue(...)` they don't await) INSIDE an `act()` boundary, so
 * the NEXT mount/unmount never overlaps with one of these still-settling
 * background promises (same pattern `tier1-screen.test.tsx` uses). */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Reads the pathname+params of the most recent `router.push`/`replace`
 * call and applies them to the shared mocked route params, simulating the
 * navigation a real Stack would perform. */
function followLastNavigation(mock: jest.Mock): string {
  const call = mock.mock.calls[mock.mock.calls.length - 1]?.[0] as {
    pathname: string;
    params: Record<string, string>;
  };
  for (const key of Object.keys(routeParams)) {
    delete routeParams[key];
  }
  Object.assign(routeParams, call.params);
  return call.pathname;
}

describe("Felt-report flow — end to end (2026-08-15 flow restructure)", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    mockPush.mockClear();
    mockReplace.mockClear();
    mockLaunchImageLibraryAsync.mockReset();
    useFeltQueueStore.setState({ items: [] });
    useTier2DraftStore.getState().reset();
    for (const key of Object.keys(routeParams)) {
      delete routeParams[key];
    }
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it("quitting right after window 1 leaves a single, valid, tier-1-only queued report", async () => {
    const window1 = await renderScreen(<Tier1FeltReportScreen />);
    await flush();

    const tile = window1.getByLabelText(`7. ${i18n.t("felt.tier1.levels.7.label")}`);
    await act(async () => {
      fireEvent.press(tile);
    });
    await flush();

    // The user closes the app here — windows 2/3 never render.
    const items = useFeltQueueStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.tier1.cartoonLevel).toBe(7);
    expect(items[0]?.tier2).toBeNull();
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/felt-report/damage" }),
    );
    await window1.unmount();
  });

  it("skip-through path (window 1 -> no damage -> submit with nothing extra) matches today's tier-1-only behavior plus an empty upgrade", async () => {
    const window1 = await renderScreen(<Tier1FeltReportScreen />);
    await flush();
    const tile = window1.getByLabelText(`3. ${i18n.t("felt.tier1.levels.3.label")}`);
    await act(async () => {
      fireEvent.press(tile);
    });
    await flush();
    await window1.unmount();

    expect(followLastNavigation(mockPush)).toBe("/felt-report/damage");
    const reportId = routeParams.feltReportId;

    const window2 = await renderScreen(<DamageReportScreen />);
    await flush();
    await act(async () => {
      fireEvent.press(
        window2.getByRole("button", { name: i18n.t("felt.damage.noDamage.label") }),
      );
    });
    await flush();
    await window2.unmount();

    expect(followLastNavigation(mockPush)).toBe("/felt-report/details");
    expect(routeParams.feltReportId).toBe(reportId);

    const window3 = await renderScreen(<DetailsReportScreen />);
    await flush();
    await act(async () => {
      fireEvent.press(window3.getByRole("button", { name: i18n.t("felt.tier2.submit") }));
    });
    await flush();
    await window3.unmount();

    const items = useFeltQueueStore.getState().items;
    // ONE queue item throughout — the upgrade superseded the tier-1 record
    // in place (D18 §3.2 supersede semantics, extended to windows 2/3).
    expect(items).toHaveLength(1);
    expect(items[0]?.tier1.reportId).toBe(reportId);
    expect(items[0]?.tier2?.answers.buildingDamageLevel).toBe(0);
    expect(items[0]?.tier2?.answers.damageTypology).toBeNull();
    expect(items[0]?.tier2?.answers.comment).toBeNull();
    expect(items[0]?.tier2?.photoUri).toBeNull();
    expect(followLastNavigation(mockReplace)).toBe("/felt-report/done");
  });

  it("full path with damage grade, typology, comment, and photo — still one superseded queue item", async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///tmp/damage.jpg" }],
    });

    const window1 = await renderScreen(<Tier1FeltReportScreen />);
    await flush();
    const tile = window1.getByLabelText(`9. ${i18n.t("felt.tier1.levels.9.label")}`);
    await act(async () => {
      fireEvent.press(tile);
    });
    await flush();
    await window1.unmount();

    expect(followLastNavigation(mockPush)).toBe("/felt-report/damage");
    const reportId = routeParams.feltReportId;

    const window2 = await renderScreen(<DamageReportScreen />);
    await flush();
    const gradeLabel = i18n.t("felt.damage.grades.highrise.3");
    const typologyLabel = i18n.t("felt.damage.typologies.highrise");
    await act(async () => {
      fireEvent.press(window2.getByLabelText(`${typologyLabel}. ${gradeLabel}`));
    });
    await flush();
    await window2.unmount();

    expect(followLastNavigation(mockPush)).toBe("/felt-report/details");

    const window3 = await renderScreen(<DetailsReportScreen />);
    await flush();

    const commentInput = window3.getByPlaceholderText(
      i18n.t("felt.details.commentPlaceholder"),
    );
    await act(async () => {
      fireEvent.changeText(commentInput, "Chimney cracked.");
    });
    await flush();
    await act(async () => {
      fireEvent.press(
        window3.getByRole("button", { name: i18n.t("felt.details.photo.addLabel") }),
      );
    });
    await flush();
    await act(async () => {
      fireEvent.press(window3.getByRole("button", { name: i18n.t("felt.tier2.submit") }));
    });
    await flush();
    await window3.unmount();

    const items = useFeltQueueStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.tier1.reportId).toBe(reportId);
    expect(items[0]?.tier1.cartoonLevel).toBe(9);
    expect(items[0]?.tier2?.answers.buildingDamageLevel).toBe(3);
    expect(items[0]?.tier2?.answers.damageTypology).toBe("highrise");
    expect(items[0]?.tier2?.answers.comment).toBe("Chimney cracked.");
    expect(items[0]?.tier2?.photoUri).toBe("file:///tmp/damage.jpg");
  });
});
