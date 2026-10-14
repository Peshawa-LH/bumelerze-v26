import { z } from "zod";

import { call } from "../transport";

/** The status line of each launcher tile (`admin_tool_counts()`, migration
 * 0066). A field is null when the caller may not open that tool, or when the
 * server predates 0066. */
export interface ToolCounts {
  accounts: number | null;
  waiting: number | null;
  busy: boolean | null;
  alertsMode: string | null;
  alertDevices: number | null;
  hubsOpen: number | null;
  feedbackNew: number | null;
}

export const EMPTY_TOOL_COUNTS: ToolCounts = {
  accounts: null,
  waiting: null,
  busy: null,
  alertsMode: null,
  alertDevices: null,
  hubsOpen: null,
  feedbackNew: null,
};

const count = z.coerce.number().int().nonnegative().nullable().optional().catch(null);
const schema = z.object({
  accounts: count,
  waiting: count,
  busy: z.boolean().nullable().optional().catch(null),
  alerts_mode: z.string().nullable().optional().catch(null),
  alert_devices: count,
  hubs_open: count,
  feedback_new: count,
});

export function parseToolCounts(data: unknown): ToolCounts {
  const parsed = schema.safeParse(data ?? {});
  if (!parsed.success) {
    return EMPTY_TOOL_COUNTS;
  }
  const d = parsed.data;
  return {
    accounts: d.accounts ?? null,
    waiting: d.waiting ?? null,
    busy: d.busy ?? null,
    alertsMode: d.alerts_mode ?? null,
    alertDevices: d.alert_devices ?? null,
    hubsOpen: d.hubs_open ?? null,
    feedbackNew: d.feedback_new ?? null,
  };
}

export interface ToolCountsTransport {
  fetchToolCounts(): Promise<ToolCounts>;
}

export const SupabaseToolCountsTransport: ToolCountsTransport = {
  async fetchToolCounts() {
    return parseToolCounts(await call("admin_tool_counts"));
  },
};
