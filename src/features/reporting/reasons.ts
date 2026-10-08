import type { TFunction } from "i18next";

/**
 * The one list of reasons for reporting a comment, a post or a profile
 * (migration 0056). Impersonation is for profiles only. The server stores
 * exactly these words; the earlier ones (abuse, false, private) are renamed
 * by it, so `normalizeReason` also reads rows an older app wrote.
 */
export const REPORT_REASONS = [
  "spam",
  "abuse_harassment",
  "rumour_prediction",
  "private_info",
  "sexual_violent",
  "impersonation",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type ReportKind = "comment" | "post" | "profile";

/** `note` column limit on comment_flags, post_reports and profile_reports. */
export const REPORT_NOTE_MAX = 200;

/** The reasons offered for one kind of report, in display order. */
export function reasonsFor(kind: ReportKind): readonly ReportReason[] {
  return kind === "profile"
    ? REPORT_REASONS
    : REPORT_REASONS.filter((reason) => reason !== "impersonation");
}

const LEGACY: Record<string, ReportReason> = {
  abuse: "abuse_harassment",
  false: "rumour_prediction",
  private: "private_info",
};

/** A reason from the server or an older app -> one of the current words, or
 * null when it is not a reason at all. */
export function normalizeReason(value: string | null | undefined): ReportReason | null {
  if (!value) {
    return null;
  }
  if ((REPORT_REASONS as readonly string[]).includes(value)) {
    return value as ReportReason;
  }
  return LEGACY[value] ?? null;
}

/** The localized words for a reason; an unknown code is shown as it is. */
export function reasonLabel(t: TFunction, value: string | null | undefined): string {
  const reason = normalizeReason(value);
  return reason ? t(`report.reasons.${reason}`) : (value ?? "");
}

/** The reason and note a reporter chose. */
export interface ReportInput {
  reason: ReportReason;
  /** Trimmed; null when left empty. */
  note: string | null;
}

/** Trims the note and drops it when empty or too long for the column. */
export function cleanNote(note: string | null | undefined): string | null {
  const trimmed = (note ?? "").trim().slice(0, REPORT_NOTE_MAX);
  return trimmed.length > 0 ? trimmed : null;
}
