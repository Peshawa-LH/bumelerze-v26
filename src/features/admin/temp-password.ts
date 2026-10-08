import * as Crypto from "expo-crypto";

/** 32 characters, so one random byte masked to 5 bits maps onto it without
 * bias. No I, O, 0 or 1: an admin reads or dictates this over a phone call. */
export const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const GROUPS = 3;
const GROUP_LENGTH = 4;

/**
 * A temporary password like `K7QM-2XWD-9HPA` (12 random characters, 60 bits,
 * three groups of four). Made on the admin's device, sent once to the reset
 * RPC and shown once; never stored. `randomBytes` is injectable for tests.
 */
export function generateTempPassword(
  randomBytes: (length: number) => Uint8Array = Crypto.getRandomBytes,
): string {
  const bytes = randomBytes(GROUPS * GROUP_LENGTH);
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g += 1) {
    let group = "";
    for (let i = 0; i < GROUP_LENGTH; i += 1) {
      const byte = bytes[g * GROUP_LENGTH + i] ?? 0;
      group += TEMP_PASSWORD_ALPHABET.charAt(byte & 31);
    }
    groups.push(group);
  }
  return groups.join("-");
}
