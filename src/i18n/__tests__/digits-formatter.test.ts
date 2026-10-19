import i18n from "@/i18n";

/**
 * The `{{value, digits}}` interpolation formatter registered in
 * `src/i18n/index.ts`: a locale string can ask for the interpolated number
 * in its own digit glyphs, so a template whose number is also the plural
 * `count` ("{{count, digits}} stations") and the Settings footer version
 * ("وەشانی {{version, digits}}") render Eastern Arabic-Indic digits in Sorani
 * and Arabic without a second placeholder or a code change (E-5/E-6/B-16).
 */
describe("i18next `digits` formatter", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it("is registered on the shared instance", () => {
    expect(i18n.services.formatter).toBeDefined();
  });

  it.each([
    ["ckb", "وەشانی ٢٦.١.٠"],
    ["ar", "الإصدار ٢٦.١.٠"],
    ["en", "Version 26.1.0"],
    ["kmr", "Guherto 26.1.0"],
  ] as const)("renders the Settings footer version in %s digits", async (locale, expected) => {
    await i18n.changeLanguage(locale);
    expect(i18n.t("settings.footerVersion", { version: "26.1.0" })).toBe(expected);
  });

  it.each([
    ["ckb", "وەشانی ٢٦.٣.٠ (\u2066abc1234\u2069)"],
    ["ar", "الإصدار ٢٦.٣.٠ (\u2066abc1234\u2069)"],
    ["en", "Version 26.3.0 (\u2066abc1234\u2069)"],
    ["kmr", "Guherto 26.3.0 (\u2066abc1234\u2069)"],
  ] as const)(
    "localises the version but never the build hash in %s (D90)",
    async (locale, expected) => {
      await i18n.changeLanguage(locale);
      expect(
        i18n.t("settings.footerVersionBuild", {
          version: "26.3.0",
          build: "\u2066abc1234\u2069",
        }),
      ).toBe(expected);
    },
  );

  it("localises a numeric plural `count` without disturbing plural selection", async () => {
    await i18n.changeLanguage("ckb");
    expect(i18n.t("stations.listTitle", { count: 37 })).toBe("٣٧ وێستگە");
    await i18n.changeLanguage("ar");
    expect(i18n.t("stations.listTitle", { count: 37 })).toBe("٣٧ محطة");
    await i18n.changeLanguage("en");
    expect(i18n.t("stations.listTitle", { count: 37 })).toBe("37 stations");
  });

  it("passes non-digit characters through untouched", async () => {
    await i18n.changeLanguage("ckb");
    expect(i18n.t("stations.distanceFromReference", { km: 94 })).toBe("٩٤ کم لە هەولێرەوە");
  });
});
