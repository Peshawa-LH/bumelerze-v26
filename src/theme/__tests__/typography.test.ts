import { Platform } from "react-native";

import { arabicScriptFontFor, typography } from "../typography";

describe("typography tokens", () => {
  it("[regression] state the reading start on iOS, where text without an alignment follows the app's iOS language", () => {
    // jest-expo runs as iOS.
    expect(Platform.OS).toBe("ios");
    for (const token of Object.values(typography(true))) {
      expect(token.textAlign).toBe("left");
    }
    for (const token of Object.values(typography(false))) {
      expect(token.textAlign).toBe("left");
    }
  });

  it("[regression] name Vazirmatn only once its faces are registered (a family named early kept the fallback's size: cut tab labels)", () => {
    expect(typography(true, false).bodyDefault.fontFamily).toBeUndefined();
    expect(typography(true, true).bodyDefault.fontFamily).toBe(
      arabicScriptFontFor("400"),
    );
    expect(typography(true).h1.fontFamily).toBe(arabicScriptFontFor("700"));
    expect(typography(false, true).bodyDefault.fontFamily).toBeUndefined();
  });

  it("keeps the Arabic-script line heights while the face is still loading", () => {
    expect(typography(true, false).bodyDefault.lineHeight).toBe(
      typography(true, true).bodyDefault.lineHeight,
    );
  });
});

describe("typography tokens on the web", () => {
  it("are unchanged: no alignment (react-native-web aligns each paragraph to its own start)", () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require with a web platform
      const rn = require("react-native") as typeof import("react-native");
      const original = rn.Platform.OS;
      rn.Platform.OS = "web";
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require with a web platform
        const web = require("../typography") as typeof import("../typography");
        expect(web.typography(true).bodyDefault.textAlign).toBeUndefined();
        expect(web.READING_START).toEqual({});
      } finally {
        rn.Platform.OS = original;
      }
    });
  });
});
