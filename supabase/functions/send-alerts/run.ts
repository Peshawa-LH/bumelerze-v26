// Pure orchestration of one send-alerts call: plan and claim a batch in the
// database, send it, record what the push services said, repeat while there
// is more and time is left. The database does all the deciding (who, what,
// whether at all: migration 0062); this only delivers.

import { parsePlan } from "./plan.ts";
import {
  parseDueReceipts,
  summarizeReceipts,
  type DueReceipt,
  type ReceiptResult,
  type ReceiptSummary,
} from "./receipts.ts";
import { deliverBatch, type DeliveryResult, type Senders } from "./senders.ts";

export interface RunPorts {
  /** public.alert_plan_run(p_limit) */
  plan(limit: number): Promise<unknown>;
  /** public.alert_record_results(p_run_id, p_results) */
  record(runId: string, results: DeliveryResult[]): Promise<void>;
  /** public.alert_receipts_due(p_limit), migration 0068. */
  receiptsDue?(limit: number): Promise<unknown>;
  /** public.alert_record_receipts(p_results), migration 0068. */
  recordReceipts?(results: ReceiptResult[]): Promise<void>;
}

/** Asks Expo for the receipts of earlier sends (receipts.ts). */
export type ReceiptChecker = (due: readonly DueReceipt[]) => Promise<ReceiptResult[]>;

export interface RunSummary {
  rounds: number;
  mode: string;
  claimed: number;
  sent: number;
  gone: number;
  retry: number;
  failed: number;
  /** Expo receipts checked in this call; "unavailable" when they could not
   * be read or stored (migration 0068 not applied yet): the sending above
   * is not affected. Absent when there is no checker. */
  receipts?: ReceiptSummary | "unavailable";
}

export async function runSendAlerts(
  ports: RunPorts,
  senders: Senders,
  options: {
    limit?: number;
    maxRounds?: number;
    budgetMs?: number;
    now?: () => number;
    checkReceipts?: ReceiptChecker;
    receiptLimit?: number;
  } = {},
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
  if (options.checkReceipts && ports.receiptsDue && ports.recordReceipts && now() < deadline) {
    // After the sending, never instead of it: a failure here is reported
    // and the alerts above stand.
    try {
      const due = parseDueReceipts(await ports.receiptsDue(options.receiptLimit ?? 300));
      if (due.length > 0) {
        const results = await options.checkReceipts(due);
        await ports.recordReceipts(results);
        summary.receipts = summarizeReceipts(results);
      } else {
        summary.receipts = summarizeReceipts([]);
      }
    } catch {
      summary.receipts = "unavailable";
    }
  }
  return summary;
}
