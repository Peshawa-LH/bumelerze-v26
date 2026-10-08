import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import ar from "@/i18n/locales/ar.json";
import ckb from "@/i18n/locales/ckb.json";
import en from "@/i18n/locales/en.json";
import kmr from "@/i18n/locales/kmr.json";
import i18n, { isRTLLocale } from "@/i18n";
import { flattenKeys } from "@/i18n/locale-keys";

import SafetyScreen from "../../../../app/(tabs)/(home,map,sensor,profile,settings)/safety";
import { UsingAppSection } from "../components/UsingAppSection";
import {
  USING_APP_GUIDES,
  USING_APP_TITLE_KEY,
  allUsingAppKeys,
  usingAppLabelParamKeys,
  usingAppStepKeys,
} from "../using-app";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
let mockAccount: { status: string; userId: string | null } = {
  status: "anonymous",
  userId: "a1",
};
jest.mock("@/features/account/use-account", () => ({ useAccount: () => mockAccount }));

const metrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderWithProviders(ui: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

describe("Using Bumelerze: content", () => {
  const catalogs = { en, ckb, kmr, ar } as const;

  it("ships every key the section can render in all four locales", () => {
    for (const [locale, catalog] of Object.entries(catalogs)) {
      const have = new Set(flattenKeys(catalog));
      const missing = allUsingAppKeys().filter((key) => !have.has(key));
      expect({ locale, missing }).toEqual({ locale, missing: [] });
    }
  });

  it("ships every label the steps interpolate (existing keys, all locales)", () => {
    for (const catalog of Object.values(catalogs)) {
      const have = new Set(flattenKeys(catalog));
      for (const guide of USING_APP_GUIDES) {
        for (const key of Object.values(usingAppLabelParamKeys(guide.id))) {
          expect(have.has(key)).toBe(true);
        }
      }
    }
  });

  it("keeps the text short: at most 4 steps per guide, no English step over 130 characters", () => {
    for (const guide of USING_APP_GUIDES) {
      expect(guide.stepCount).toBeLessThanOrEqual(4);
    }
    for (const key of USING_APP_GUIDES.flatMap((guide) => usingAppStepKeys(guide))) {
      const text = key
        .split(".")
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], en);
      expect((text as string).length).toBeLessThanOrEqual(130);
    }
  });

  it("uses the same {{placeholders}} in every locale", () => {
    const placeholders = (value: string) => (value.match(/{{\w+}}/g) ?? []).sort();
    const lookup = (catalog: unknown, key: string) =>
      key
        .split(".")
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown>)[part],
          catalog,
        ) as string;
    for (const key of allUsingAppKeys()) {
      for (const catalog of [ckb, kmr, ar]) {
        expect(placeholders(lookup(catalog, key))).toEqual(placeholders(lookup(en, key)));
      }
    }
  });
});

describe("Using Bumelerze: section", () => {
  const originalLanguage = i18n.language;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAccount = { status: "anonymous", userId: "a1" };
  });
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("renders four collapsed guides in English, with no steps showing yet", async () => {
    await i18n.changeLanguage("en");
    await renderWithProviders(<UsingAppSection />);

    expect(screen.getByRole("header", { name: "Using Bumelerze" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Report what you felt" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "See who felt it" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tag my building" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Your account (optional)" })).toBeTruthy();
    expect(screen.queryAllByTestId(/using-app-.*-step/)).toHaveLength(0);
  });

  it("opens a guide on tap, numbers its steps and names the real buttons", async () => {
    await i18n.changeLanguage("en");
    await renderWithProviders(<UsingAppSection />);

    const toggle = screen.getByTestId("using-app-reportFelt-toggle");
    expect(toggle.props.accessibilityState).toEqual({ expanded: false });
    await press("using-app-reportFelt-toggle");
    expect(
      screen.getByTestId("using-app-reportFelt-toggle").props.accessibilityState,
    ).toEqual({
      expanded: true,
    });
    expect(screen.getAllByTestId("using-app-reportFelt-step")).toHaveLength(3);
    // The pill's own label, not a retyped copy of it.
    expect(
      screen.getByText('Tap "I felt it!" on Home or on any earthquake.'),
    ).toBeTruthy();

    await press("using-app-eventHub-toggle");
    expect(screen.getByText('Tap "Who felt it?" to open the Event hub.')).toBeTruthy();

    await press("using-app-tagBuilding-toggle");
    expect(
      screen.getByText('Open "Profile", then "My home", then "Tag my building".'),
    ).toBeTruthy();
  });

  it("renders in Sorani (RTL) with localized digits and the existing screen names", async () => {
    expect(isRTLLocale("ckb")).toBe(true);
    await i18n.changeLanguage("ckb");
    await renderWithProviders(<UsingAppSection />);

    expect(screen.getByText("بەکارهێنانی Bumelerze")).toBeTruthy();
    await press("using-app-tagBuilding-toggle");
    expect(
      screen.getByText("«هەژمار» بکەرەوە، پاشان «ماڵەکەم»، پاشان «بیناکەم تۆمار بکە»."),
    ).toBeTruthy();
    // Eastern Arabic-Indic digits in the step badges.
    // (decorative: hidden from screen readers, so query with hidden elements)
    const hidden = { includeHiddenElements: true };
    expect(screen.getByText("١", hidden)).toBeTruthy();
    expect(screen.getByText("٤", hidden)).toBeTruthy();
    expect(screen.queryByText("1", hidden)).toBeNull();
  });

  it("renders in Kurmanji", async () => {
    await i18n.changeLanguage("kmr");
    await renderWithProviders(<UsingAppSection />);
    expect(screen.getByText("Bikaranîna Bumelerze")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Avahiya min tomar bike" })).toBeTruthy();
  });

  it("renders in Arabic (RTL)", async () => {
    expect(isRTLLocale("ar")).toBe(true);
    await i18n.changeLanguage("ar");
    await renderWithProviders(<UsingAppSection />);
    expect(screen.getByText("استخدام Bumelerze")).toBeTruthy();
    expect(screen.getByRole("button", { name: "سجّل مبناي" })).toBeTruthy();
  });

  it("Tag my building: anonymous goes to sign-in first, with a spoken hint", async () => {
    await i18n.changeLanguage("en");
    await renderWithProviders(<UsingAppSection />);
    await press("using-app-tagBuilding-toggle");

    const button = screen.getByTestId("using-app-action-tagBuilding");
    expect(button.props.accessibilityLabel).toBe("Tag my building. Needs an account");
    await press("using-app-action-tagBuilding");
    expect(mockPush).toHaveBeenCalledWith("/account/sign-in");
  });

  it("Tag my building: a signed-in account goes straight to /home/new", async () => {
    mockAccount = { status: "account", userId: "u1" };
    await i18n.changeLanguage("en");
    await renderWithProviders(<UsingAppSection />);
    await press("using-app-tagBuilding-toggle");

    expect(
      screen.getByTestId("using-app-action-tagBuilding").props.accessibilityLabel,
    ).toBe("Tag my building");
    await press("using-app-action-tagBuilding");
    expect(mockPush).toHaveBeenCalledWith("/home/new");
  });

  it("Open Profile goes to the Profile tab and See an example opens the 2017 hub", async () => {
    await i18n.changeLanguage("en");
    await renderWithProviders(<UsingAppSection />);

    await press("using-app-account-toggle");
    expect(screen.getByText("Open Profile")).toBeTruthy();
    await press("using-app-action-openAccount");
    expect(mockPush).toHaveBeenLastCalledWith("/profile");

    await press("using-app-eventHub-toggle");
    await press("using-app-action-seeExample");
    expect(mockPush).toHaveBeenLastCalledWith("/event-hub/us2000bmcg");
  });

  it("hides the buttons that need the backend when no project is configured", async () => {
    mockAccount = { status: "unconfigured", userId: null };
    await i18n.changeLanguage("en");
    await renderWithProviders(<UsingAppSection />);
    await press("using-app-tagBuilding-toggle");
    await press("using-app-eventHub-toggle");
    await press("using-app-account-toggle");

    expect(screen.queryByTestId("using-app-action-tagBuilding")).toBeNull();
    expect(screen.queryByTestId("using-app-action-seeExample")).toBeNull();
    // Still explains the steps, and My account itself keeps working offline.
    expect(screen.getAllByTestId("using-app-tagBuilding-step")).toHaveLength(4);
    expect(screen.getByTestId("using-app-action-openAccount")).toBeTruthy();
  });
});

describe("Using Bumelerze: placement on the Safety guide", () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  it("sits under the Prepare guides, and the Survive and Recover tabs stay guide-only", async () => {
    await i18n.changeLanguage("en");
    await renderWithProviders(<SafetyScreen />);

    // The earthquake guides are still there, first.
    expect(screen.getByText("Make a family plan")).toBeTruthy();
    expect(screen.getByText(i18n.t(USING_APP_TITLE_KEY))).toBeTruthy();

    await press("using-app-reportFelt-toggle");
    expect(screen.getAllByTestId("using-app-reportFelt-step")).toHaveLength(3);

    await act(async () => {
      fireEvent.press(screen.getByRole("tab", { name: "Survive" }));
    });
    expect(screen.queryByTestId("using-app")).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByRole("tab", { name: "Recover" }));
    });
    expect(screen.queryByTestId("using-app")).toBeNull();
  });
});
