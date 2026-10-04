import ar from "@/i18n/locales/ar.json";
import ckb from "@/i18n/locales/ckb.json";
import en from "@/i18n/locales/en.json";
import kmr from "@/i18n/locales/kmr.json";
import { improvementTips, plainTypeKey } from "../assessment";
import { IMS_TYPES, VULNERABILITY_CLASSES } from "../ims25";
import { QUESTIONS } from "../questionnaire";

const catalogs = { en, ckb, kmr, ar } as const;

function lookup(catalog: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => {
    return typeof node === "object" && node !== null
      ? (node as Record<string, unknown>)[key]
      : undefined;
  }, catalog);
}

/** Every locale key the questionnaire, the assessment and the report can ask for. */
function requiredKeys(): string[] {
  const keys: string[] = ["building.title", "building.report.title"];
  for (const question of QUESTIONS) {
    keys.push(`building.q.${question.id}.title`);
    for (const option of question.options) {
      keys.push(`building.q.${question.id}.options.${option}`);
    }
  }
  for (const vc of VULNERABILITY_CLASSES) {
    keys.push(
      `building.vc.name.${vc}`,
      `building.vc.meaning.${vc}`,
      `building.report.vcLabel`,
    );
  }
  for (const type of IMS_TYPES) {
    keys.push(`building.types.${plainTypeKey(type.type)}`);
  }
  for (const grade of [1, 2, 3, 4, 5]) {
    keys.push(`building.damage.grade.${grade}`);
  }
  for (const quantity of ["few", "many", "most"]) {
    keys.push(`building.damage.${quantity}`);
  }
  for (const intensity of ["VI", "VII", "VIII"]) {
    keys.push(`building.damage.intensity.${intensity}`);
  }
  for (const family of ["masonry", "rc", "other"]) {
    const probs =
      family === "masonry" ? { M6: 1 } : family === "rc" ? { "RC1-L": 1 } : { T1: 1 };
    keys.push(...improvementTips(probs));
  }
  for (const code of [
    "unconfigured",
    "need_account",
    "homes_limit",
    "join_limit",
    "wrong_code",
    "network",
    "photo_too_large",
    "unknown",
  ]) {
    keys.push(`building.errors.${code}`);
  }
  return keys;
}

describe("Tag my building strings", () => {
  it.each(Object.keys(catalogs))(
    "%s has every string the feature can ask for",
    (locale) => {
      const catalog = catalogs[locale as keyof typeof catalogs];
      const missing = requiredKeys().filter((key) => {
        const value = lookup(catalog, key);
        return typeof value !== "string" || value.trim() === "";
      });
      expect(missing).toEqual([]);
    },
  );

  it("every question has an 'I don't know' label in all four locales", () => {
    for (const catalog of Object.values(catalogs)) {
      for (const question of QUESTIONS) {
        expect(typeof lookup(catalog, `building.q.${question.id}.options.dk`)).toBe(
          "string",
        );
      }
    }
  });

  it("the Kurdish and Arabic text is not the English text", () => {
    for (const locale of ["ckb", "kmr", "ar"] as const) {
      expect(catalogs[locale].building.title).not.toBe(en.building.title);
      expect(catalogs[locale].building.report.title).not.toBe(en.building.report.title);
    }
  });

  it("never writes the camel-case product name", () => {
    expect(JSON.stringify(en.building)).not.toMatch(new RegExp("Shake" + "Map"));
  });

  it("keeps placeholders the same in every locale", () => {
    const placeholders = (text: string) =>
      (text.match(/\{\{\w+\}\}/g) ?? []).sort().join(",");
    const walk = (node: unknown, path: string, out: Record<string, string>) => {
      if (typeof node === "string") {
        out[path] = placeholders(node);
      } else if (typeof node === "object" && node !== null) {
        for (const [key, value] of Object.entries(node)) {
          walk(value, path ? `${path}.${key}` : key, out);
        }
      }
    };
    const reference: Record<string, string> = {};
    walk(en.building, "", reference);
    for (const locale of ["ckb", "kmr", "ar"] as const) {
      const found: Record<string, string> = {};
      walk(catalogs[locale].building, "", found);
      expect(found).toEqual(reference);
    }
  });
});
