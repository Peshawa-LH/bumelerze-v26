import { renderHook } from "@testing-library/react-native";

import i18n from "@/i18n";

import { useTextDir } from "../text-dir";

/**
 * Review C-3: direction must follow the app language (`i18n.language`), not
 * `i18n.dir()`. i18next's `dir()` reads the RESOLVED language, which falls
 * back to English while a Sorani or Arabic file has not been downloaded on
 * the web, so a right-to-left page got left-to-right text.
 */
describe("useTextDir", () => {
  const original = i18n.language;
  afterEach(async () => {
    await i18n.changeLanguage(original);
  });

  it.each([
    ["en", "ltr"],
    ["kmr", "ltr"],
    ["ckb", "rtl"],
    ["ar", "rtl"],
  ])("%s reads %s", async (locale, expected) => {
    await i18n.changeLanguage(locale);
    const { result } = await renderHook(() => useTextDir());
    expect(result.current.writingDirection).toBe(expected);
  });

  it("stays right-to-left for Sorani even while its translation file is missing", async () => {
    const bundle = i18n.getResourceBundle("ckb", "translation");
    i18n.removeResourceBundle("ckb", "translation");
    try {
      await i18n.changeLanguage("ckb");
      // The failure mode: i18next resolved to English.
      expect(i18n.dir()).toBe("ltr");
      const { result } = await renderHook(() => useTextDir());
      expect(result.current.writingDirection).toBe("rtl");
    } finally {
      i18n.addResourceBundle("ckb", "translation", bundle, true, true);
      await i18n.changeLanguage("ckb");
    }
  });
});
