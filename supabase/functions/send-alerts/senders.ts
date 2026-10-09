// Pure adapters for the two push services. The network (fetch) and the web
// push encryption (web-push's generateRequestDetails) are handed in, so Jest
// tests them with fakes and index.ts wires the real ones.
//
// Outcomes (what alert_record_results() of migration 0062 stores):
//   sent    the push service accepted it
//   gone    the subscription no longer exists (404/410, Expo DeviceNotRegistered):
//           the device is disabled and never tried again
//   retry   worth another try later (429, 5xx, timeout, network)
//   failed  will not work as it is (400/401/403/413, bad endpoint)

import { buildMessage, webPayload, type AlertItem, type PushMessage } from "./message.ts";

export type Outcome = "sent" | "gone" | "retry" | "failed";

export interface DeliveryResult {
  delivery_id: string;
  outcome: Outcome;
  error?: string;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: unknown; signal?: AbortSignal },
) => Promise<{ status: number; text(): Promise<string>; json(): Promise<unknown> }>;

/** Same push services migration 0062 accepts; checked again before any request. */
const PUSH_HOST =
  /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com)\//;

export function isAllowedEndpoint(endpoint: string): boolean {
  return PUSH_HOST.test(endpoint) && endpoint.length <= 1024;
}

export function classifyStatus(status: number): Outcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "gone";
  if (status === 408 || status === 429 || status >= 500) return "retry";
  return "failed";
}

function short(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 200);
}

// ---------------------------------------------------------------- web push
export interface VapidKeys {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/** web-push's generateRequestDetails(subscription, payload, options). */
export type GenerateRequestDetails = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: {
    vapidDetails: VapidKeys;
    TTL: number;
    urgency: "very-low" | "low" | "normal" | "high";
    topic: string;
    contentEncoding: "aes128gcm";
  },
) => { method: string; headers: Record<string, string | number>; body: unknown; endpoint: string };

export function createWebSender(deps: {
  generate: GenerateRequestDetails;
  fetch: FetchLike;
  vapid: VapidKeys;
  timeoutMs?: number;
  now?: () => number;
}) {
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const now = deps.now ?? Date.now;
  return async function sendWeb(item: AlertItem, message: PushMessage): Promise<DeliveryResult> {
    if (item.target.kind !== "web") {
      return { delivery_id: item.id, outcome: "failed", error: "not a web target" };
    }
    if (!isAllowedEndpoint(item.target.endpoint)) {
      return { delivery_id: item.id, outcome: "failed", error: "endpoint not allowed" };
    }
    let details;
    try {
      details = deps.generate(
        { endpoint: item.target.endpoint, keys: { p256dh: item.target.p256dh, auth: item.target.auth } },
        webPayload(message, now()),
        {
          vapidDetails: deps.vapid,
          TTL: message.ttlSeconds,
          urgency: message.urgency,
          topic: message.topic,
          contentEncoding: "aes128gcm",
        },
      );
    } catch (error) {
      // Bad keys on the subscription: encrypting will never work.
      return { delivery_id: item.id, outcome: "failed", error: short(`encrypt: ${String(error)}`) };
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(details.headers)) {
      // fetch computes the length of the body itself.
      if (key.toLowerCase() !== "content-length") {
        headers[key] = String(value);
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await deps.fetch(details.endpoint, {
        method: details.method,
        headers,
        body: details.body,
        signal: controller.signal,
      });
      const outcome = classifyStatus(response.status);
      if (outcome === "sent") {
        return { delivery_id: item.id, outcome };
      }
      let text = "";
      try {
        text = await response.text();
      } catch {
        text = "";
      }
      return { delivery_id: item.id, outcome, error: short(`${response.status} ${text}`) };
    } catch (error) {
      return { delivery_id: item.id, outcome: "retry", error: short(`network: ${String(error)}`) };
    } finally {
      clearTimeout(timer);
    }
  };
}

// ---------------------------------------------------------------- Expo push
export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_BATCH = 100;

export function expoMessage(item: AlertItem, message: PushMessage) {
  return {
    to: item.target.kind === "expo" ? item.target.token : "",
    title: message.title,
    body: message.body,
    data: { path: message.path, tag: message.tag },
    sound: message.quiet ? null : "default",
    priority: message.urgency === "high" ? "high" : "normal",
    ttl: message.ttlSeconds,
    channelId: message.quiet ? "alerts-quiet" : "alerts",
  };
}

export function createExpoSender(deps: { fetch: FetchLike; accessToken?: string | null; timeoutMs?: number }) {
  const timeoutMs = deps.timeoutMs ?? 15_000;
  return async function sendExpo(
    batch: { item: AlertItem; message: PushMessage }[],
  ): Promise<DeliveryResult[]> {
    const results: DeliveryResult[] = [];
    for (let start = 0; start < batch.length; start += EXPO_BATCH) {
      const chunk = batch.slice(start, start + EXPO_BATCH);
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
      };
      if (deps.accessToken) {
        headers.Authorization = `Bearer ${deps.accessToken}`;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await deps.fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(chunk.map(({ item, message }) => expoMessage(item, message))),
          signal: controller.signal,
        });
        if (response.status < 200 || response.status >= 300) {
          const outcome = classifyStatus(response.status);
          const error = short(`expo ${response.status}`);
          for (const { item } of chunk) {
            results.push({ delivery_id: item.id, outcome: outcome === "gone" ? "retry" : outcome, error });
          }
          continue;
        }
        const body = (await response.json()) as { data?: unknown };
        const tickets = Array.isArray(body?.data) ? body.data : [];
        chunk.forEach(({ item }, index) => {
          const ticket = tickets[index] as
            | { status?: string; message?: string; details?: { error?: string } }
            | undefined;
          if (ticket?.status === "ok") {
            results.push({ delivery_id: item.id, outcome: "sent" });
            return;
          }
          const code = ticket?.details?.error ?? "";
          const error = short(`expo ${code || "no ticket"} ${ticket?.message ?? ""}`);
          if (code === "DeviceNotRegistered") {
            results.push({ delivery_id: item.id, outcome: "gone", error });
          } else if (code === "MessageRateExceeded" || !ticket) {
            results.push({ delivery_id: item.id, outcome: "retry", error });
          } else {
            results.push({ delivery_id: item.id, outcome: "failed", error });
          }
        });
      } catch (error) {
        for (const { item } of chunk) {
          results.push({ delivery_id: item.id, outcome: "retry", error: short(`network: ${String(error)}`) });
        }
      } finally {
        clearTimeout(timer);
      }
    }
    return results;
  };
}

// ---------------------------------------------------------------- a batch
export interface Senders {
  web: (item: AlertItem, message: PushMessage) => Promise<DeliveryResult>;
  expo: (batch: { item: AlertItem; message: PushMessage }[]) => Promise<DeliveryResult[]>;
}

/** Sends every item once: web pushes `concurrency` at a time, Expo in batches. */
export async function deliverBatch(
  items: readonly AlertItem[],
  senders: Senders,
  concurrency = 10,
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];
  const web: { item: AlertItem; message: PushMessage }[] = [];
  const expo: { item: AlertItem; message: PushMessage }[] = [];
  for (const item of items) {
    let message: PushMessage;
    try {
      message = buildMessage(item);
    } catch (error) {
      results.push({ delivery_id: item.id, outcome: "failed", error: short(`message: ${String(error)}`) });
      continue;
    }
    (item.target.kind === "web" ? web : expo).push({ item, message });
  }
  let next = 0;
  async function worker() {
    while (next < web.length) {
      const job = web[next];
      next += 1;
      if (!job) break;
      try {
        results.push(await senders.web(job.item, job.message));
      } catch (error) {
        results.push({ delivery_id: job.item.id, outcome: "retry", error: short(String(error)) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, web.length)) }, worker));
  if (expo.length > 0) {
    try {
      results.push(...(await senders.expo(expo)));
    } catch (error) {
      for (const { item } of expo) {
        results.push({ delivery_id: item.id, outcome: "retry", error: short(String(error)) });
      }
    }
  }
  return results;
}
