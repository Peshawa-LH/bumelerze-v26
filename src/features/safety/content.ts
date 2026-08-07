/**
 * Safety content model — spec-v1.md §4.9 (D11 "full feature"): PREPARE /
 * SURVIVE / RECOVER tri-tab, cartoon-style do/don't pairs (LastQuake
 * pattern), accessibility variants on the core Drop-Cover-Hold-On card
 * (MyShake benchmark — wheelchair / cane-or-walker / bed users).
 *
 * This file is keys-only, on purpose (PROJECT.md "no hard-coded strings,
 * ever"): every piece of copy lives in `safety.cards.*` in the four locale
 * catalogs. The functions at the bottom (`safetyCardTitleKey` etc.) are the
 * single source of truth for how a card's fields map to i18n key paths —
 * the screen, its sub-components, and the content-integrity test all derive
 * keys through these functions rather than re-deriving the string shape
 * independently, so the key convention can only drift in one place.
 *
 * This is deliberately a fully static, bundled TypeScript module (spec-v1.md
 * §4.9 "fully static content... works offline by definition") — no fetch,
 * no Supabase, no async loading state.
 */

export type SafetySectionId = "prepare" | "survive" | "recover";

/**
 * One do/don't pair (LastQuake teardown §3: "cartoon pairs, green ✓ / red ✗
 * framed"). `id` is the suffix used to build both text keys, so a pair is
 * fully described by its id alone — no separate `doKey`/`dontKey` fields to
 * keep in sync.
 */
export interface SafetyDoDontPair {
  id: string;
  /**
   * Placeholder for the future do/don't cartoon-pair illustration (the
   * `visual-asset-generator` wave that also does the felt-report tier-1
   * artwork, per D8's "redrawn for our context"). Not rendered as an image
   * this wave — it only records which pair will need one, so adding real
   * art later is a data change, not a layout change.
   */
  iconPlaceholder?: string;
}

/**
 * One accessibility variant of a card's guidance (spec-v1.md §4.9 "e.g.
 * cane/walker instructions, MyShake benchmark"). `id` is the suffix used to
 * build both the disclosure label and body text keys.
 */
export interface SafetyAccessibilityVariant {
  id: string;
}

export interface SafetyCard {
  /** Suffix under `safety.cards.<id>.*` in every locale catalog. */
  id: string;
  /** How many `body1..bodyN` paragraph keys this card has (always >= 1). */
  bodyParagraphCount: number;
  doDontPairs?: readonly SafetyDoDontPair[];
  accessibilityVariants?: readonly SafetyAccessibilityVariant[];
}

export interface SafetySection {
  id: SafetySectionId;
  cards: readonly SafetyCard[];
}

export const SAFETY_SECTION_IDS: readonly SafetySectionId[] = [
  "prepare",
  "survive",
  "recover",
];

/**
 * PREPARE / SURVIVE / RECOVER content, ~5 cards per section per the wave
 * brief. Regionally grounded per PROJECT.md + spec-v1.md §1 (Kurdish-first,
 * scientifically correct, no drama): rooftop water tanks and gas cylinders
 * (both common in Kurdish homes) get their own mentions rather than generic
 * "secure your belongings" copy, and the RECOVER section's "reliable
 * information" card phrases the trust principle neutrally instead of as
 * marketing for this app.
 */
export const SAFETY_SECTIONS: readonly SafetySection[] = [
  {
    id: "prepare",
    cards: [
      { id: "familyPlan", bodyParagraphCount: 2 },
      { id: "secureHome", bodyParagraphCount: 2 },
      { id: "emergencyKit", bodyParagraphCount: 2 },
      { id: "safeSpots", bodyParagraphCount: 2 },
      { id: "schoolWork", bodyParagraphCount: 2 },
    ],
  },
  {
    id: "survive",
    cards: [
      {
        // The core card (spec-v1.md §4.9) — Drop, Cover, and Hold On, with
        // the three accessibility variants that are the MyShake/LastQuake
        // benchmark (teardown-myshake.md §2-3, teardown-lastquake.md §3).
        id: "dropCoverHold",
        bodyParagraphCount: 2,
        doDontPairs: [{ id: "protectHeadNeckVsDoorway" }],
        accessibilityVariants: [
          { id: "wheelchair" },
          { id: "caneOrWalker" },
          { id: "bed" },
        ],
      },
      {
        id: "indoors",
        bodyParagraphCount: 1,
        doDontPairs: [{ id: "stayInVsRunOutside" }],
      },
      {
        id: "outdoors",
        bodyParagraphCount: 1,
        doDontPairs: [{ id: "openGroundVsBuildings" }],
      },
      {
        id: "vehicle",
        bodyParagraphCount: 1,
        doDontPairs: [{ id: "pullOverVsOverpass" }],
      },
      {
        // A dedicated myth-busting card for the two habits people reach for
        // out of instinct but that current guidance advises against — the
        // doorway myth and the elevator (spec-v1.md §4.9's explicit list:
        // "don't: doorway myth... don't: elevator").
        id: "commonMyths",
        bodyParagraphCount: 1,
        doDontPairs: [{ id: "headNeckVsDoorwayMyth" }, { id: "stairsVsElevator" }],
      },
    ],
  },
  {
    id: "recover",
    cards: [
      { id: "aftershocks", bodyParagraphCount: 2 },
      {
        id: "checkHazards",
        bodyParagraphCount: 1,
        doDontPairs: [{ id: "gasLeakSafety" }],
      },
      {
        id: "evacuateCarefully",
        bodyParagraphCount: 1,
        doDontPairs: [{ id: "reentryCaution" }],
      },
      {
        id: "reliableInfo",
        bodyParagraphCount: 1,
        doDontPairs: [{ id: "verifyBeforeSharing" }],
      },
      {
        id: "helpNeighbors",
        bodyParagraphCount: 1,
        doDontPairs: [{ id: "helpSafely" }],
      },
    ],
  },
];

// --- i18n key-shape helpers -------------------------------------------
// Single source of truth for the `safety.cards.*` key convention; the
// screen components and the content-integrity test both call through these
// instead of re-deriving the string shape.

export function safetySectionTabKey(sectionId: SafetySectionId): string {
  return `safety.tabs.${sectionId}`;
}

export function safetyCardTitleKey(cardId: string): string {
  return `safety.cards.${cardId}.title`;
}

export function safetyCardBodyKey(cardId: string, index: number): string {
  return `safety.cards.${cardId}.body${index}`;
}

export function safetyCardBodyKeys(card: SafetyCard): string[] {
  return Array.from({ length: card.bodyParagraphCount }, (_, i) =>
    safetyCardBodyKey(card.id, i + 1),
  );
}

export function safetyDoDontKeys(
  cardId: string,
  pairId: string,
): { doKey: string; dontKey: string } {
  return {
    doKey: `safety.cards.${cardId}.doDont.${pairId}.do`,
    dontKey: `safety.cards.${cardId}.doDont.${pairId}.dont`,
  };
}

export function safetyAccessibilityKeys(
  cardId: string,
  variantId: string,
): { labelKey: string; bodyKey: string } {
  return {
    labelKey: `safety.cards.${cardId}.accessibility.${variantId}.label`,
    bodyKey: `safety.cards.${cardId}.accessibility.${variantId}.body`,
  };
}

/** All cards across all sections, in section order — a convenience for the
 * integrity test and any future full-content search. */
export function allSafetyCards(): readonly SafetyCard[] {
  return SAFETY_SECTIONS.flatMap((section) => section.cards);
}
