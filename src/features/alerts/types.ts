/**
 * Earthquake alerts behind a rollout switch (migration 0062, D83). The public
 * app keeps saying "alerts are coming soon"; only testers (permission
 * `alerts.test`, or on the allowlist) see the real settings while the mode is
 * `testers`.
 */
export type AlertMode = "off" | "testers" | "public";

export const ALERT_MODES: readonly AlertMode[] = ["off", "testers", "public"];

export interface AlertAccess {
  mode: AlertMode;
  /** Holds alerts.test or is on the allowlist. */
  tester: boolean;
  /** Sees the real alert settings (a tester, or everyone once public). */
  enabled: boolean;
  /** May change the rollout and the testers (alerts.manage). */
  canManage: boolean;
}

export const NO_ALERT_ACCESS: AlertAccess = {
  mode: "testers",
  tester: false,
  enabled: false,
  canManage: false,
};

export interface AlertTester {
  userId: string;
  username: string | null;
  displayName: string | null;
  /** allowlist: added in Admin; rank: holds alerts.test through a rank. */
  via: "allowlist" | "rank";
  devices: number;
}

export interface AlertRun {
  runId: string;
  /** UTC ms. */
  startedAt: number;
  mode: string;
  events: number;
  planned: number;
  suppressed: number;
  claimed: number;
  sent: number;
  failed: number;
  gone: number;
}

export interface AlertsOverview {
  mode: AlertMode;
  canManage: boolean;
  testers: AlertTester[];
  runs: AlertRun[];
  devices: number;
  waiting: number;
}

export interface AlertPreferencesPayload {
  nearMeTier: string;
  nearMeLat: number | null;
  nearMeLon: number | null;
  anotherTier: string;
  anotherLat: number | null;
  anotherLon: number | null;
  language: string;
}

/** One row of alerts_my_devices(): a browser or phone of this account. */
export interface AlertDevice {
  id: string;
  kind: "web" | "expo";
  /** Web push endpoint (null for a phone app). Identifies "this device". */
  endpoint: string | null;
  locale: string | null;
  /** UTC ms. */
  createdAt: number;
  /** UTC ms of the last push the service accepted, if any. */
  lastOkAt: number | null;
  /** The push service said the subscription is gone (404/410). */
  disabled: boolean;
}

export interface WebPushKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type AlertsErrorCode =
  | "unavailable"
  | "not_signed_in"
  | "not_enabled"
  | "not_allowed"
  | "not_found"
  | "too_soon"
  | "no_device"
  | "too_many_devices"
  | "invalid"
  | "denied"
  /** The permission question was closed without an answer. */
  | "dismissed"
  /** The browser itself failed to subscribe (push service error). */
  | "browser"
  | "network"
  | "unknown";

export class AlertsError extends Error {
  readonly code: AlertsErrorCode;
  constructor(code: AlertsErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AlertsError";
    this.code = code;
  }
}
