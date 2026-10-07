import ar from "@/i18n/locales/ar.json";
import ckb from "@/i18n/locales/ckb.json";
import en from "@/i18n/locales/en.json";
import kmr from "@/i18n/locales/kmr.json";
import { improvementTips, plainTypeKey } from "../assessment";
import { IMS_TYPES, VULNERABILITY_CLASSES } from "../ims25";
import { PHOTO_SLOTS, PHOTO_SLOT_PICTOGRAM } from "../photos";
import { PICTOGRAM_XML } from "../pictograms.generated";
import { DONT_KNOW, QUESTIONS } from "../questionnaire";

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
    if (question.helperPictogram) {
      keys.push(`building.q.${question.id}.helper`);
    }
    if (question.input === "text") {
      keys.push(`building.q.${question.id}.hint`, `building.q.${question.id}.label`);
    }
  }
  for (const slot of PHOTO_SLOTS) {
    keys.push(`building.photos.slot.${slot}`);
  }
  for (const key of ["title", "hint", "caption", "captionPlaceholder"]) {
    keys.push(`building.photos.more.${key}`);
  }
  keys.push("building.photos.count", "building.photos.full", "building.photos.uploading");
  keys.push("building.flow.charCount");
  for (const key of [
    "button",
    "hint",
    "cancel",
    "permission",
    "allow",
    "failed",
    "notInvite",
    "cameraLabel",
  ]) {
    keys.push(`building.join.scan.${key}`);
  }
  keys.push("building.family.qrLabel", "building.family.share", "building.family.copy");
  for (const key of [
    "pin",
    "pinTitle",
    "pinHint",
    "pinConfirm",
    "pinCancel",
    "pinDone",
    "pinMapLabel",
  ]) {
    keys.push(`building.flow.location.${key}`);
  }
  keys.push("building.flow.review.locationPin");
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

  it("every question that offers 'I don't know' has its label in all four locales", () => {
    for (const catalog of Object.values(catalogs)) {
      for (const question of QUESTIONS) {
        if (question.options.includes(DONT_KNOW)) {
          expect(typeof lookup(catalog, `building.q.${question.id}.options.dk`)).toBe(
            "string",
          );
        }
      }
    }
  });

  it("the home type and the remarks are the two questions without 'I don't know'", () => {
    const without = QUESTIONS.filter((q) => !q.options.includes(DONT_KNOW)).map(
      (q) => q.id,
    );
    expect(without).toEqual(["use", "remarks"]);
  });

  it("no old key is left behind: the q-v1 people questions and kind labels are gone", () => {
    for (const catalog of Object.values(catalogs)) {
      expect(lookup(catalog, "building.q.peopleDay")).toBeUndefined();
      expect(lookup(catalog, "building.q.peopleNight")).toBeUndefined();
      expect(lookup(catalog, "building.flow.kind.title")).toBeUndefined();
      expect(lookup(catalog, "building.flow.kind.house")).toBeUndefined();
      expect(lookup(catalog, "building.flow.photos.front")).toBeUndefined();
    }
  });

  it("every drawing the questionnaire and the photo slots point to exists", () => {
    const names = new Set(Object.keys(PICTOGRAM_XML));
    for (const question of QUESTIONS) {
      for (const [option, name] of Object.entries(question.pictograms ?? {})) {
        expect(question.options).toContain(option);
        expect(names.has(name)).toBe(true);
      }
      if (question.helperPictogram) {
        expect(names.has(question.helperPictogram)).toBe(true);
      }
    }
    expect(Object.keys(PHOTO_SLOT_PICTOGRAM).sort()).toEqual([...PHOTO_SLOTS].sort());
    for (const name of Object.values(PHOTO_SLOT_PICTOGRAM)) {
      expect(names.has(name)).toBe(true);
    }
    expect(names.has("photo-add-more")).toBe(true);
  });

  it("the Latin-letter check flags the old shape label and lets an isolated run through", () => {
    const hasLatin = (text: string) =>
      /[A-Za-z]/.test(
        text
          .replace(/[\u2066-\u2068][^\u2069]*\u2069/g, "")
          .replace(/\{\{[^}]*\}\}/g, ""),
      );
    expect(hasLatin("L، T یان ناڕێک")).toBe(true);
    expect(hasLatin("\u2066L\u2069، \u2066T\u2069 یان ناڕێک")).toBe(false);
    expect(hasLatin("کۆدی {{code}}")).toBe(false);
  });

  it("building option text in Sorani and Arabic has no Latin letters outside a bidi isolate (N9)", () => {
    // The old "L, T or irregular" shape label put Latin letters into RTL text,
    // which the bidi algorithm then reordered. A Latin run must sit inside an
    // isolate (FSI/LRI/RLI ... PDI) to stay put.
    const ISOLATE = /[\u2066-\u2068][^\u2069]*\u2069/g;
    const PLACEHOLDER = /\{\{[^}]*\}\}/g;
    const strings = (node: unknown, out: string[] = []): string[] => {
      if (typeof node === "string") out.push(node);
      else if (typeof node === "object" && node !== null) {
        for (const value of Object.values(node)) strings(value, out);
      }
      return out;
    };
    for (const locale of ["ckb", "ar"] as const) {
      const b = catalogs[locale].building;
      const scoped = [
        ...strings(b.q),
        ...strings(b.photos),
        ...strings(b.flow.kind),
        ...strings(b.flow.photos),
      ];
      const offenders = scoped.filter((text) =>
        /[A-Za-z]/.test(text.replace(ISOLATE, "").replace(PLACEHOLDER, "")),
      );
      expect(offenders).toEqual([]);
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
