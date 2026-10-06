import ar from "../locales/ar.json";
import ckb from "../locales/ckb.json";
import en from "../locales/en.json";
import kmr from "../locales/kmr.json";

/**
 * "HomeBase" is not a concept the reader sees (owner, 2026-10-06): the app
 * relies on the device location, and an optional "another place" covers family
 * elsewhere. The background reference place has no words at all.
 */

const CATALOGS = { en, ckb, kmr, ar } as const;

/** Every [path, string value] pair (keys may themselves contain dots). */
function entries(node: unknown, path: string[] = []): [string, string][] {
  if (typeof node === "string") {
    return [[path.join("/"), node]];
  }
  if (node !== null && typeof node === "object") {
    return Object.entries(node).flatMap(([key, value]) => entries(value, [...path, key]));
  }
  return [];
}

/** The words each language used for HomeBase, plus the English name. */
const FORBIDDEN: Record<keyof typeof CATALOGS, RegExp> = {
  en: /home\s?base/i,
  ckb: /بنکەی ماڵ|home\s?base/i,
  kmr: /Cihê Malê|Cihek Malê|home\s?base/i,
  ar: /الموطن|موطن|home\s?base/i,
};

describe("no HomeBase in any locale", () => {
  for (const [locale, catalog] of Object.entries(CATALOGS) as [
    keyof typeof CATALOGS,
    Record<string, unknown>,
  ][]) {
    it(`${locale}: no visible string mentions it`, () => {
      const offenders = entries(catalog)
        .filter(([, value]) => FORBIDDEN[locale].test(value))
        .map(([path]) => path);
      expect(offenders).toEqual([]);
    });

    it(`${locale}: no string key is named after it`, () => {
      const offenders = entries(catalog)
        .map(([path]) => path)
        .filter((path) => /home[\s-]?base/i.test(path));
      expect(offenders).toEqual([]);
    });
  }

  it("English values never say 'HomeBase' in any casing or spacing", () => {
    const values = entries(en).map(([, value]) => value);
    expect(values.filter((value) => /home[\s-]?base/i.test(value))).toEqual([]);
  });
});
