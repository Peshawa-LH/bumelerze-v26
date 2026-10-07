import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

import ar from "@/i18n/locales/ar.json";
import ckb from "@/i18n/locales/ckb.json";
import en from "@/i18n/locales/en.json";
import kmr from "@/i18n/locales/kmr.json";

import { ROMAN_NUMERAL } from "../__fixtures__/roman-numerals";
import {
  formatIntensity,
  formatIntensityRange,
  intensityLegendLabels,
} from "../intensity-format";

describe("formatIntensity", () => {
  it("writes Roman numerals in English and Kurmanji", () => {
    for (const locale of ["en", "kmr"]) {
      expect(formatIntensity(1, locale)).toBe("I");
      expect(formatIntensity(5, locale)).toBe("V");
      expect(formatIntensity(9, locale)).toBe("IX");
      expect(formatIntensity(12, locale)).toBe("XII");
    }
  });

  it("writes Eastern Arabic digits in Sorani and Arabic", () => {
    for (const locale of ["ckb", "ar"]) {
      expect(formatIntensity(1, locale)).toBe("١");
      expect(formatIntensity(5, locale)).toBe("٥");
      expect(formatIntensity(6, locale)).toBe("٦");
      expect(formatIntensity(12, locale)).toBe("١٢");
    }
  });

  it("rounds to the nearest level and clamps to 1..12", () => {
    expect(formatIntensity(5.2, "en")).toBe("V");
    expect(formatIntensity(0, "en")).toBe("I");
    expect(formatIntensity(40, "en")).toBe("XII");
    expect(formatIntensity(0, "ckb")).toBe("١");
  });

  it("reads a half step as the two levels it sits between", () => {
    expect(formatIntensity(5.5, "en")).toBe("V–VI");
    expect(formatIntensity(5.5, "kmr")).toBe("V–VI");
    expect(formatIntensity(5.5, "ckb")).toBe("٥–٦");
    expect(formatIntensity(5.5, "ar")).toBe("٥–٦");
  });

  it("falls back to Roman for a locale it does not know", () => {
    expect(formatIntensity(7, "fr")).toBe("VII");
  });
});

describe("formatIntensityRange", () => {
  it("joins the two ends, ordered low to high", () => {
    expect(formatIntensityRange(5, 7, "en")).toBe("V–VII");
    expect(formatIntensityRange(7, 5, "en")).toBe("V–VII");
    expect(formatIntensityRange(5, 7, "ckb")).toBe("٥–٧");
  });

  it("collapses a single level to one numeral", () => {
    expect(formatIntensityRange(6, 6, "en")).toBe("VI");
    expect(formatIntensityRange(6, 6, "ar")).toBe("٦");
  });
});

describe("intensityLegendLabels", () => {
  it("lists 1..12 in order, in the locale's own numerals", () => {
    expect(intensityLegendLabels("en").map((entry) => entry.label)).toEqual([
      "I",
      "II",
      "III",
      "IV",
      "V",
      "VI",
      "VII",
      "VIII",
      "IX",
      "X",
      "XI",
      "XII",
    ]);
    const digits = intensityLegendLabels("ckb");
    expect(digits).toHaveLength(12);
    expect(digits[0]).toEqual({ level: 1, label: "١" });
    expect(digits[11]).toEqual({ level: 12, label: "١٢" });
  });
});

describe("intensity wording in the locale files", () => {
  function strings(node: unknown): string[] {
    if (typeof node === "string") return [node];
    if (node && typeof node === "object") return Object.values(node).flatMap(strings);
    return [];
  }

  const intensitySections: [string, (locale: typeof en) => unknown][] = [
    ["eventHub.impact", (l) => l.eventHub.impact],
    ["eventDetail.risk.shakingLevels", (l) => l.eventDetail.risk.shakingLevels],
    ["eventDetail.shakemap", (l) => l.eventDetail.shakemap],
    ["building.damage.intensity", (l) => l.building.damage.intensity],
  ];

  it("keeps Roman numerals out of Sorani and Arabic intensity strings", () => {
    for (const [name, pick] of intensitySections) {
      for (const [code, locale] of [
        ["ckb", ckb],
        ["ar", ar],
      ] as const) {
        for (const text of strings(pick(locale as unknown as typeof en))) {
          expect({ name, code, text, roman: ROMAN_NUMERAL.test(text) }).toMatchObject({
            roman: false,
          });
        }
      }
    }
  });

  it("takes the level from the formatter in every language (no Roman typed into the sentence)", () => {
    for (const locale of [en, kmr, ckb, ar]) {
      for (const text of strings(locale.building.damage.intensity)) {
        expect(text).toContain("{{level}}");
      }
      expect(locale.eventHub.impact.people.caption).toContain("{{level}}");
    }
  });
});

describe("source: no component prints the Roman table directly", () => {
  const ROOT = join(__dirname, "../../..");
  const ALLOWED = new Set([
    join("features", "shakemap", "intensity-ramp.ts"),
    join("features", "shakemap", "intensity-format.ts"),
  ]);

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        return name === "__tests__" ? [] : walk(path);
      }
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }

  it("only the formatter reads INTENSITY_ROMAN_NUMERALS", () => {
    const offenders = walk(ROOT)
      .filter((file) => !ALLOWED.has(file.slice(ROOT.length + 1)))
      .filter((file) => readFileSync(file, "utf8").includes("INTENSITY_ROMAN_NUMERALS"));
    // Comments may still name it; code may not import it.
    const importing = offenders.filter((file) =>
      /import[^;]*INTENSITY_ROMAN_NUMERALS[^;]*from/s.test(readFileSync(file, "utf8")),
    );
    expect(importing).toEqual([]);
  });
});
