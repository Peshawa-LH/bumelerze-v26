import { readFileSync } from "fs";
import { join } from "path";

import { Ionicons } from "@expo/vector-icons";

import ar from "@/i18n/locales/ar.json";
import ckb from "@/i18n/locales/ckb.json";
import en from "@/i18n/locales/en.json";
import kmr from "@/i18n/locales/kmr.json";

import { MILESTONE_BADGES, ROLE_BADGES, ROLE_PRIORITY } from "../catalog";

const LOCALES = { en, ckb, kmr, ar } as const;

function lookup(catalog: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      catalog,
    );
}

describe("badge catalogue", () => {
  it("has unique ids and a fixed order of nine milestones", () => {
    const ids = MILESTONE_BADGES.map((badge) => badge.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "first_report",
      "reports_10",
      "detailed",
      "photo",
      "home_tagged",
      "family_linked",
      "first_comment",
      "helpful_5",
      "helpful_25",
    ]);
  });

  it("gives every milestone a name and a rule in all four locales", () => {
    for (const [locale, catalog] of Object.entries(LOCALES)) {
      for (const badge of MILESTONE_BADGES) {
        expect({
          locale,
          key: badge.nameKey,
          v: typeof lookup(catalog, badge.nameKey),
        }).toEqual({
          locale,
          key: badge.nameKey,
          v: "string",
        });
        expect({
          locale,
          key: badge.ruleKey,
          v: typeof lookup(catalog, badge.ruleKey),
        }).toEqual({
          locale,
          key: badge.ruleKey,
          v: "string",
        });
      }
    }
  });

  it("gives every role a localized name", () => {
    for (const catalog of Object.values(LOCALES)) {
      for (const role of ROLE_PRIORITY) {
        expect(typeof lookup(catalog, `eventHub.roles.${role}`)).toBe("string");
      }
    }
  });

  it("uses only icons that exist in Ionicons (solid and outline)", () => {
    const glyphs = Ionicons.glyphMap as Record<string, number>;
    for (const badge of MILESTONE_BADGES) {
      expect(glyphs[badge.icon]).toBeDefined();
      expect(glyphs[badge.iconOutline]).toBeDefined();
    }
    for (const role of Object.values(ROLE_BADGES)) {
      expect(glyphs[role.icon]).toBeDefined();
    }
  });

  it("keeps the role priority official > moderator > engineer > partner", () => {
    expect(ROLE_PRIORITY).toEqual(["official", "moderator", "engineer", "partner"]);
  });

  it("draws the official account with the round app icon, the others with a glyph", () => {
    expect(ROLE_BADGES.official.image).not.toBeNull();
    expect(ROLE_BADGES.moderator.image).toBeNull();
    expect(ROLE_BADGES.engineer.image).toBeNull();
    expect(ROLE_BADGES.partner.image).toBeNull();
  });

  it("never uses the reserved felt-action or intensity colours (tones are token names)", () => {
    const allowed = ["info", "success", "brand", "link", "warning"];
    for (const badge of MILESTONE_BADGES) {
      expect(allowed).toContain(badge.tone);
    }
    for (const role of Object.values(ROLE_BADGES)) {
      expect(allowed).toContain(role.tone);
    }
  });

  it("contains no hex colour literals", () => {
    for (const file of ["catalog.ts", "evaluate.ts", "labels.ts", "visual.ts"]) {
      const source = readFileSync(join(__dirname, "..", file), "utf8");
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
