import { CATALOG_FIRST_YEAR, catalogCurrentYear, parseFilterInput } from "../filter-input";

const MAG = { min: 0, max: 8, decimals: 1 };
const YEAR = { min: CATALOG_FIRST_YEAR, max: 2026, decimals: 0 };

describe("parseFilterInput", () => {
  it.each([
    ["4.5", 4.5],
    [" 4.5 ", 4.5],
    ["4,5", 4.5],
    ["٤٫٥", 4.5],
    ["٤.٥", 4.5],
    ["۴٫۵", 4.5],
    ["5", 5],
    [".5", 0.5],
    ["4.56", 4.6],
  ])("magnitude %p -> %p", (text, expected) => {
    expect(parseFilterInput(text, MAG)).toBe(expected);
  });

  it.each([
    ["1990", 1990],
    ["١٩٩٠", 1990],
    ["1,990", 1990],
    ["1990.6", 1991],
  ])("year %p -> %p", (text, expected) => {
    expect(parseFilterInput(text, YEAR)).toBe(expected);
  });

  it("clamps into the range", () => {
    expect(parseFilterInput("12", MAG)).toBe(8);
    expect(parseFilterInput("-1", MAG)).toBe(0);
    expect(parseFilterInput("100", YEAR)).toBe(872);
    expect(parseFilterInput("9999", YEAR)).toBe(2026);
  });

  it.each(["", "  ", "abc", "4.5.1", "4..5", "M4"])("rejects %p", (text) => {
    expect(parseFilterInput(text, MAG)).toBeNull();
  });

  it("current year comes from the clock", () => {
    expect(catalogCurrentYear(new Date(2031, 0, 1))).toBe(2031);
  });
});
