import { z } from "zod";

import { CommunityError } from "@/features/community/types";
import { call } from "../transport";
import { VC_CLASSES, type AdminStats, type StatsRange } from "./types";

const n = z.coerce.number().catch(0);
const pointSchema = z.object({
  date: z.string(),
  accounts: n,
  felt: n,
  checkins: n,
  comments: n,
  waiting: n,
  devices: z
    .object({ web: n, ios: n, android: n, other: n })
    .catch({ web: 0, ios: 0, android: 0, other: 0 }),
});
const statsSchema = z.object({
  from: z.string(),
  to: z.string(),
  step: z.enum(["day", "week"]).catch("day"),
  totals: z.object({
    accounts: n,
    accounts_new: n,
    felt: n,
    checkins: n,
    waiting: n,
  }),
  series: z.array(z.unknown()).catch([]),
  buildings: z
    .object({
      homes: n,
      classes: z.record(z.string(), n).catch({}),
      areas: z.array(z.object({ area: z.string(), homes: n })).catch([]),
    })
    .catch({ homes: 0, classes: {}, areas: [] }),
});

export function parseStats(data: unknown): AdminStats {
  const parsed = statsSchema.safeParse(data);
  if (!parsed.success) {
    throw new CommunityError("unavailable", "bad stats");
  }
  const d = parsed.data;
  const series = d.series.flatMap((row) => {
    const p = pointSchema.safeParse(row);
    return p.success ? [p.data] : [];
  });
  const classes = Object.fromEntries(
    VC_CLASSES.map((vc) => [vc, d.buildings.classes[vc] ?? 0]),
  ) as AdminStats["buildings"]["classes"];
  return {
    from: d.from,
    to: d.to,
    step: d.step,
    totals: {
      accounts: d.totals.accounts,
      accountsNew: d.totals.accounts_new,
      felt: d.totals.felt,
      checkins: d.totals.checkins,
      waiting: d.totals.waiting,
    },
    series,
    buildings: { homes: d.buildings.homes, classes, areas: d.buildings.areas },
  };
}

export interface StatsTransport {
  fetchStats(range: StatsRange): Promise<AdminStats>;
}

export const SupabaseStatsTransport: StatsTransport = {
  async fetchStats(range) {
    return parseStats(
      await call("admin_stats", { p_days: range === "all" ? null : range }),
    );
  },
};
