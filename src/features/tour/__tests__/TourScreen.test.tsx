import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { AccessibilityInfo, Animated } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import ar from "@/i18n/locales/ar.json";
import ckb from "@/i18n/locales/ckb.json";
import en from "@/i18n/locales/en.json";
import kmr from "@/i18n/locales/kmr.json";

import { TOUR_STOP_IDS } from "../stops";

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockPush = jest.fn();
let mockCanGoBack = true;
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    canGoBack: () => mockCanGoBack,
  }),
}));

// Imported after the mock above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import { TourScreen } from "../components/TourScreen";

const metrics = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderTour(ui: ReactElement = <TourScreen />) {
  return render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

const EXPECTED_ORDER = [
  "home",
  "felt",
  "hub",
  "map",
  "sensor",
  "safety",
  "account",
  "share",
];

function titleOf(id: string, catalog: typeof en = en): string {
  return (catalog.tour.stops as Record<string, { title: string }>)[id]?.title ?? "";
}

async function next() {
  await fireEvent.press(screen.getByTestId("tour-next"));
}

describe("app tour", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    mockBack.mockClear();
    mockReplace.mockClear();
    mockPush.mockClear();
    mockCanGoBack = true;
    await i18n.changeLanguage("en");
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("has the eight stops in the agreed order, each with a title and a line in every language", () => {
    expect([...TOUR_STOP_IDS]).toEqual(EXPECTED_ORDER);
    for (const id of EXPECTED_ORDER) {
      const stops = en.tour.stops as Record<string, { title: string; body: string }>;
      expect(stops[id]?.title.length).toBeGreaterThan(0);
      expect(stops[id]?.body.length).toBeGreaterThan(0);
    }
  });

  it("points at where things live now: Safety guide in Settings, the account in Profile (D79)", () => {
    const stops = (catalog: typeof en) =>
      catalog.tour.stops as Record<string, { title: string; body: string }>;
    // English names both places outright.
    expect(stops(en).safety?.body).toContain("Settings");
    expect(stops(en).safety?.body).toContain("Safety guide");
    expect(stops(en).account?.title).toContain("profile");
    expect(stops(en).account?.body).toContain("Profile");
    // Nowhere does a stop send the reader to a tab or page that is gone.
    for (const catalog of [en, ckb, kmr, ar] as const) {
      const text = JSON.stringify(catalog.tour.stops);
      expect(text).not.toMatch(/My account|Safety tab/i);
    }
    // Every language names the Profile page the same way as its tab label.
    expect(stops(ckb as typeof en).account?.body).toContain(ckb.tabs.profile);
    expect(stops(kmr as typeof en).account?.body).toContain(kmr.tabs.profile);
  });

  it("starts on the first stop with Next and Skip, and no Back", async () => {
    await renderTour();
    expect(screen.getByText(titleOf("home"))).toBeTruthy();
    expect(screen.getByTestId("tour-next")).toBeTruthy();
    expect(screen.getByTestId("tour-skip")).toBeTruthy();
    expect(screen.queryByTestId("tour-back")).toBeNull();
    expect(screen.getByLabelText("Step 1 of 8")).toBeTruthy();
  });

  it("walks forward through every stop in order and back again", async () => {
    await renderTour();
    for (const id of EXPECTED_ORDER) {
      expect(screen.getByText(titleOf(id))).toBeTruthy();
      if (id !== "share") {
        await next();
      }
    }
    expect(screen.getByLabelText("Step 8 of 8")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("tour-back"));
    expect(screen.getByText(titleOf("account"))).toBeTruthy();
    await fireEvent.press(screen.getByTestId("tour-back"));
    expect(screen.getByText(titleOf("safety"))).toBeTruthy();
  });

  it("shows the finish label on the last stop and leaves to the previous screen", async () => {
    await renderTour();
    for (let step = 0; step < EXPECTED_ORDER.length - 1; step += 1) {
      await next();
    }
    expect(screen.getByText("Start using Bumelerze")).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
    await next();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("Skip tour leaves from any stop", async () => {
    await renderTour();
    await next();
    await next();
    await fireEvent.press(screen.getByTestId("tour-skip"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("goes to Home when there is nothing to go back to (a reload on the tour)", async () => {
    mockCanGoBack = false;
    await renderTour();
    await fireEvent.press(screen.getByTestId("tour-skip"));
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it("hides the live preview from assistive technology", async () => {
    await renderTour();
    const card = screen.getByTestId("tour-phone-card", { includeHiddenElements: true });
    expect(card.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(card.props.accessibilityElementsHidden).toBe(true);
  });

  it("slides between stops normally", async () => {
    const timing = jest.spyOn(Animated, "timing");
    await renderTour();
    await next();
    expect(screen.getByText(titleOf("felt"))).toBeTruthy();
    expect(timing).toHaveBeenCalled();
  });

  it("does not animate under reduce-motion", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const timing = jest.spyOn(Animated, "timing");
    await renderTour();
    await act(async () => {
      await Promise.resolve();
    });
    await next();
    expect(screen.getByText(titleOf("felt"))).toBeTruthy();
    expect(timing).not.toHaveBeenCalled();
  });

  it("renders every stop in English without raw keys", async () => {
    await renderTour();
    for (let step = 0; step < EXPECTED_ORDER.length; step += 1) {
      expect(screen.queryByText(/^tour\./)).toBeNull();
      expect(
        screen.queryByText(/^(felt|eventHub|safety|share|building|sensor)\./),
      ).toBeNull();
      await next();
    }
  });

  it("renders every stop in Sorani (right to left) without raw keys", async () => {
    await act(async () => {
      await i18n.changeLanguage("ckb");
    });
    await renderTour();
    for (const id of EXPECTED_ORDER) {
      expect(screen.getByText(titleOf(id, ckb as unknown as typeof en))).toBeTruthy();
      expect(screen.queryByText(/^tour\./)).toBeNull();
      expect(
        screen.queryByText(/^(felt|eventHub|safety|share|building|sensor)\./),
      ).toBeNull();
      if (id !== "share") {
        await next();
      }
    }
    // Sorani digits in the progress label, last button in Sorani.
    expect(screen.getByLabelText("هەنگاوی ٨ لە ٨")).toBeTruthy();
    expect(screen.getByText(ckb.tour.finish)).toBeTruthy();
  });
});
