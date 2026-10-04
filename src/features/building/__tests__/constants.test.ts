import {
  CODE_PATTERN,
  KEY_PATTERN,
  isValidCode,
  isValidKey,
  normalizeCode,
  normalizeKey,
} from "../constants";

describe("codes and keys", () => {
  it("accepts the shape the database generates", () => {
    expect(CODE_PATTERN.test("BMH-7K3Q9P")).toBe(true);
    expect(CODE_PATTERN.test("BMH-7K3Q9I")).toBe(false);
    expect(KEY_PATTERN.test("ABCD2345")).toBe(true);
    expect(KEY_PATTERN.test("ABCD234")).toBe(false);
  });

  it("cleans what people type: case, spaces, dashes and look-alike letters", () => {
    expect(normalizeCode("bmh-7k3q9p")).toBe("BMH-7K3Q9P");
    expect(normalizeCode(" bmh 7k3q9p ")).toBe("BMH-7K3Q9P");
    expect(normalizeCode("7K3Q9P")).toBe("BMH-7K3Q9P");
    expect(normalizeCode("BMH-7K3Q9O")).toBe("BMH-7K3Q90");
    expect(normalizeCode("BMH-7K3QL9")).toBe("BMH-7K3Q19");
    expect(normalizeKey("abcd-2345")).toBe("ABCD2345");
    expect(normalizeKey("ABCD 2345")).toBe("ABCD2345");
  });

  it("validates after cleaning", () => {
    expect(isValidCode("bmh 7k3q9p")).toBe(true);
    expect(isValidCode("BMH-12")).toBe(false);
    expect(isValidKey("abcd 2345")).toBe(true);
    expect(isValidKey("abc")).toBe(false);
  });

  it("a code body that starts with the letters BMH is kept when the prefix is missing", () => {
    expect(normalizeCode("BMH123")).toBe("BMH-BMH123");
  });
});
