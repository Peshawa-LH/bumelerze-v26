// Pure orchestration of one send-alerts call: plan and claim a batch in the
// database, send it, record what the push services said, repeat while there
// is more and time is left. The database does all the deciding (who, what,
// whether at all: migration 0062); this only delivers.

import { parsePlan } from "./plan.ts";
import { deliverBatch, type DeliveryResult, type Senders } from "./senders.ts";

export interface RunPorts {
  /** public.alert_plan_run(p_limit) */
  plan(limit: number): Promise<unknown>;
  /** public.alert_record_results(p_run_id, p_results) */
  record(runId: string, results: DeliveryResult[]): Promise<void>;
}

export interface RunSummary {
  rounds: number;
  mode: string;
  claimed: number;
  sent: number;
  gone: number;
  retry: number;
  failed: number;
}

export async function runSendAlerts(
  ports: RunPorts,
  senders: Senders,
  options: { limit?: number; maxRounds?: number; budgetMs?: number; now?: () => number } = {},
): Promise<RunSummary> {
  const limit = options.limit ?? 200;
  const maxRounds = options.maxRounds ?? 5;
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? 40_000);
  const summary: RunSummary = { rounds: 0, mode: "unknown", claimed: 0, sent: 0, gone: 0, retry: 0, failed: 0 };

  while (summary.rounds < maxRounds && now() < deadline) {
    const plan = parsePlan(await ports.plan(limit));
    summary.rounds += 1;
    summary.mode = plan.mode;
    if (!plan.runId) {
      break;
    }
    const claimed = plan.items.length + plan.invalid.length;
    summary.claimed += claimed;
    const results = await deliverBatch(plan.items, senders);
    for (const id of plan.invalid) {
      results.push({ delivery_id: id, outcome: "failed", error: "malformed delivery" });
    }
    await ports.record(plan.runId, results);
    for (const result of results) {
      summary[result.outcome] += 1;
    }
    if (claimed < limit) {
      break;
    }
  }
  return summary;
}
