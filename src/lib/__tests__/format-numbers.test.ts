import { formatFixedLocalized, localizeDigits } from "../format-numbers";

describe("localizeDigits", () => {
  it("renders Eastern Arabic-Indic digits for ckb and ar", () => {
    expect(localizeDigits("1234567890", "ckb")).toBe("١٢٣٤٥٦٧٨٩٠");
    expect(localizeDigits("1234567890", "ar")).toBe("١٢٣٤٥٦٧٨٩٠");
  });

  it("keeps Latin digits for en and kmr", () => {
    expect(localizeDigits("1234567890", "en")).toBe("1234567890");
    expect(localizeDigits("1234567890", "kmr")).toBe("1234567890");
  });

  it("keeps the '.' decimal separator untouched in every locale (scientific convention)", () => {
    expect(localizeDigits("38.2", "ckb")).toBe("٣٨.٢");
    expect(localizeDigits("38.2", "ar")).toBe("٣٨.٢");
    expect(localizeDigits("38.2", "en")).toBe("38.2");
  });

  it("passes through non-digit characters (minus sign, spaces) untouched", () => {
    expect(localizeDigits("-12 km", "ckb")).toBe("-١٢ km");
  });

  it("falls back to Latin digits for an unrecognized locale", () => {
    expect(localizeDigits("42", "fr")).toBe("42");
  });
});

describe("formatFixedLocalized", () => {
  it("fixes decimals then localizes digits", () => {
    expect(formatFixedLocalized(4.649, 1, "en")).toBe("4.6");
    expect(formatFixedLocalized(4.649, 1, "ckb")).toBe("٤.٦");
    expect(formatFixedLocalized(4.649, 1, "ar")).toBe("٤.٦");
    expect(formatFixedLocalized(4.649, 1, "kmr")).toBe("4.6");
  });

  it("supports zero decimals", () => {
    expect(formatFixedLocalized(3, 0, "ckb")).toBe("٣");
  });
});
