import ar from "@/i18n/locales/ar.json";
import ckb from "@/i18n/locales/ckb.json";
import en from "@/i18n/locales/en.json";
import kmr from "@/i18n/locales/kmr.json";
import { flattenKeys } from "@/i18n/locale-keys";

import {
  SAFETY_SECTIONS,
  allSafetyCards,
  safetyAccessibilityKeys,
  safetyCardBodyKeys,
  safetyCardTitleKey,
  safetyDoDontKeys,
  safetySectionTabKey,
} from "../content";

/**
 * Content-model integrity (wave brief point 5): every key the content
 * registry can produce must exist in all four locale catalogs. This is
 * `locales.test.ts`'s "every locale ships the same keys as English" check
 * turned around — it proves the *registry* and the *catalogs* agree with
 * each other, not just that the four catalogs agree with each other.
 * A card added to `content.ts` without matching catalog entries would pass
 * `locales.test.ts` (all four catalogs would still be missing the same
 * keys) but fail here.
 */
describe("safety content-model integrity", () => {
  const catalogs = { en, ckb, kmr, ar } as const;

  function flatSets() {
    return Object.fromEntries(
      Object.entries(catalogs).map(([locale, catalog]) => [
        locale,
        new Set(flattenKeys(catalog)),
      ]),
    );
  }

  it("has a matching catalog entry, in all four locales, for every key the content registry can produce", () => {
    const sets = flatSets();
    const requiredKeys = new Set<string>([
      "safety.title",
      "safety.doLabel",
      "safety.dontLabel",
      "safety.accessibilityToggleLabel",
    ]);

    for (const section of SAFETY_SECTIONS) {
      requiredKeys.add(safetySectionTabKey(section.id));

      for (const card of section.cards) {
        requiredKeys.add(safetyCardTitleKey(card.id));
        for (const bodyKey of safetyCardBodyKeys(card)) {
          requiredKeys.add(bodyKey);
        }
        for (const pair of card.doDontPairs ?? []) {
          const { doKey, dontKey } = safetyDoDontKeys(card.id, pair.id);
          requiredKeys.add(doKey);
          requiredKeys.add(dontKey);
        }
        for (const variant of card.accessibilityVariants ?? []) {
          const { labelKey, bodyKey } = safetyAccessibilityKeys(card.id, variant.id);
          requiredKeys.add(labelKey);
          requiredKeys.add(bodyKey);
        }
      }
    }

    expect(requiredKeys.size).toBeGreaterThan(0);

    for (const [locale, keySet] of Object.entries(sets)) {
      const missing = [...requiredKeys].filter((key) => !keySet.has(key));
      expect({ locale, missing }).toEqual({ locale, missing: [] });
    }
  });

  it("has no card id collisions across sections (card ids double as i18n key segments)", () => {
    const ids = allSafetyCards().map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/**
 * Section-completeness (wave brief point 5): the tri-tab structure and the
 * SURVIVE accessibility-variant benchmark (MyShake/LastQuake, teardown-
 * myshake.md §2-3) are hard requirements from spec-v1.md §4.9 — assert them
 * directly against the data, not just indirectly through a screen render.
 */
describe("safety content — section completeness", () => {
  it("has exactly the PREPARE / SURVIVE / RECOVER sections, each with at least 4 cards", () => {
    expect(SAFETY_SECTIONS.map((section) => section.id)).toEqual([
      "prepare",
      "survive",
      "recover",
    ]);
    for (const section of SAFETY_SECTIONS) {
      expect(section.cards.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("gives the SURVIVE section a Drop-Cover-Hold-On card with the wheelchair / cane-or-walker / bed accessibility variants", () => {
    const survive = SAFETY_SECTIONS.find((section) => section.id === "survive");
    expect(survive).toBeTruthy();

    const dropCoverHold = survive?.cards.find((card) => card.id === "dropCoverHold");
    expect(dropCoverHold).toBeTruthy();

    const variantIds = (dropCoverHold?.accessibilityVariants ?? []).map(
      (variant) => variant.id,
    );
    expect(variantIds).toEqual(
      expect.arrayContaining(["wheelchair", "caneOrWalker", "bed"]),
    );
  });

  it("gives every card at least one body paragraph", () => {
    for (const card of allSafetyCards()) {
      expect(card.bodyParagraphCount).toBeGreaterThanOrEqual(1);
    }
  });
});
