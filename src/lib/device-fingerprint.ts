import * as Crypto from "expo-crypto";

/**
 * The short, public form of a device id (security audit DB-03). The device
 * id itself moves a device's guest reports on a server without migration
 * 0079, so it is never shown; people and support see this instead.
 *
 * Exactly the database's `device_fingerprint()` (migration 0055): the first
 * 8 hex characters of the SHA-256 of the id's UTF-8 text. That is what the
 * admin People pages list under "Devices" and what their search takes, so a
 * contributor ID read out by a person finds their device. One-way: it
 * cannot be turned back into the id.
 *
 * SHA-256 from `expo-crypto` (already in the app for the id itself): native
 * hashing on iOS/Android, the browser's Web Crypto on the web (https only,
 * which app.bumelerze.com is).
 */

export const DEVICE_FINGERPRINT_LENGTH = 8;

/** Lower-case hex, as the database writes it. Rejects where hashing is
 * unavailable (a web page served over plain http). */
export async function deviceFingerprint(deviceId: string): Promise<string> {
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, deviceId, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
  return hex.slice(0, DEVICE_FINGERPRINT_LENGTH).toLowerCase();
}

/**
 * How a fingerprint is shown and read out: upper case ("3FA9C01B"), as the
 * contributor ID always looked. The admin search lower-cases what it is
 * given, so either form finds the device. Kept to 8 characters even when
 * handed something longer.
 */
export function formatDeviceFingerprint(fingerprint: string): string {
  return fingerprint.slice(0, DEVICE_FINGERPRINT_LENGTH).toUpperCase();
}
