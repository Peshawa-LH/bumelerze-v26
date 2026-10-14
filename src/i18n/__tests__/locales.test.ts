import ar from "../locales/ar.json";
import ckb from "../locales/ckb.json";
import en from "../locales/en.json";
import kmr from "../locales/kmr.json";
import { flattenKeys } from "../locale-keys";

/** i18next's CLDR plural suffixes. A language may legitimately carry MORE
 * forms than English (Arabic has zero/one/two/few/many/other; English only
 * one/other) — without them i18next falls back to the English string for
 * the counts whose form is missing. So parity is checked on plural STEMS,
 * every locale must still provide `_other` for each stem, and the only
 * extra keys a locale may have are additional plural forms of a stem
 * English also pluralises. */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** The stems English pluralises: a key is a plural FORM only when English
 * has at least two differently-suffixed siblings of it. Enum-style option
 * keys that merely end in "_one" (`othersFelt.options.no_one`) stay plain
 * keys and must match one to one. */
function pluralStemsOf(keys: readonly string[]): Set<string> {
  const forms = new Map<string, Set<string>>();
  for (const key of keys) {
    const match = PLURAL_SUFFIX.exec(key);
    if (!match) continue;
    const stem = key.slice(0, -match[0].length);
    forms.set(stem, (forms.get(stem) ?? new Set<string>()).add(match[1] ?? ""));
  }
  return new Set([...forms].filter(([, suffixes]) => suffixes.size >= 2).map(([stem]) => stem));
}

function normaliseKey(key: string, pluralStems: ReadonlySet<string>): string {
  const match = PLURAL_SUFFIX.exec(key);
  if (!match) return key;
  const stem = key.slice(0, -match[0].length);
  return pluralStems.has(stem) ? `${stem}_#plural` : key;
}

describe("locale catalogs", () => {
  const catalogs = { en, ckb, kmr, ar } as const;

  it("loads all four locale catalogs", () => {
    for (const catalog of Object.values(catalogs)) {
      expect(catalog).toBeTruthy();
      expect(typeof catalog).toBe("object");
    }
  });

  it("gives every locale the exact same key set as the English source of truth (plural forms compared by stem)", () => {
    const sourceKeys = flattenKeys(en);
    expect(sourceKeys.length).toBeGreaterThan(0);
    const pluralStems = pluralStemsOf(sourceKeys);
    expect(pluralStems.size).toBeGreaterThan(0);
    const sourceNormalised = [...new Set(sourceKeys.map((key) => normaliseKey(key, pluralStems)))].sort();

    for (const [locale, catalog] of Object.entries(catalogs)) {
      if (locale === "en") continue;
      const keys = flattenKeys(catalog);
      const normalised = [...new Set(keys.map((key) => normaliseKey(key, pluralStems)))].sort();
      expect(normalised).toEqual(sourceNormalised);

      // A plural stem must at least have its `_other` form in every locale —
      // i18next's last resort before it falls back to the English string.
      for (const stem of pluralStems) {
        expect(keys).toContain(`${stem}_other`);
      }
    }
  });

  it("carries no `_status` marker — everything in these files is loaded into i18next as a translation", () => {
    for (const catalog of Object.values(catalogs)) {
      expect("_status" in catalog).toBe(false);
    }
  });
});
