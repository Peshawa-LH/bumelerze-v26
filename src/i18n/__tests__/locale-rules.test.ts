import ar from "../locales/ar.json";
import ckb from "../locales/ckb.json";
import en from "../locales/en.json";
import kmr from "../locales/kmr.json";

/**
 * Static rules for the Sorani and Arabic catalogs that a reviewer walk kept
 * finding by eye (2026-10-14 batch A2):
 *  - the brand is Latin "Bumelerze" in Arabic (owner: a brand name does not
 *    change) and "بوومەلەرزە" in Sorani, so no Sorani-only letter may sit in
 *    Arabic running text and no single-و spelling in Sorani;
 *  - numbers in both scripts are Eastern Arabic-Indic, except standard codes
 *    and formulas that stay ASCII on purpose;
 *  - the percent sign follows the number and a bidi-mirrored "<" never
 *    appears in a sentence (it drew as ">" in RTL and inverted the meaning);
 *  - no Sorani place template glues the "ەوە" suffix onto a town name.
 */

type Catalog = Record<string, unknown>;

function entries(catalog: Catalog, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out.push([path, value]);
    } else if (value !== null && typeof value === "object") {
      out.push(...entries(value as Catalog, path));
    }
  }
  return out;
}

const ALL = { en, ckb, kmr, ar } as const;

/** Latin tokens that legitimately carry ASCII digits in any locale:
 * standard codes, model names, parameter symbols, ids and URLs. */
const ASCII_DIGIT_TOKENS =
  /\{\{[^}]*\}\}|https?:\/\/\S+|app\.bumelerze\.com|bumelerze\.com|bml\d*|EN 1998-1|ASCE 7-\d\d|ISC-20\d\d|IMS-25|EC8|Vs30|Vs5\b|\bS1\b|\bSM1\b|\bSD1\b|\bT0\b|Ω0|DG\d|CY14|ASB14|BSSA14|Kale15(?:-Iran)?|SRTM30|srtm30_plus|Fa\b|Fv\b|CC BY 4\.0/g;

/** Strings whose remaining ASCII digits are a formula or an input format the
 * reader must type back, kept ASCII on purpose (E-5/E-6 decision list). */
const ASCII_DIGIT_EXCEPTIONS = new Set([
  "handbook.spectrum.legend.csFloor", // Cs = 0.044 SDS I
  "handbook.spectrum.table.csFloor", // Cs = 0.044 SDS I
  "handbook.spectrum.table.saAtOneSecond", // T = 1.0
  "handbook.spectrum.period.governedBy.floor", // 0.044·SDS·I
  "handbook.spectrum.ec8.params", // 2.5·S·ag
  "handbook.sheet.verticalOmitted", // SDS ≤ 0.125
  "admin.people.filters.dateInvalid", // an ISO date example the field accepts
]);

describe("Sorani and Arabic catalog rules", () => {
  it.each(["ckb", "ar"] as const)(
    "%s uses Eastern Arabic-Indic digits outside codes and formulas",
    (locale) => {
      const offenders = entries(ALL[locale])
        .filter(([key]) => !ASCII_DIGIT_EXCEPTIONS.has(key))
        .filter(([, value]) => /[0-9]/.test(value.replace(ASCII_DIGIT_TOKENS, "")))
        .map(([key, value]) => `${key} = ${value}`);
      expect(offenders).toEqual([]);
    },
  );

  it.each(["ckb", "ar"] as const)(
    "%s writes the percent sign after the number and never a bare mirrored '<'",
    (locale) => {
      const offenders = entries(ALL[locale])
        .filter(
          ([, value]) =>
            /%\{\{|%[٠-٩0-9]/.test(value) ||
            // A "<" is only acceptable inside an LTR isolate (U+2066 … U+2069).
            /(?<!⁦)<[٠-٩0-9]/.test(value),
        )
        .map(([key, value]) => `${key} = ${value}`);
      expect(offenders).toEqual([]);
    },
  );

  it("spells 'less than one' in words in Sorani and Arabic (A-4)", () => {
    for (const key of ["donut.underOne", "eventDetail.risk.stackedBar.underOnePercent"]) {
      const path = key.split(".");
      const read = (catalog: Catalog) =>
        path.reduce<unknown>((o, k) => (o as Catalog | undefined)?.[k], catalog) as string;
      expect(read(ckb)).toBe("کەمتر لە ١");
      expect(read(ar)).toBe("أقل من ١");
    }
  });

  it("Arabic contains no Sorani-only letters outside the native name of Sorani itself", () => {
    // The two places the Arabic UI must show "کوردیی ناوەندی": the native
    // name table and the language picker label that quotes it (A-16).
    const NATIVE_NAME_KEYS = new Set(["settings.languageNative.ckb", "settings.languages.ckb"]);
    const offenders = entries(ar)
      .filter(([key]) => !NATIVE_NAME_KEYS.has(key))
      .filter(([, value]) => /[ێە]/.test(value))
      .map(([key, value]) => `${key} = ${value}`);
    expect(offenders).toEqual([]);
  });

  it("Arabic names the brand in Latin letters, isolated inside Arabic text", () => {
    const withBrand = entries(ar).filter(([, value]) => value.includes("Bumelerze"));
    expect(withBrand.length).toBeGreaterThan(40);
    for (const [key, value] of withBrand) {
      if (value === "Bumelerze") continue;
      if (/^[\x20-\x7E·™]*$/.test(value)) continue; // pure Latin strings need no isolate
      expect(`${key}: ${value}`).toMatch(/⁦Bumelerze⁩/);
    }
  });

  it("Sorani spells the brand and the word for earthquake with a long vowel (بوومەلەرزە)", () => {
    const offenders = entries(ckb)
      .filter(([, value]) => value.includes("بومەلەرزە"))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it("no Sorani template glues the 'ەوە' suffix onto a town or agency name (A-5/B-13)", () => {
    const offenders = entries(ckb)
      .filter(([, value]) => /\{\{(city|agencies)\}\}ەوە/.test(value))
      .map(([key, value]) => `${key} = ${value}`);
    expect(offenders).toEqual([]);
    expect(ckb.geo.placeLine.template).toBe("{{distance}} {{direction}}ی {{city}}");
    expect(ckb.events.distanceFromCity).toBe("{{distance}} دوور لە {{city}}");
    expect(ar.geo.placeLine.template).toBe("{{distance}} {{direction}} {{city}}");
  });

  it("the language picker names every language in its own script as well (A-16/B-10)", () => {
    for (const catalog of [ckb, kmr, ar]) {
      expect(catalog.settings.languages.en).toContain("English");
      expect(catalog.settings.languages.ar).toContain("العربية");
      expect(catalog.settings.languages.kmr).toContain("Kurmancî");
      expect(catalog.settings.languages.ckb).toContain("کوردیی ناوەندی");
    }
  });

  it("the tour names shaking maps with the app's own term, never the Latin product name (A-15)", () => {
    expect(ckb.tour.stops.map.title).not.toContain("SHAKEmap");
    expect(ckb.tour.stops.map.title).toContain("نەخشەی لەرزین");
    expect(ar.tour.stops.map.title).not.toContain("SHAKEmap");
    expect(kmr.tour.stops.map.title).not.toContain("SHAKEmap");
  });
});

describe("catalog hygiene", () => {
  const DELETED_DEAD_KEYS = [
    "admin.ranks.title",
    "handbook.spectrum.rNote",
    "handbook.spectrum.ec8.caveat",
    "posts.helpfulCount",
    "imSafe.status.undone",
  ];

  it.each(DELETED_DEAD_KEYS)("dead key %s stays deleted from every locale", (key) => {
    for (const catalog of Object.values(ALL)) {
      const value = key
        .split(".")
        .reduce<unknown>((o, k) => (o as Catalog | undefined)?.[k], catalog);
      expect(value).toBeUndefined();
    }
  });

  it("keeps sensor.phone.title: the website app-facts lock still cites it", () => {
    expect(typeof en.sensor.phone.title).toBe("string");
  });

  it("the username placeholder is a translatable key, not a literal in the form", () => {
    for (const catalog of Object.values(ALL)) {
      expect(typeof catalog.account.profile.usernamePlaceholder).toBe("string");
    }
  });
});
