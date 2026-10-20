import { firstStrongDirection } from "../bidi";

describe("firstStrongDirection", () => {
  it("takes the direction of the first letter", () => {
    expect(firstStrongDirection("سڵاو، چۆنی؟")).toBe("rtl");
    expect(firstStrongDirection("مرحبا")).toBe("rtl");
    expect(firstStrongDirection("Silav, tu çawa yî?")).toBe("ltr");
    expect(firstStrongDirection("Hello سڵاو")).toBe("ltr");
    expect(firstStrongDirection("سڵاو Hello")).toBe("rtl");
  });

  it("skips digits (also Eastern Arabic-Indic ones), punctuation and emoji", () => {
    expect(firstStrongDirection("١٢ کم")).toBe("rtl");
    expect(firstStrongDirection("12 km")).toBe("ltr");
    expect(firstStrongDirection("😮 !! Hello")).toBe("ltr");
    expect(firstStrongDirection("(٣) ٪")).toBeNull();
  });

  it("skips @usernames and isolated runs, as a browser skips isolates", () => {
    expect(firstStrongDirection("@shirin سڵاو")).toBe("rtl");
    expect(firstStrongDirection("\u2066bml20170001\u2069 بوومەلەرزە")).toBe("rtl");
  });

  it("has no direction for text without letters", () => {
    expect(firstStrongDirection("")).toBeNull();
    expect(firstStrongDirection("12:30 · 45%")).toBeNull();
  });
});
