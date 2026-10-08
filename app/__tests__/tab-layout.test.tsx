import { cleanup, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import ar from "@/i18n/locales/ar.json";
import ckb from "@/i18n/locales/ckb.json";
import kmr from "@/i18n/locales/kmr.json";
import en from "@/i18n/locales/en.json";

import TabLayout from "../(tabs)/_layout";

/**
 * The tab bar (D79, 2026-10-08): Home, Map, Sensor, Profile, Settings.
 * Safety left the bar for Settings -> Safety guide. `Tabs` is stood in so the
 * declared screens can be read back in order.
 */
interface ScreenProps {
  name: string;
  options?: {
    title?: string;
    tabBarIcon?: (props: { color: string; size: number; focused: boolean }) => {
      props: { name: string };
    };
  };
}
const declared: ScreenProps[] = [];
jest.mock("expo-router", () => {
  const Screen = (props: ScreenProps) => {
    declared.push(props);
    return null;
  };
  const Tabs = Object.assign(({ children }: { children: unknown }) => children as never, {
    Screen,
  });
  return { Tabs };
});

const metrics = {
  frame: { x: 0, y: 0, width: 320, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

describe("tab bar", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    declared.length = 0;
    await i18n.changeLanguage("en");
  });
  afterEach(async () => {
    await cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  async function renderTabs() {
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <TabLayout />
      </SafeAreaProvider>,
    );
  }

  it("is Home, Map, Sensor, Profile, Settings, in that order, with no Safety tab", async () => {
    await renderTabs();
    expect(declared.map((screen) => screen.name)).toEqual([
      "index",
      "map",
      "sensor",
      "profile",
      "settings",
    ]);
    expect(declared.map((screen) => screen.options?.title)).toEqual([
      "Home",
      "Map",
      "Sensor",
      "Profile",
      "Settings",
    ]);
    expect(declared.some((screen) => screen.name === "safety")).toBe(false);
  });

  it("the Profile tab uses the person-circle icon, outline until it is the active tab", async () => {
    await renderTabs();
    const profile = declared.find((screen) => screen.name === "profile");
    const icon = profile?.options?.tabBarIcon;
    expect(icon?.({ color: "#000", size: 24, focused: false }).props.name).toBe(
      "person-circle-outline",
    );
    expect(icon?.({ color: "#000", size: 24, focused: true }).props.name).toBe(
      "person-circle",
    );
  });

  it("keeps every tab label within the width of the longest one that already fits 320 px", async () => {
    await renderTabs();
    // Five labels share 320 px (~64 px each). The Sorani "Settings" label
    // (ڕێکخستنەکان, 11 letters) is the longest that was measured to fit, so
    // no label in any language may be longer than that.
    const limit = [...ckb.tabs.settings].length;
    for (const catalog of [en, ckb, kmr, ar]) {
      for (const label of Object.values(catalog.tabs)) {
        expect([...label].length).toBeLessThanOrEqual(limit);
      }
    }
    expect(ckb.tabs.profile).toBe("هەژمار");
    expect(ar.tabs.profile).toBe("ملفي");
    expect(en.tabs).not.toHaveProperty("safety");
    expect(ckb.tabs).not.toHaveProperty("safety");
  });
});
