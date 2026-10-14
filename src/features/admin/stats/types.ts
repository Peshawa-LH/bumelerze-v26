import type { VulnerabilityClass } from "@/features/building/ims25";

/** The range chips of Admin > Statistics. "all" = all time (the server goes
 * back at most two years and switches to one point per week past 120 days). */
export const STATS_RANGES = [7, 30, 90, "all"] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

export const VC_CLASSES: readonly VulnerabilityClass[] = ["A", "B", "C", "D", "E", "F"];

export interface DevicesPoint {
  web: number;
  ios: number;
  android: number;
  other: number;
}

export interface StatsPoint {
  /** The day (or the first day of the week), "YYYY-MM-DD", Kurdistan time. */
  date: string;
  accounts: number;
  felt: number;
  checkins: number;
  comments: number;
  /** Comments from that day still waiting for review today. */
  waiting: number;
  devices: DevicesPoint;
}

/** `admin_stats()` (migration 0066): counts only, never a name, a place
 * finer than a town, or a device id. */
export interface AdminStats {
  from: string;
  to: string;
  step: "day" | "week";
  totals: {
    accounts: number;
    accountsNew: number;
    felt: number;
    checkins: number;
    waiting: number;
  };
  series: StatsPoint[];
  buildings: {
    homes: number;
    classes: Record<VulnerabilityClass, number>;
    /** Active tagged homes per gazetteer town ("other" = none within 100 km). */
    areas: { area: string; homes: number }[];
  };
}
