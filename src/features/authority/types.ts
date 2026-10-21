import type { VulnerabilityClass } from "@/features/building/ims25";

/** Officials see a cell only when 5 or more homes or people stand behind it;
 * the server sends `null` for anything smaller (migration 0066). */
export const AUTHORITY_MIN_COUNT = 5;

/** People per look at the list of account holders (the server allows up to
 * 500, migration 0069); the page says when the list stops there. */
export const PEOPLE_LIMIT = 200;

/** A count the server may hide: null = "fewer than 5". */
export type Protected = number | null;

/** A gazetteer town id, or "other" (pooled small areas and places farther
 * than 100 km from any town). */
export type AreaId = string;

export interface AreaClasses {
  area: AreaId;
  classes: Record<VulnerabilityClass, Protected>;
}

export interface CheckinEvent {
  eventId: string;
  bumelerzeId: string | null;
  magnitude: number | null;
  place: string | null;
  /** UTC ms. */
  originTime: number;
  checkins: number;
}

export interface AuthorityOverview {
  areas: AreaClasses[];
  /** Sums of the shown cells only (hidden cells are never added in). */
  classes: Record<VulnerabilityClass, number>;
  events: CheckinEvent[];
}

export interface AreaSafety {
  area: AreaId;
  /** Approved members of active tagged homes in the area (always 5+). */
  people: number;
  safe: Protected;
}

export interface EventSafety {
  event: Omit<CheckinEvent, "checkins">;
  checkins: Protected;
  areas: AreaSafety[];
}

export interface SharedHome {
  area: AreaId | null;
  kind: "house" | "apartment" | null;
  vc: VulnerabilityClass | null;
  vcRange: string | null;
}

export interface SharedPerson {
  userId: string;
  username: string | null;
  displayName: string | null;
  homes: SharedHome[];
  safe: {
    /** UTC ms. */
    checkedInAt: number;
    bumelerzeId: string | null;
    magnitude: number | null;
    place: string | null;
    /** UTC ms of the earthquake, or null. */
    originTime: number | null;
  } | null;
}
