import type { TFunction } from "i18next";

import { formatAbsoluteDual } from "@/features/events";
import type {
  BuildingDamageGrade,
  CartoonLevel,
  DamageTypology,
  QueueItem,
} from "@/features/felt";
import { placeLine } from "@/features/geo";
import { formatDeviceFingerprint } from "@/lib/device-fingerprint";
import { localizeDigits } from "@/lib/format-numbers";

type TranslateFn = TFunction;

/**
 * The contributor ID shown in Privacy & data (D26 item 7: "a friendly short
 * form of the install id"), from the device FINGERPRINT (`useContributorId`,
 * `src/lib/device-fingerprint.ts`): since the security audit (DB-03) it is
 * the first 8 hex characters of a SHA-256 of the device id, never a piece
 * of the id itself, and the same 8 characters the admin People pages show
 * for that device. Upper case, 8 characters.
 *
 * Deliberately NOT run through `localizeDigits` (the project's TypeScript
 * rule: "Kurdish digits via localizeDigits where numbers render") — it is
 * an opaque code, not a quantity, and a person reads it out to support
 * exactly as shown; locale-switching it would make the same device look
 * different per language, defeating its one job.
 */
export function formatContributorId(fingerprint: string): string {
  return formatDeviceFingerprint(fingerprint);
}

export type ContributionSyncStatus = "submitted" | "on-device";

/**
 * Collapses `QueueItemState`'s five values down to the two the My Data
 * screen shows (brief: "sync status (on-device / submitted)") — same
 * simplification `app/felt-report/done.tsx` already makes for its own
 * confirmation message ("queued"/"syncing"/"awaiting-backend"/"failed" all
 * read as "still on this device, not yet confirmed by a server" from the
 * user's point of view; only "submitted" means a server actually has it).
 */
export function resolveSyncStatus(item: QueueItem): ContributionSyncStatus {
  return item.state === "submitted" ? "submitted" : "on-device";
}

export interface ContributionDamageViewModel {
  typology: DamageTypology;
  grade: BuildingDamageGrade;
  /** Full grade description, e.g. "Hairline cracks in plaster or walls"
   * (`felt.damage.grades.<typology>.<grade>`) — same catalog window 2's own
   * damage screen reads from, so the two never drift. */
  label: string;
  typologyLabel: string;
}

export interface ContributionRowViewModel {
  reportId: string;
  /** Device-local absolute date+time the report was captured
   * (`formatAbsoluteDual(...).local`) — the local half only; the My Data
   * list has no UTC/local ambiguity to resolve for the reader the way
   * event-detail's dual display does (this is always "when I, on this
   * device, made this report"). */
  dateText: string;
  /** Place name from the event this report is attached to, when it's
   * attached to one at all (`eventRegistration` — the client-side snapshot
   * captured at submit time, see `types.ts`'s own doc). `null` for a Home
   * rapid/unassigned report (D26 §2) — the row renders a neutral
   * "not linked to a specific event" line instead in that case. */
  eventLabel: string | null;
  level: CartoonLevel;
  levelLabel: string;
  damage: ContributionDamageViewModel | null;
  syncStatus: ContributionSyncStatus;
  syncStatusText: string;
  /** True when this contribution carries a window-3 photo (2026-08-16
   * storage wave) — regardless of whether the upload to Storage has
   * completed yet (`item.photoState`); this is "did I attach one", not
   * "has it synced", matching the row's `syncStatus` field already
   * covering sync state separately. */
  hasPhoto: boolean;
  /** "Withdraw" can be offered (review note 10.1): not while a send is in
   * flight. */
  canWithdraw: boolean;
}

/**
 * Builds one My Data list row's full view model from a local queue item —
 * the ONLY data source the screen needs (brief: "from the LOCAL queue
 * store first, which already holds everything this device submitted").
 * Pure/synchronous: every field it reads already lives on the queue item,
 * no fetch of any kind.
 */
export function buildContributionRow(
  item: QueueItem,
  locale: string,
  t: TranslateFn,
): ContributionRowViewModel {
  const { local: dateText } = formatAbsoluteDual(item.tier1.createdAt, locale, t);

  const levelNumeralText = localizeDigits(String(item.tier1.cartoonLevel), locale);
  const levelName = t(`felt.tier1.levels.${item.tier1.cartoonLevel}.label`);
  const levelLabel = t("felt.numberedLabel", {
    number: levelNumeralText,
    label: levelName,
  });

  const damageTypology = item.tier2?.answers.damageTypology ?? null;
  const damageGrade = item.tier2?.answers.buildingDamageLevel ?? null;
  const damage: ContributionDamageViewModel | null =
    damageTypology !== null && damageGrade !== null
      ? {
          typology: damageTypology,
          grade: damageGrade,
          label: t(`felt.damage.grades.${damageTypology}.${damageGrade}`),
          typologyLabel: t(`felt.damage.typologies.${damageTypology}`),
        }
      : null;

  const syncStatus = resolveSyncStatus(item);

  return {
    reportId: item.tier1.reportId,
    dateText,
    // Our own place line from the registered epicentre, never the provider
    // sentence snapshotted at registration time (D28): the same event reads
    // the same here as in the feed and on the event detail.
    eventLabel: item.tier1.eventRegistration
      ? placeLine(item.tier1.eventRegistration, locale, t)
      : null,
    level: item.tier1.cartoonLevel,
    levelLabel,
    damage,
    syncStatus,
    syncStatusText: t(`myData.syncStatus.${syncStatus}`),
    hasPhoto: item.tier2?.photoUri != null,
    canWithdraw: item.state !== "syncing",
  };
}

/**
 * "Oct 2026": month name from the app's own `months.short.<n>` table (never
 * ICU, which has no Sorani/Kurmanji month names) plus the localized year.
 * Used for "Member since". The reader's own time zone decides the month.
 */
export function formatMonthYear(timeMs: number, locale: string, t: TranslateFn): string {
  const date = new Date(timeMs);
  const month = t(`months.short.${date.getMonth() + 1}`);
  return `${month} ${localizeDigits(String(date.getFullYear()), locale)}`;
}
