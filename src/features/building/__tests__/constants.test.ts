import {
  CODE_PATTERN,
  buildJoinLink,
  KEY_PATTERN,
  isValidCode,
  isValidKey,
  normalizeCode,
  normalizeKey,
  parseJoinLink,
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

describe("join link (N6)", () => {
  it("builds the link from the code and key and nothing else", () => {
    const link = buildJoinLink("BMH-7K3Q9P", "ABCD2345");
    expect(link).toBe("https://bumelerze.com/app/home/join?code=BMH-7K3Q9P&key=ABCD2345");
    expect(new URL(link).searchParams.size).toBe(2);
    expect(link).not.toMatch(/lat|lon|location/i);
  });

  it("reads back the web link, the app-scheme link and lowercase or spaced values", () => {
    const expected = { code: "BMH-7K3Q9P", key: "ABCD2345" };
    expect(parseJoinLink(buildJoinLink("BMH-7K3Q9P", "ABCD2345"))).toEqual(expected);
    expect(parseJoinLink("bumelerze://home/join?code=BMH-7K3Q9P&key=ABCD2345")).toEqual(
      expected,
    );
    expect(
      parseJoinLink(
        "  https://bumelerze.com/app/home/join?key=abcd2345&code=bmh-7k3q9p ",
      ),
    ).toEqual(expected);
    expect(
      parseJoinLink(
        "https://bumelerze.com/app/home/join/?code=BMH7K3Q9P&key=ABCD%202345",
      ),
    ).toEqual(expected);
  });

  it("refuses anything else: other pages, missing or malformed parts, plain text", () => {
    expect(parseJoinLink("https://example.com/?code=BMH-7K3Q9P&key=ABCD2345")).toBeNull();
    expect(
      parseJoinLink("https://bumelerze.com/app/home/join?code=BMH-7K3Q9P"),
    ).toBeNull();
    expect(
      parseJoinLink("https://bumelerze.com/app/home/join?code=BMH-12&key=ABCD2345"),
    ).toBeNull();
    expect(parseJoinLink("https://bumelerze.com/app/home/join")).toBeNull();
    expect(parseJoinLink("BMH-7K3Q9P")).toBeNull();
    expect(parseJoinLink("")).toBeNull();
  });
});
