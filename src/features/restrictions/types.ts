/** Account limits (migration 0054). Three levels:
 * - warning: a notice with the reason, nothing else changes
 * - restrict: cannot comment, mark helpful, report, post, follow or edit the
 *   public profile (felt reports and alerts always keep working)
 * - suspend: as restrict, plus the public profile reads "suspended" and what
 *   the person wrote is hidden from others */
export type RestrictionLevel = "warning" | "restrict" | "suspend";

/** Reasons the admin sheet offers. They are stored as these keys, so the
 * person reads them in their own language; anything else an admin types is
 * shown as written. */
export const REASON_PRESETS = [
  "rumour",
  "harassment",
  "spam",
  "impersonation",
  "explicit",
] as const;
export type ReasonPreset = (typeof REASON_PRESETS)[number];

export function isReasonPreset(reason: string): reason is ReasonPreset {
  return (REASON_PRESETS as readonly string[]).includes(reason);
}

/** Longest reason / private note the database accepts. */
export const REASON_MAX_LENGTH = 200;
export const NOTE_MAX_LENGTH = 500;

/** The limit the signed-in person is under right now (`my_restriction()`). */
export interface MyRestriction {
  id: string;
  level: RestrictionLevel;
  reason: string;
  /** UTC ms. */
  startsAt: number;
  /** UTC ms; null = until an admin lifts it. */
  endsAt: number | null;
  /** UTC ms; set once the person asked for a review. */
  appealRequestedAt: number | null;
}

/** One row of `admin_account_restrictions()`. */
export interface AdminRestriction {
  id: string;
  userId: string;
  userName: string | null;
  userUsername: string | null;
  /** An anonymous install: shown as "Guest" + the first characters of its id. */
  isGuest: boolean;
  level: RestrictionLevel;
  reason: string;
  /** The private note: admins only. */
  note: string | null;
  startsAt: number;
  endsAt: number | null;
  createdAt: number;
  createdByName: string | null;
  liftedAt: number | null;
  liftedByName: string | null;
  appealRequestedAt: number | null;
  /** In force right now, by the server's clock. */
  active: boolean;
}

export interface RestrictInput {
  userId: string;
  level: RestrictionLevel;
  reason: string;
  note: string | null;
  /** ISO timestamp; null = indefinite (suspend only). */
  endsAt: string | null;
}

export const DAY_MS = 86_400_000;

/** The ready-made durations of the admin sheet. */
export const DURATIONS = [
  { id: "h24", ms: DAY_MS },
  { id: "d7", ms: 7 * DAY_MS },
  { id: "d30", ms: 30 * DAY_MS },
] as const;
export type DurationId = (typeof DURATIONS)[number]["id"] | "custom" | "open";

/** In force at `nowMs` as far as the clock tells (the server decides in the
 * end; this only keeps an expired banner from lingering on screen). */
export function isInForce(
  restriction: { endsAt: number | null },
  nowMs: number,
): boolean {
  return restriction.endsAt === null || restriction.endsAt > nowMs;
}

/** A restrict or a suspend (not a warning) stops the person writing. */
export function limitsWriting(level: RestrictionLevel): boolean {
  return level !== "warning";
}
