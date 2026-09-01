import i18n from "@/i18n";
import {
  formatApproximate,
  formatFixedLocalized,
  formatIntegerLocalized,
  localizeDigits,
  toAsciiDigits,
} from "../format-numbers";

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

describe("formatIntegerLocalized", () => {
  it("groups thousands with a comma, then localizes digits", () => {
    expect(formatIntegerLocalized(158965, "en")).toBe("158,965");
    expect(formatIntegerLocalized(158965, "kmr")).toBe("158,965");
    expect(formatIntegerLocalized(17079988, "en")).toBe("17,079,988");
  });

  it("uses a plain comma (not the locale's own numeral punctuation) in Sorani/Arabic too — same international-scientific-value convention as the decimal point", () => {
    expect(formatIntegerLocalized(158965, "ckb")).toBe("١٥٨,٩٦٥");
    expect(formatIntegerLocalized(158965, "ar")).toBe("١٥٨,٩٦٥");
  });

  it("does not add a comma below 1000", () => {
    expect(formatIntegerLocalized(999, "en")).toBe("999");
    expect(formatIntegerLocalized(0, "en")).toBe("0");
  });

  it("rounds to the nearest whole number first", () => {
    expect(formatIntegerLocalized(1234.6, "en")).toBe("1,235");
    expect(formatIntegerLocalized(1234.4, "en")).toBe("1,234");
  });

  it("handles negative values", () => {
    expect(formatIntegerLocalized(-1234, "en")).toBe("-1,234");
  });
});

describe("formatApproximate", () => {
  it("rounds to 2 significant figures with a translated \"million\" unit at/above 1,000,000", () => {
    expect(formatApproximate(17_079_988, "en", i18n.t)).toBe("17 million");
  });

  it("rounds to 2 significant figures with a translated \"thousand\" unit at/above 1,000", () => {
    expect(formatApproximate(379_500, "en", i18n.t)).toBe("380 thousand");
  });

  it("shows a plain localized integer below 1,000 (no unit word)", () => {
    expect(formatApproximate(920, "en", i18n.t)).toBe("920");
  });

  it("keeps a fractional value when 2 significant figures don't land on a whole unit", () => {
    expect(formatApproximate(1_250_000, "en", i18n.t)).toBe("1.3 million");
  });

  it("returns \"0\" for zero, never a unit word", () => {
    expect(formatApproximate(0, "en", i18n.t)).toBe("0");
  });

  it("localizes digits for ckb/ar", () => {
    expect(formatApproximate(920, "ckb", i18n.t)).toBe(localizeDigits("920", "ckb"));
  });
});

describe("toAsciiDigits", () => {
  it("leaves Latin input untouched", () => {
    expect(toAsciiDigits("35.5600")).toBe("35.5600");
    expect(toAsciiDigits("-0.25")).toBe("-0.25");
  });

  it("accepts the Eastern Arabic-Indic digits the app itself renders", () => {
    // The exact round trip a Sorani reader closes: they see ٣٥.٥٦ in the
    // results and type it back into the next field.
    expect(toAsciiDigits(localizeDigits("35.56", "ckb"))).toBe("35.56");
    expect(toAsciiDigits("٤٥٫٤٣")).toBe("45.43");
  });

  it("accepts Extended Arabic-Indic digits from a Persian keyboard", () => {
    expect(toAsciiDigits("۳۵.۵۶")).toBe("35.56");
  });

  it("maps the Arabic decimal separator to the one this app uses", () => {
    expect(toAsciiDigits("١٫٢٢")).toBe("1.22");
  });

  it("leaves anything that is not a digit alone, so bad input still fails", () => {
    expect(toAsciiDigits("abc")).toBe("abc");
    expect(toAsciiDigits("")).toBe("");
  });
});
