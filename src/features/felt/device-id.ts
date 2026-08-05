import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

/**
 * Anonymous per-install device id (D8 identity model; spec-v1.md §5.2:
 * "Identity: anonymous per-install device ID (required on every report)").
 * Generated once via `expo-crypto`'s cryptographically-random UUID v4,
 * persisted in AsyncStorage, and reused for the lifetime of the install.
 *
 * Deliberately NOT tied to any Supabase auth identity — felt reporting must
 * work with zero network round-trips to an auth endpoint (PROJECT.md offline
 * requirement; D8: "must not require signup"). Uninstalling the app loses
 * this id by design: a fresh install is a fresh anonymous device, matching
 * D8's v1 stance (the schema's nullable `user_id` column is where a future
 * optional-account identity attaches, not this id).
 */

const DEVICE_ID_STORAGE_KEY = "bumelerze.device-id";

let cachedDeviceIdPromise: Promise<string> | null = null;

async function resolveDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const generated = Crypto.randomUUID();
  await AsyncStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
  return generated;
}

/**
 * Returns the device's anonymous id, generating and persisting one on first
 * call. Safe to call from anywhere (felt-report submission, future
 * telemetry) — the in-memory promise cache means concurrent callers within
 * one app session all resolve to the exact same id without racing two
 * writes to AsyncStorage.
 */
export function getDeviceId(): Promise<string> {
  if (!cachedDeviceIdPromise) {
    cachedDeviceIdPromise = resolveDeviceId();
  }
  return cachedDeviceIdPromise;
}

/**
 * Test-only escape hatch: clears the in-memory cache so a test can force a
 * fresh AsyncStorage read after seeding or clearing the mocked storage.
 * Never called from app code.
 */
export function __resetDeviceIdCacheForTests(): void {
  cachedDeviceIdPromise = null;
}
