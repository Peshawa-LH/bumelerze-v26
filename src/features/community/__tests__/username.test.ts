import {
  isValidUsername,
  formatUsername,
  normalizeUsername,
  suggestUsername,
} from "../username";

describe("normalizeUsername", () => {
  it("trims, drops a leading @ and lowercases", () => {
    expect(normalizeUsername("  @Dilan.K ")).toBe("dilan.k");
    expect(normalizeUsername("@@x")).toBe("x");
  });
});

describe("isValidUsername (same rule as the database)", () => {
  it.each(["abc", "a_b.c9", "dilan.k", "x".repeat(24), "@Dilan"])(
    "accepts %s",
    (name) => {
      expect(isValidUsername(name)).toBe(true);
    },
  );

  it.each(["ab", "x".repeat(25), "has space", "dash-ed", "نازناو", "emoji😀", ""])(
    "rejects %s",
    (name) => {
      expect(isValidUsername(name)).toBe(false);
    },
  );
});

describe("formatUsername", () => {
  it("wraps the handle in a left-to-right isolate so it never reorders in Sorani or Arabic text", () => {
    const text = formatUsername("dilan.k");
    expect(text).toBe("⁦@dilan.k⁩");
    expect(text.replace(/[⁦⁩]/g, "")).toBe("@dilan.k");
  });
});

describe("suggestUsername", () => {
  const digits = () => "1234";

  it("builds a handle from a Latin name", () => {
    expect(suggestUsername("Shilan Ahmed", digits)).toBe("shilan.ahmed");
    expect(suggestUsername("Çiya Hêvî", digits)).toBe("ciya.hevi");
  });

  it("falls back to user + digits for a name with no Latin letters", () => {
    expect(suggestUsername("شیلان", digits)).toBe("user1234");
    expect(suggestUsername("شیلان", digits)).toMatch(/^[a-z0-9_.]{3,24}$/);
  });

  it("pads very short names and always returns a valid handle", () => {
    for (const name of ["Al", "A", "Ø", "  ", "Name With A Very Long Surname Indeed"]) {
      expect(isValidUsername(suggestUsername(name, digits))).toBe(true);
    }
  });
});
