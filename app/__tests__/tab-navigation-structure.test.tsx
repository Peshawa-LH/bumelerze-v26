import { readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { Text } from "react-native";
import {
  act,
  fireEvent,
  renderRouter,
  screen,
  waitFor,
} from "expo-router/testing-library";
import { router, Stack } from "expo-router";

import i18n from "@/i18n";

import TabsLayout from "../(tabs)/_layout";
import TabStackLayout, {
  unstable_settings,
} from "../(tabs)/(home,map,sensor,profile,settings)/_layout";

/**
 * The real route tree, stubbed. Every file under `app/` becomes a route that
 * renders its own path, except the two tab layouts, which are the real ones.
 * So this checks where screens LIVE: inside a tab (bar showing, Back within the
 * tab) or full-screen in the root stack (bar covering).
 */
const APP_DIR = join(__dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === "__tests__") return [];
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function buildContext() {
  const context: Record<string, unknown> = {};
  for (const file of walk(APP_DIR)) {
    const key = relative(APP_DIR, file).replace(/\.(web\.)?tsx$/, "");
    if (file.endsWith(".web.tsx") || key === "_layout") continue;
    if (key.endsWith("_layout")) continue;
    context[key] = () => <Text testID="screen">{`/${key}`}</Text>;
  }
  context["_layout"] = () => <Stack screenOptions={{ headerShown: false }} />;
  context["(tabs)/_layout"] = TabsLayout;
  context["(tabs)/(home,map,sensor,profile,settings)/_layout"] = {
    default: TabStackLayout,
    unstable_settings,
  };
  // Keep the real felt-report layout out of it: a plain stack is enough.
  context["felt-report/_layout"] = () => <Stack screenOptions={{ headerShown: false }} />;
  context["onboarding/_layout"] = () => <Stack screenOptions={{ headerShown: false }} />;
  return context;
}

const SHOWS_TAB_BAR = [
  "/",
  "/map",
  "/sensor",
  "/profile",
  "/settings",
  "/event/abc",
  "/event-hub/abc",
  "/world",
  "/significant",
  "/historical",
  "/catalog",
  "/handbook",
  "/notification-settings",
  "/my-data",
  "/safety",
  "/badges",
  "/my-reports",
  "/account/people",
  "/u/sara",
  "/u/sara/people",
];

const FULL_SCREEN = [
  "/felt-report",
  "/felt-report/details",
  "/home/new",
  "/home/join",
  "/home/tag1/report",
  "/home/tag1/family",
  "/tour",
  "/feedback",
  "/account/sign-in",
  "/account/profile",
  "/account/password",
  "/admin",
  "/admin/activity",
  "/admin/hidden",
  "/admin/limited",
  "/admin/feedback",
  "/admin/feedback/f1",
  "/admin/photos",
];

describe("where screens live", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  // FIRST in the file on purpose: opening a URL cold prefers the group of
  // whatever route was showing before (module state), so these must not run
  // after a test that left the app in another tab.
  it("a link straight to an event opens in the Home tab, with the bar", async () => {
    const app = renderRouter(buildContext() as never, { initialUrl: "/event/abc" });
    await app;
    await screen.findByTestId("screen");
    expect(app.getSegments()).toEqual(["(tabs)", "(home)", "event", "[id]"]);
    expect(screen.getByTestId("scroll-aware-tab-bar")).toBeTruthy();
  });

  it("Back from a link (the header button replaces the screen with Home) lands on Home", async () => {
    const app = renderRouter(buildContext() as never, { initialUrl: "/event/abc" });
    await app;
    await screen.findByTestId("screen");
    await act(async () => router.replace("/"));
    // Known expo-router quirk: the tab and its parents keep the link's `id` param, so
    // the web address bar reads `/?id=abc` (the path itself, and the page, are Home).
    expect(app.getPathname()).toBe("/");
    expect(app.getSegments()).toEqual(["(tabs)", "(home)"]);
  });

  it("opens a link from a full-screen flow in the Home tab", async () => {
    const app = renderRouter(buildContext() as never, { initialUrl: "/felt-report" });
    await app;
    await screen.findByTestId("screen");
    await act(async () => router.push("/event/abc"));
    expect(app.getSegments()).toEqual(["(tabs)", "(home)", "event", "[id]"]);
    expect(screen.getByTestId("scroll-aware-tab-bar")).toBeTruthy();
  });

  it.each(SHOWS_TAB_BAR)("%s opens inside the tabs, with the bar", async (url) => {
    const app = renderRouter(buildContext() as never, { initialUrl: url });
    await app;
    expect(await screen.findByTestId("screen")).toBeTruthy();
    expect(screen.getByTestId("scroll-aware-tab-bar")).toBeTruthy();
    expect(app.getPathname()).toBe(url);
  });

  it.each(FULL_SCREEN)("%s is full-screen, without the bar", async (url) => {
    await renderRouter(buildContext() as never, { initialUrl: url });
    expect(await screen.findByTestId("screen")).toBeTruthy();
    expect(screen.queryByTestId("scroll-aware-tab-bar")).toBeNull();
  });

  it("opens an event from the Map tab inside the Map tab, and Back returns there", async () => {
    const app = renderRouter(buildContext() as never, { initialUrl: "/map" });
    await app;
    expect(await screen.findByText("/(tabs)/(map)/map")).toBeTruthy();
    await act(async () => router.push("/event/abc"));
    expect(screen.getByTestId("scroll-aware-tab-bar")).toBeTruthy();
    expect(app.getSegments()).toEqual(["(tabs)", "(map)", "event", "[id]"]);
    await act(async () => router.back());
    expect(app.getPathname()).toBe("/map");
  });

  it("opens a profile from Settings inside the Settings tab", async () => {
    const app = renderRouter(buildContext() as never, { initialUrl: "/settings" });
    await app;
    await screen.findByText("/(tabs)/(settings)/settings");
    await act(async () => router.push("/u/sara"));
    expect(app.getSegments()).toEqual(["(tabs)", "(settings)", "u", "[username]"]);
  });

  it.each([
    ["Map", "/(tabs)/(map)/map"],
    ["Sensor", "/(tabs)/(sensor)/sensor"],
    ["Profile", "/(tabs)/(profile)/profile"],
    ["Settings", "/(tabs)/(settings)/settings"],
    ["Home", "/(tabs)/(home)/index"],
  ])("tapping the %s tab opens that tab's own first screen", async (label, text) => {
    // Start in another tab so the tapped one has never been opened: without a
    // per-tab first screen it would open whichever of its screens sorts first.
    const start = label === "Map" ? "/sensor" : "/map";
    await renderRouter(buildContext() as never, { initialUrl: start });
    await screen.findByTestId("screen");
    await fireEvent.press(screen.getByText(label));
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it("tapping the active tab on a screen opened inside it goes back to the tab's first screen", async () => {
    const app = renderRouter(buildContext() as never, { initialUrl: "/settings" });
    await app;
    await screen.findByText("/(tabs)/(settings)/settings");
    await act(async () => router.push("/safety"));
    expect(app.getPathname()).toBe("/safety");
    await fireEvent.press(screen.getByText("Settings"));
    await waitFor(() => expect(app.getPathname()).toBe("/settings"));
  });
});
