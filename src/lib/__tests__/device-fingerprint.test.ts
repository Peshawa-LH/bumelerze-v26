/**
 * The contributor ID is the database's `device_fingerprint()` (migration
 * 0055: `left(encode(sha256(convert_to(id, 'UTF8')), 'hex'), 8)`), never a
 * piece of the device id (security audit DB-03). Expected values below were
 * computed outside the app (Python hashlib), so they also pin the hash.
 */
import { createHash } from "node:crypto";

import { deviceFingerprint, formatDeviceFingerprint } from "../device-fingerprint";

const mockDigest = jest.fn();
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  CryptoEncoding: { HEX: "hex" },
  digestStringAsync: (...args: unknown[]) => mockDigest(...args),
}));

beforeEach(() => {
  mockDigest.mockReset();
  // What expo-crypto does on every platform: SHA-256 of the UTF-8 text, hex.
  mockDigest.mockImplementation(async (_algorithm: string, data: string) =>
    createHash("sha256").update(data, "utf8").digest("hex"),
  );
});

describe("deviceFingerprint", () => {
  it.each([
    ["3f2504e0-4f89-41d3-9a0c-0305e82c3301", "16362f56"],
    ["test-device-uuid-abcdefgh", "ee5be487"],
    ["abc", "ba7816bf"],
  ])("%s -> %s, as the database computes it", async (deviceId, expected) => {
    await expect(deviceFingerprint(deviceId)).resolves.toBe(expected);
  });

  it("hashes the id itself with SHA-256 and hex output", async () => {
    await deviceFingerprint("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    expect(mockDigest).toHaveBeenCalledWith(
      "SHA-256",
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      { encoding: "hex" },
    );
  });

  it("[DB-03] is never a piece of the device id (the old ID was its first 8 characters)", async () => {
    const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    const fingerprint = await deviceFingerprint(id);
    expect(fingerprint).toHaveLength(8);
    expect(id).not.toContain(fingerprint);
  });

  it("rejects where hashing is unavailable (a plain-http web page), never inventing a value", async () => {
    mockDigest.mockRejectedValueOnce(new Error("ERR_CRYPTO_UNAVAILABLE"));
    await expect(deviceFingerprint("x")).rejects.toThrow("ERR_CRYPTO_UNAVAILABLE");
  });
});

describe("formatDeviceFingerprint", () => {
  it("shows 8 upper-case characters, as the contributor ID always looked", () => {
    expect(formatDeviceFingerprint("16362f56")).toBe("16362F56");
    expect(formatDeviceFingerprint("16362f56aaaa")).toBe("16362F56");
  });
});
