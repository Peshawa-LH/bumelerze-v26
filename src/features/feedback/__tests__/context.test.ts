import { Platform } from "react-native";

import i18n from "@/i18n";

import { buildFeedbackContext } from "../context";

/**
 * `buildFeedbackContext` — automatically-captured context (wave brief:
 * "Capture the context automatically rather than asking: app version from
 * the real version string (not hardcoded), current locale, platform, and
 * where possible which screen the user came from"). `expo-constants` is
 * mocked explicitly (rather than relying on jest-expo's own default) so the
 * asserted app version is deterministic and clearly tied to the mock, not
 * incidentally whatever this repo's `app.config.ts` happens to say today.
 *
 * Statically imported (no `jest.resetModules()`/fresh-`require()` dance,
 * unlike `device-id.test.ts`): `context.ts` has no per-call module-level
 * state to reset between tests, and resetting modules here would actually
 * be actively wrong — it would make `require("../context")` re-import a
 * SEPARATE `@/i18n` singleton instance from the one this file calls
 * `changeLanguage()` on, silently decoupling the two.
 */

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "9.9.9" } },
}));

describe("buildFeedbackContext", () => {
  const originalLanguage = i18n.language;
  const originalPlatformOS = Platform.OS;

  afterEach(async () => {
    Platform.OS = originalPlatformOS;
    if (i18n.language !== originalLanguage) {
      await i18n.changeLanguage(originalLanguage);
    }
  });

  it("captures the real app version from expo-constants, never a hardcoded string", () => {
    expect(buildFeedbackContext(null).appVersion).toBe("9.9.9");
  });

  it("captures the current i18next locale", async () => {
    await i18n.changeLanguage("ckb");

    expect(buildFeedbackContext(null).locale).toBe("ckb");
  });

  it("captures the platform, narrowed to ios | android | web", () => {
    Platform.OS = "android";

    expect(buildFeedbackContext(null).platform).toBe("android");
  });

  it("passes the screen argument straight through", () => {
    expect(buildFeedbackContext("settings").screen).toBe("settings");
  });

  it("defaults screen to null when not provided a real route", () => {
    expect(buildFeedbackContext(null).screen).toBeNull();
  });
});
