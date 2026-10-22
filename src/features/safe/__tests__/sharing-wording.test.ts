import ar from "@/i18n/locales/ar.json";
import ckb from "@/i18n/locales/ckb.json";
import en from "@/i18n/locales/en.json";
import kmr from "@/i18n/locales/kmr.json";

/**
 * "I'm safe" wording states who it is shared with on purpose (the family
 * home, the follows the person chose) and never promises that nobody else
 * can see it. Since D98 verified Government officials see each account's
 * latest "I'm safe", so "Only approved members of this home see them" (the
 * Family page hint up to 26.4.3) and "Nobody in Bumelerze can see it" were
 * no longer true. The owner wants no mention of officials, so the text
 * names the people it is shared with and makes no exclusivity claim.
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

/** The "only" word of each language, and in English (the source the owner
 * approves, which the translations follow) also "nobody" / "no one". */
const EXCLUSIVE: Record<string, RegExp> = {
  en: /\bonly\b|\bnobody\b|\bno[- ]one\b/i,
  ckb: /تەنها|تەنیا/,
  kmr: /(?<!\p{L})tenê(?!\p{L})/iu,
  ar: /فقط|وحدك|وحدهم/,
};

const CATALOGS = { en, ckb, kmr, ar } as const;

/** Every key that says who sees an "I'm safe" check-in. */
function sharingKeys(catalog: Catalog): [string, string][] {
  return entries(catalog).filter(
    ([key]) => key.startsWith("imSafe.") || key.startsWith("notificationSettings.safe."),
  );
}

describe("I'm safe wording never promises that nobody else can see it (D98)", () => {
  for (const [lang, catalog] of Object.entries(CATALOGS)) {
    it(`${lang}: no "only" or "nobody" in the I'm safe sharing texts`, () => {
      const offenders = sharingKeys(catalog as Catalog)
        .filter(([, value]) => EXCLUSIVE[lang]!.test(value))
        .map(([key, value]) => `${key}: ${value}`);
      expect(offenders).toEqual([]);
    });
  }

  it("the Family page hint names the home it is shared with", () => {
    expect(en.imSafe.family.settingHint).toBe(
      "Shared with the approved members of this home. Never your location.",
    );
  });

  it("would have caught the 26.4.3 wording", () => {
    for (const old of [
      "Only approved members of this home see them. Never your location.",
      "Saved, but nobody in Bumelerze can see it yet. You can send a message instead.",
      "Family only",
    ]) {
      expect(EXCLUSIVE.en!.test(old)).toBe(true);
    }
    expect(EXCLUSIVE.ckb!.test("تەنها ئەندامە پەسەندکراوەکانی ئەم ماڵە دەیبینن.")).toBe(
      true,
    );
    expect(EXCLUSIVE.ckb!.test("تەنها خێزان")).toBe(true);
    expect(EXCLUSIVE.kmr!.test("Tenê endamên pejirandî yên vê malê wan dibînin.")).toBe(
      true,
    );
    expect(EXCLUSIVE.ar!.test("يراها فقط الأعضاء الموافق عليهم في هذا المنزل.")).toBe(
      true,
    );
  });
});
