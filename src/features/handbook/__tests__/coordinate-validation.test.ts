import { validateLatitude, validateLongitude } from "../coordinate-validation";

describe("validateLatitude", () => {
  it("accepts a valid decimal value", () => {
    expect(validateLatitude("35.56")).toEqual({ value: 35.56, error: null });
  });

  it("accepts boundary values", () => {
    expect(validateLatitude("90").error).toBeNull();
    expect(validateLatitude("-90").error).toBeNull();
  });

  it("rejects empty input", () => {
    expect(validateLatitude("").error).toBe("empty");
    expect(validateLatitude("   ").error).toBe("empty");
  });

  it("rejects non-numeric input", () => {
    expect(validateLatitude("abc").error).toBe("notANumber");
  });

  it("rejects out-of-range values", () => {
    expect(validateLatitude("91").error).toBe("outOfRange");
    expect(validateLatitude("-91").error).toBe("outOfRange");
  });
});

describe("validateLongitude", () => {
  it("accepts a valid decimal value", () => {
    expect(validateLongitude("45.43")).toEqual({ value: 45.43, error: null });
  });

  it("rejects out-of-range values", () => {
    expect(validateLongitude("181").error).toBe("outOfRange");
    expect(validateLongitude("-181").error).toBe("outOfRange");
  });

  it("accepts boundary values", () => {
    expect(validateLongitude("180").error).toBeNull();
    expect(validateLongitude("-180").error).toBeNull();
  });
});

/**
 * REVERSED 2026-08-31. This file previously asserted the opposite --
 * `validateLatitude("٣٥.٥٦")` had to return "notANumber" -- alongside the
 * "Latin-digit input only" note in `coordinate-validation.ts`.
 *
 * That rule was about what the field WRITES, and rejecting on read was the
 * wrong half of it: the app renders every numeral to a Sorani or Arabic
 * reader in Eastern Arabic-Indic digits, and their keyboard produces them,
 * so the app was showing a number in one script and refusing to take it
 * back in that script. Accepting more cannot change what is displayed.
 */
describe("digit glyphs the reader actually types", () => {
  it("accepts a coordinate entered in Eastern Arabic-Indic digits", () => {
    // What a Sorani reader gets from their own keyboard, and what every
    // other number in the app is shown to them as. This used to be
    // "notANumber".
    expect(validateLatitude("٣٥.٥٦٠٠")).toEqual({ value: 35.56, error: null });
    expect(validateLongitude("٤٥٫٤٣")).toEqual({ value: 45.43, error: null });
  });

  it("still rejects text that is not a number in any script", () => {
    expect(validateLatitude("شوێن").error).toBe("notANumber");
  });

  it("still enforces the range on localized digits", () => {
    expect(validateLatitude("٩٩").error).toBe("outOfRange");
  });
});
