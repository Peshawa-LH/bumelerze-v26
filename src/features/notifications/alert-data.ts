import type { Href } from "expo-router";
import { z } from "zod";

/**
 * What an earthquake alert notification carries besides its text: the
 * `data` the send-alerts edge function puts in every Expo push
 * (supabase/functions/send-alerts/senders.ts, `expoMessage`):
 *
 *   { path: "event/bml2026abcd" | "notification-settings", tag: "ev-bml2026abcd" }
 *
 * On iOS a remote push arrives with this object under the payload's `body`
 * key, and expo-notifications hands it over as `content.data`. A local
 * notification (the alert rehearsal) has neither field.
 */
const alertDataSchema = z.object({
  path: z.string().max(200).optional().catch(undefined),
  tag: z.string().max(100).optional().catch(undefined),
});

export interface AlertData {
  path: string | null;
  tag: string | null;
}

export function readAlertData(data: unknown): AlertData {
  const parsed = alertDataSchema.safeParse(data ?? {});
  if (!parsed.success) {
    return { path: null, tag: null };
  }
  return {
    path: parsed.data.path && parsed.data.path.length > 0 ? parsed.data.path : null,
    tag: parsed.data.tag && parsed.data.tag.length > 0 ? parsed.data.tag : null,
  };
}

/** Same rule as the web's service worker (public/push-sw.js, `targetUrl`):
 * only a simple in-app path, never another site or a `//` path. */
const IN_APP_PATH = /^[A-Za-z0-9_-][A-Za-z0-9/_-]*$/;
const EVENT_PATH = /^event\/([A-Za-z0-9_-]+)$/;

/**
 * The screen a tapped alert opens: the event page for `event/<id>` (a
 * bml id; the event route also accepts provider ids), Notification
 * Settings for the test alert, or any other simple in-app path. Null for
 * anything else (the app then simply opens where it was).
 */
export function hrefForAlertPath(path: string | null): Href | null {
  if (!path || !IN_APP_PATH.test(path) || path.includes("//")) {
    return null;
  }
  const event = EVENT_PATH.exec(path);
  if (event?.[1]) {
    return { pathname: "/event/[id]", params: { id: event[1] } };
  }
  return `/${path.replace(/\/+$/, "")}` as Href;
}
