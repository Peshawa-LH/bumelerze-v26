import type { TFunction } from "i18next";

import { formatAbsoluteDual } from "@/features/events";
import type { BuildingDamageGrade, CartoonLevel, DamageTypology, QueueItem } from "@/features/felt";
import { localizeDigits } from "@/lib/format-numbers";

type TranslateFn = TFunction;

/** How many leading device-id characters the header shows (D26 item 7: "a
 * friendly short form of the install id"). The full uuid is 36 characters
 * including hyphens; 8 hex characters is enough to be visually distinct
 * between installs without printing something as unwieldy as a full uuid on
 * a panic-time-readable screen. Uppercased purely for the monospace-badge
 * look MyShake's own reference screenshot uses for its similarly short ids
 * — carries no meaning of its own (the underlying `deviceId` stays
 * lowercase everywhere else, e.g. `felt_reports.device_id`). */
const CONTRIBUTOR_ID_VISIBLE_CHARS = 8;

/**
 * Deliberately NOT run through `localizeDigits` (typescript-react-native
 * rule: "Kurdish digits via localizeDigits where numbers render") — a
 * device id is an opaque identifier/code, not a quantity being read aloud
 * or compared numerically (unlike magnitude, distance, or a report count),
 * the same reasoning `device_id`/`report_id` already stay Latin everywhere
 * else in the app (`felt/device-id.ts`, every Supabase column). Locale-
 * switching this string would also make it a DIFFERENT-looking id per
 * language for the exact same install, defeating its one job (a stable,
 * shareable-if-needed identifier).
 */
export function formatContributorId(deviceId: string): string {
  return deviceId.slice(0, CONTRIBUTOR_ID_VISIBLE_CHARS).toUpperCase();
}

export type ContributionSyncStatus = "submitted" | "on-device";

/**
 * Collapses `QueueItemState`'s five values down to the two the My Data
 * screen shows (wave brief: "sync status (on-device / submitted)") — same
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
}

/**
 * Builds one My Data list row's full view model from a local queue item —
 * the ONLY data source the screen needs (wave brief: "from the LOCAL queue
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
  const levelLabel = t("felt.numberedLabel", { number: levelNumeralText, label: levelName });

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
    eventLabel: item.tier1.eventRegistration?.placeName ?? null,
    level: item.tier1.cartoonLevel,
    levelLabel,
    damage,
    syncStatus,
    syncStatusText: t(`myData.syncStatus.${syncStatus}`),
  };
}
