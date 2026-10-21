import { act, cleanup, render, screen } from "@testing-library/react-native";
import { readFileSync } from "fs";
import { join } from "path";
import { LocaleDirContext } from "expo-router/react-navigation";
import { useContext } from "react";
import { Platform, Text } from "react-native";

import i18n from "@/i18n";

import { StackDirection, startingDirection } from "../StackDirection";

/**
 * iOS: after a language switch that flips the reading direction (a JS
 * restart inside the same app process), the native stack headers kept the
 * side of the language the process started in until the next cold start:
 * the back button of every pushed screen stayed on the right after switching
 * from Sorani to English (and the reverse). React Navigation already passed
 * the right direction; react-native-screens applies it to a navigation bar
 * only when it changes. `StackDirection` starts each stack on the other
 * direction and settles on the app language's one right after it mounts.
 */

/** What the native-stack header config reads (`useLocale`). */
function Direction() {
  const direction = useContext(LocaleDirContext);
  return <Text testID="direction">{direction}</Text>;
}

describe("StackDirection", () => {
  const originalLanguage = i18n.language;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it.each([
    ["en", "ltr"],
    ["kmr", "ltr"],
    ["ckb", "rtl"],
    ["ar", "rtl"],
  ])(
    "iOS (%s): starts the stack on the other direction, then settles on the app language's (%s)",
    async (language, settled) => {
      await i18n.changeLanguage(language);
      await render(
        <StackDirection>
          <Direction />
        </StackDirection>,
      );
      expect(screen.getByTestId("direction").props.children).toBe(
        startingDirection(settled as "ltr" | "rtl"),
      );
      await act(async () => {
        jest.runAllTimers();
      });
      expect(screen.getByTestId("direction").props.children).toBe(settled);
    },
  );

  it("follows the app language, not the direction the app started in", async () => {
    await i18n.changeLanguage("ckb");
    await render(
      <LocaleDirContext.Provider value="ltr">
        <StackDirection>
          <Direction />
        </StackDirection>
      </LocaleDirContext.Provider>,
    );
    await act(async () => {
      jest.runAllTimers();
    });
    expect(screen.getByTestId("direction").props.children).toBe("rtl");
    // A switch in Settings turns the headers at once (before the restart).
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    expect(screen.getByTestId("direction").props.children).toBe("ltr");
  });

  it.each(["web", "android"] as const)(
    "%s: leaves the stack on the container's direction, as before",
    async (os) => {
      const original = Platform.OS;
      Platform.OS = os;
      try {
        // English app, a right-to-left container: only a provider of its
        // own would turn it to "ltr".
        await i18n.changeLanguage("en");
        await render(
          <LocaleDirContext.Provider value="rtl">
            <StackDirection>
              <Direction />
            </StackDirection>
          </LocaleDirContext.Provider>,
        );
        await act(async () => {
          jest.runAllTimers();
        });
        expect(screen.getByTestId("direction").props.children).toBe("rtl");
      } finally {
        Platform.OS = original;
      }
    },
  );

  it("wraps every Stack layout of the app", () => {
    const root = join(__dirname, "..", "..", "..");
    const layouts = [
      "app/_layout.tsx",
      "app/(tabs)/(home,map,sensor,profile,settings)/_layout.tsx",
      "app/felt-report/_layout.tsx",
      "app/onboarding/_layout.tsx",
    ];
    for (const layout of layouts) {
      const source = readFileSync(join(root, layout), "utf8");
      expect({ layout, wrapped: /<StackDirection>\s*<Stack[\s>]/.test(source) }).toEqual({
        layout,
        wrapped: true,
      });
    }
  });
});
