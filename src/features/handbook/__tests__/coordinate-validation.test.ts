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
    expect(validateLatitude("٣٥.٥٦").error).toBe("notANumber");
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
