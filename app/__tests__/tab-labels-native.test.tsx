/**
 * iOS/Android tab labels: drawn by the app so a long Sorani label shrinks
 * instead of being cut to "ڕێکخستنە…" (iPhone, 2026-10-20), and each tab
 * keeps a spoken name in the app language (React Navigation stops building
 * one for a drawn label; VoiceOver then read ", , ماڵەوە").
 */
import { readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { Text } from "react-native";
import { renderRouter, screen } from "expo-router/testing-library";
import { Stack } from "expo-router";

import i18n from "@/i18n";

import TabsLayout from "../(tabs)/_layout";
import TabStackLayout, {
  unstable_settings,
} from "../(tabs)/(home,map,sensor,profile,settings)/_layout";

/** The real route tree with stub screens (as tab-navigation-structure.test.tsx). */
const APP_DIR = join(__dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === "__tests__") return [];
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function context() {
  const routes: Record<string, unknown> = {};
  for (const file of walk(APP_DIR)) {
    const key = relative(APP_DIR, file).replace(/\.(web\.)?tsx$/, "");
    if (file.endsWith(".web.tsx") || key.endsWith("_layout")) continue;
    routes[key] = () => <Text testID="screen">{`/${key}`}</Text>;
  }
  routes["_layout"] = () => <Stack screenOptions={{ headerShown: false }} />;
  routes["(tabs)/_layout"] = TabsLayout;
  routes["(tabs)/(home,map,sensor,profile,settings)/_layout"] = {
    default: TabStackLayout,
    unstable_settings,
  };
  routes["felt-report/_layout"] = () => <Stack screenOptions={{ headerShown: false }} />;
  routes["onboarding/_layout"] = () => <Stack screenOptions={{ headerShown: false }} />;
  return routes;
}

describe("tab labels on iOS", () => {
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("[regression] shrink to fit on one line instead of being cut", async () => {
    await i18n.changeLanguage("ckb");
    await renderRouter(context() as never, { initialUrl: "/" });
    const label = await screen.findByText("ڕێکخستنەکان");
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props.adjustsFontSizeToFit).toBe(true);
    expect(label.props.minimumFontScale).toBe(0.8);
  });

  it("[regression] each tab is spoken by its title in the app language", async () => {
    await i18n.changeLanguage("ckb");
    await renderRouter(context() as never, { initialUrl: "/" });
    expect(await screen.findByLabelText("ڕێکخستنەکان")).toBeTruthy();
    expect(screen.getByLabelText("ماڵەوە")).toBeTruthy();
  });
});
