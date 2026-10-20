// Pure: Expo push receipts (migration 0068). A ticket of "ok" only says
// Expo took the message; whether Apple or Google delivered it comes later,
// as a receipt. That is where a phone that no longer exists shows up
// (DeviceNotRegistered), so the device is switched off like a web push
// 404/410. The network is handed in, so Jest drives this with a fake fetch.
//
// Outcomes (what alert_record_receipts() stores):
//   ok       delivered to Apple or Google
//   gone     DeviceNotRegistered: the phone is switched off
//   failed   any other receipt error (MessageTooBig, InvalidCredentials,
//            MismatchSenderId, MessageRateExceeded): the delivery failed,
//            the phone is not blamed
//   pending  no receipt yet, or Expo could not be asked: asked again later

import type { FetchLike } from "./senders.ts";

export const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
/** Expo answers at most 1000 receipt ids per request. */
const RECEIPT_BATCH = 1000;

export type ReceiptOutcome = "ok" | "gone" | "failed" | "pending";

export interface DueReceipt {
  delivery_id: string;
  ticket: string;
}

export interface ReceiptResult {
  delivery_id: string;
  outcome: ReceiptOutcome;
  error?: string;
}

export interface ReceiptSummary {
  checked: number;
  ok: number;
  gone: number;
  failed: number;
  pending: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKET = /^[A-Za-z0-9_-]{1,100}$/;

/** What alert_receipts_due() handed back; anything malformed is dropped. */
export function parseDueReceipts(raw: unknown): DueReceipt[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: DueReceipt[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.delivery_id === "string" && UUID.test(row.delivery_id) && typeof row.ticket === "string" && TICKET.test(row.ticket)) {
      out.push({ delivery_id: row.delivery_id, ticket: row.ticket });
    }
  }
  return out;
}

function short(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 200);
}

export function createReceiptChecker(deps: { fetch: FetchLike; accessToken?: string | null; timeoutMs?: number }) {
  const timeoutMs = deps.timeoutMs ?? 15_000;
  return async function checkReceipts(due: readonly DueReceipt[]): Promise<ReceiptResult[]> {
    const results: ReceiptResult[] = [];
    for (let start = 0; start < due.length; start += RECEIPT_BATCH) {
      const chunk = due.slice(start, start + RECEIPT_BATCH);
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
      };
      if (deps.accessToken) {
        headers.Authorization = `Bearer ${deps.accessToken}`;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let receipts: Record<string, unknown> = {};
      try {
        const response = await deps.fetch(EXPO_RECEIPTS_URL, {
          method: "POST",
          headers,
          body: JSON.stringify({ ids: chunk.map((d) => d.ticket) }),
          signal: controller.signal,
        });
        if (response.status < 200 || response.status >= 300) {
          // Expo could not answer now: every receipt waits for the next try.
          for (const d of chunk) results.push({ delivery_id: d.delivery_id, outcome: "pending" });
          continue;
        }
        const body = (await response.json()) as { data?: unknown };
        if (typeof body?.data === "object" && body.data !== null && !Array.isArray(body.data)) {
          receipts = body.data as Record<string, unknown>;
        }
      } catch {
        for (const d of chunk) results.push({ delivery_id: d.delivery_id, outcome: "pending" });
        continue;
      } finally {
        clearTimeout(timer);
      }
      for (const d of chunk) {
        const receipt = receipts[d.ticket] as
          | { status?: string; message?: string; details?: { error?: string } }
          | undefined;
        if (!receipt || typeof receipt !== "object") {
          results.push({ delivery_id: d.delivery_id, outcome: "pending" });
        } else if (receipt.status === "ok") {
          results.push({ delivery_id: d.delivery_id, outcome: "ok" });
        } else {
          const code = receipt.details?.error ?? "";
          const error = short(`expo receipt ${code || "error"} ${receipt.message ?? ""}`);
          results.push({ delivery_id: d.delivery_id, outcome: code === "DeviceNotRegistered" ? "gone" : "failed", error });
        }
      }
    }
    return results;
  };
}

export function summarizeReceipts(results: readonly ReceiptResult[]): ReceiptSummary {
  const summary: ReceiptSummary = { checked: results.length, ok: 0, gone: 0, failed: 0, pending: 0 };
  for (const result of results) {
    summary[result.outcome] += 1;
  }
  return summary;
}
