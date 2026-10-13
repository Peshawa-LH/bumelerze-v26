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

/** Review note 12.1 (2026-10-13): ten stops, in this order. */
const EXPECTED_ORDER = [
  "home",
  "felt",
  "safe",
  "hub",
  "map",
  "catalog",
  "sensor",
  "safety",
  "handbook",
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

  it("has the ten stops in the agreed order, each with a title and one short sentence in every language", () => {
    expect([...TOUR_STOP_IDS]).toEqual(EXPECTED_ORDER);
    for (const catalog of [en, ckb, kmr, ar] as const) {
      const stops = catalog.tour.stops as Record<string, { title: string; body: string }>;
      expect(Object.keys(stops)).toEqual(EXPECTED_ORDER);
      for (const id of EXPECTED_ORDER) {
        expect(stops[id]?.title.length).toBeGreaterThan(0);
        const body = stops[id]?.body ?? "";
        expect(body.length).toBeGreaterThan(0);
        // One sentence: a single full stop, at the end.
        expect(body.replace(/[.\u06d4]$/, "")).not.toMatch(/[.\u06d4]\s/);
      }
    }
  });

  it("uses the website's names for things (review note 12.1)", () => {
    const stops = en.tour.stops as Record<string, { title: string; body: string }>;
    expect(stops.felt?.title).toBe("Share your experience in one tap");
    expect(stops.hub?.title).toBe("Event hubs and the Bumelerze Network");
    expect(stops.catalog?.body).toContain("1,150 years");
    expect(stops.map?.title).toContain("SHAKEmaps");
    for (const catalog of [en, ckb, kmr, ar] as const) {
      const text = JSON.stringify(catalog.tour.stops);
      expect(text).not.toMatch(/Did you feel it|ShakeMap/);
    }
    // Sorani: Bumelerze Network = تۆڕی بوومەلەرزە; Sorani and Arabic write the
    // years in Eastern Arabic-Indic digits.
    const ckbStops = ckb.tour.stops as Record<string, { title: string; body: string }>;
    const arStops = ar.tour.stops as Record<string, { title: string; body: string }>;
    expect(ckbStops.hub?.title).toContain("تۆڕی بوومەلەرزە");
    for (const body of [ckbStops.catalog?.body, arStops.catalog?.body]) {
      expect(body).toContain("١١٥٠");
      expect(body).toContain("٨٧٢");
      expect(body).not.toMatch(/[0-9]/);
    }
  });

  it("points at where things live now: Safety guide and handbook in Settings, Tag my building in Profile (D79)", () => {
    const stops = (catalog: typeof en) =>
      catalog.tour.stops as Record<string, { title: string; body: string }>;
    // English names the places outright.
    expect(stops(en).safety?.body).toContain("Settings");
    expect(stops(en).safety?.body).toContain("Safety guide");
    expect(stops(en).safety?.body).toContain("Tag my building");
    expect(stops(en).safety?.body).toContain("Profile");
    expect(stops(en).handbook?.body).toContain("Settings");
    // Nowhere does a stop send the reader to a tab or page that is gone.
    for (const catalog of [en, ckb, kmr, ar] as const) {
      const text = JSON.stringify(catalog.tour.stops);
      expect(text).not.toMatch(/My account|Safety tab/i);
    }
    // Every language names the Profile page and Settings as its tabs do, and
    // Tag my building as its own row does.
    for (const catalog of [ckb, kmr, ar] as const) {
      const body = stops(catalog as unknown as typeof en).safety?.body ?? "";
      expect(body).toContain(catalog.tabs.profile);
      expect(body).toContain(catalog.building.title);
      // (Kurmanji inflects Sazkarî to Sazkariyê, hence the stem.)
      expect(stops(catalog as unknown as typeof en).handbook?.body).toContain(
        catalog.tabs.settings.slice(0, 5),
      );
    }
  });

  it("draws each new or changed stop with the part of the app it is about", async () => {
    await renderTour();
    const hidden = { includeHiddenElements: true } as const;
    // What each stop's preview must show (real components and strings).
    const expectations: Partial<Record<string, () => void>> = {
      safe: () => {
        expect(screen.getByText("I'm safe", hidden)).toBeTruthy();
        expect(screen.getByText("Family status", hidden)).toBeTruthy();
      },
      hub: () => {
        expect(screen.getByText("Who felt it?", hidden)).toBeTruthy();
        expect(screen.getByText("Bumelerze", hidden)).toBeTruthy();
      },
      catalog: () => {
        expect(screen.getByDisplayValue("872", hidden)).toBeTruthy();
        expect(
          screen.getByDisplayValue(String(new Date().getFullYear()), hidden),
        ).toBeTruthy();
      },
      safety: () => {
        expect(screen.getByText("Tag my building", hidden)).toBeTruthy();
      },
      handbook: () => {
        // Once in the preview, once as the stop's title.
        expect(screen.getAllByText("Engineer's handbook", hidden)).toHaveLength(2);
      },
    };
    for (const id of EXPECTED_ORDER) {
      expectations[id]?.();
      if (id !== "share") {
        await next();
      }
    }
  });

  it("starts on the first stop with Next and Skip, and no Back", async () => {
    await renderTour();
    expect(screen.getByText(titleOf("home"))).toBeTruthy();
    expect(screen.getByTestId("tour-next")).toBeTruthy();
    expect(screen.getByTestId("tour-skip")).toBeTruthy();
    expect(screen.queryByTestId("tour-back")).toBeNull();
    expect(screen.getByLabelText("Step 1 of 10")).toBeTruthy();
  });

  it("walks forward through every stop in order and back again", async () => {
    await renderTour();
    for (const id of EXPECTED_ORDER) {
      expect(screen.getByText(titleOf(id))).toBeTruthy();
      if (id !== "share") {
        await next();
      }
    }
    expect(screen.getByLabelText("Step 10 of 10")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("tour-back"));
    expect(screen.getByText(titleOf("handbook"))).toBeTruthy();
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
        screen.queryByText(/^(felt|eventHub|safety|share|building|sensor|imSafe|catalog|handbook)\./),
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
        screen.queryByText(/^(felt|eventHub|safety|share|building|sensor|imSafe|catalog|handbook)\./),
      ).toBeNull();
      if (id !== "share") {
        await next();
      }
    }
    // Sorani digits in the progress label, last button in Sorani.
    expect(screen.getByLabelText("هەنگاوی ١٠ لە ١٠")).toBeTruthy();
    expect(screen.getByText(ckb.tour.finish)).toBeTruthy();
  });
});
