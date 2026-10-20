import { appLanguageCode } from "../language-codes";

describe("appLanguageCode", () => {
  it("reads the language of a phone tag", () => {
    expect(appLanguageCode("ckb-IQ")).toBe("ckb");
    expect(appLanguageCode("ckb_IQ")).toBe("ckb");
    expect(appLanguageCode("ar-IQ")).toBe("ar");
    expect(appLanguageCode("en-US")).toBe("en");
    expect(appLanguageCode("kmr")).toBe("kmr");
  });

  it('[decision 2026-10-20] takes iOS\'s generic Kurdish code "ku" as Kurmanji', () => {
    expect(appLanguageCode("ku")).toBe("kmr");
    expect(appLanguageCode("ku-TR")).toBe("kmr");
    expect(appLanguageCode("KU")).toBe("kmr");
  });

  it("is null for nothing", () => {
    expect(appLanguageCode(null)).toBeNull();
    expect(appLanguageCode("")).toBeNull();
    expect(appLanguageCode(42)).toBeNull();
  });
});
