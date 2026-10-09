/** What a filter term is about (`content_filter_terms.kind`, migration 0059).
 * "prediction" covers prediction claims and panic rumours. */
export type FilterKind = "prediction" | "abuse" | "spam" | "other";
export const FILTER_KINDS: readonly FilterKind[] = [
  "prediction",
  "abuse",
  "spam",
  "other",
];

/** The language a term is listed under. Every active term is checked on every
 * text whatever its language; this only groups the list. */
export type FilterLang = "en" | "ckb" | "kmr" | "ar" | "any";
export const FILTER_LANGS: readonly FilterLang[] = ["ckb", "kmr", "ar", "en", "any"];

/** One row of `admin_filter_terms()`. */
export interface FilterTerm {
  id: string;
  term: string;
  lang: FilterLang;
  kind: FilterKind;
  /** A regular expression added by migration or in the SQL editor; the app
   * can switch it off but not write one. */
  isPattern: boolean;
  active: boolean;
  /** A starter term the official has not reviewed yet. */
  draft: boolean;
  /** How many comments or posts it held in the last 30 days. */
  holds30d: number;
}

/** `admin_test_filter()`: would this text be held. */
export interface FilterTestResult {
  held: boolean;
  matches: { term: string; kind: FilterKind; lang: FilterLang; isPattern: boolean }[];
  /** Busy-time review is on right now (new accounts are held anyway). */
  surge: boolean;
}

export type SurgeMode = "auto" | "on" | "off";

/** `admin_surge_status()`: busy-time review ("surge mode") and why. */
export interface SurgeStatus {
  active: boolean;
  mode: SurgeMode;
  /** When a forced mode ends, or when the automatic trigger runs out (UTC
   * ms); null when nothing is running. */
  until: number | null;
  /** Why it is on: a big regional earthquake, many felt reports, or the
   * official's switch. */
  reason: "magnitude" | "felt" | "manual" | null;
  eventRef: string | null;
  magnitude: number | null;
  place: string | null;
  reports: number | null;
  /** The thresholds the server applies (shown in the explanation). */
  minMagnitude: number;
  feltReports: number;
  accountDays: number;
}

/** Why a comment or post waits for review (`content_holds_for()`). Private to
 * moderators. */
export interface ContentHold {
  targetId: string;
  reason: "filter" | "surge";
  term: string | null;
  kind: FilterKind | null;
}
