import { toMapLibreNativeLabel } from "../native-label-text";

const HEH = "ه";
const ZWNJ = "‌";
const FARSI_YEH = "ی";
const LAM = "ل";
const SMALL_V = "ٚ";

describe("toMapLibreNativeLabel", () => {
  it("[regression] respells ە so the letter before it joins (هەولێر read as ەەولێر on iOS)", () => {
    // Simulator, 2026-10-20: MapLibre Native's ICU shaper treats ە as a
    // non-joining letter, so the heh before it fell back to its isolated
    // form. Heh + ZWNJ is how ە behaves: joins back, never forward.
    expect(toMapLibreNativeLabel("هەولێر")).toBe(
      `${HEH}${HEH}${ZWNJ}و${LAM}${FARSI_YEH}${SMALL_V}ر`,
    );
  });

  it("draws ێ and ڵ as their base letter with the small v, so both sides join", () => {
    expect(toMapLibreNativeLabel("سلێمانی")).toBe(`س${LAM}${FARSI_YEH}${SMALL_V}مانی`);
    expect(toMapLibreNativeLabel("هەڵەبجە")).toBe(
      `${HEH}${HEH}${ZWNJ}${LAM}${SMALL_V}${HEH}${ZWNJ}بج${HEH}${ZWNJ}`,
    );
  });

  it("leaves letters ICU already shapes (ۆ, ڕ) and every non-Kurdish label unchanged", () => {
    expect(toMapLibreNativeLabel("ڕانیە")).toBe(`ڕانی${HEH}${ZWNJ}`);
    expect(toMapLibreNativeLabel("کۆیە")).toBe(`کۆی${HEH}${ZWNJ}`);
    expect(toMapLibreNativeLabel("أربيل")).toBe("أربيل");
    expect(toMapLibreNativeLabel("Hewlêr")).toBe("Hewlêr");
    expect(toMapLibreNativeLabel("")).toBe("");
  });

  it("is idempotent (a label respelled twice is unchanged)", () => {
    const once = toMapLibreNativeLabel("هەڵەبجە سلێمانی");
    expect(toMapLibreNativeLabel(once)).toBe(once);
  });
});
