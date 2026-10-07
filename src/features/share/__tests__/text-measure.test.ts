import {
  estimateTextWidth,
  fitFontSize,
  wrapText,
  wrapTextBalanced,
} from "../text-measure";

describe("estimateTextWidth", () => {
  it("scales with the font size, and bold is wider", () => {
    expect(estimateTextWidth("Urmia", 40, 400)).toBeCloseTo(
      2 * estimateTextWidth("Urmia", 20, 400),
    );
    expect(estimateTextWidth("Urmia", 40, 700)).toBeGreaterThan(
      estimateTextWidth("Urmia", 40, 400),
    );
  });

  it("ignores bidi control characters", () => {
    expect(estimateTextWidth("⁦81 km⁩", 30, 400)).toBe(
      estimateTextWidth("81 km", 30, 400),
    );
  });

  it("measures Arabic script too", () => {
    expect(estimateTextWidth("ورمێ", 30, 400)).toBeGreaterThan(0);
  });
});

describe("wrapText", () => {
  it("keeps a short text on one line", () => {
    expect(wrapText("81 km N of Urmia, Iran", 44, 700, 968, 2)).toEqual([
      "81 km N of Urmia, Iran",
    ]);
  });

  it("wraps at word boundaries", () => {
    const lines = wrapText("one two three four five six seven", 44, 700, 400, 4);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe("one two three four five six seven");
  });

  it("ends the last line with an ellipsis when the text does not fit", () => {
    const lines = wrapText(
      "one two three four five six seven eight nine ten",
      44,
      700,
      300,
      2,
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith("…")).toBe(true);
  });
});

describe("wrapTextBalanced", () => {
  it("breaks a two-line sentence near its middle, not with one orphan word", () => {
    const text = "Did you feel it? Report in Bumelerze";
    const greedy = wrapText(text, 46, 700, 718, 3);
    const balanced = wrapTextBalanced(text, 46, 700, 718, 3);
    expect(balanced.join(" ")).toBe(text);
    expect(balanced).toHaveLength(greedy.length);
    expect(Math.abs(balanced[0]!.length - balanced[1]!.length)).toBeLessThanOrEqual(
      Math.abs(greedy[0]!.length - greedy[1]!.length),
    );
  });
});

describe("fitFontSize", () => {
  it("keeps the size when it fits and shrinks, to a floor, when it does not", () => {
    expect(fitFontSize("short", 40, 400, 500, 20)).toBe(40);
    const shrunk = fitFontSize(
      "a very very very long credit line indeed",
      40,
      400,
      300,
      20,
    );
    expect(shrunk).toBeLessThan(40);
    expect(shrunk).toBeGreaterThanOrEqual(20);
    expect(fitFontSize("x".repeat(400), 40, 400, 100, 20)).toBe(20);
  });
});
