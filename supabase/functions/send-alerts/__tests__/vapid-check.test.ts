/**
 * The VAPID key self-check of send-alerts: the public key derived from the
 * private one (pure P-256, no dependency) must equal Node's own derivation
 * for freshly generated key pairs, and the check answers only ok / mismatch /
 * missing. The app's key lives in ONE place (app-key.ts); the build script
 * and the Netlify mirror must carry the same.
 */
import { createECDH } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { APP_VAPID_PUBLIC_KEY } from "../app-key";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  checkVapidKeys,
  createKeyChecker,
  publicKeyFromPrivate,
  publicPointFromPrivate,
} from "../vapid-check";

/** A fresh P-256 key pair in the format web-push uses (base64url, no padding). */
function generatePair() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  // Node drops leading zero bytes of the scalar; web-push stores 32 bytes.
  const scalar = ecdh.getPrivateKey();
  const privateKey = Buffer.concat([Buffer.alloc(32 - scalar.length), scalar]);
  return {
    publicKey: ecdh.getPublicKey().toString("base64url"),
    privateKey: privateKey.toString("base64url"),
  };
}

describe("base64url", () => {
  it("round-trips any bytes, with or without padding, base64 or base64url", () => {
    for (let length = 1; length <= 70; length += 1) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length) & 0xff);
      const text = bytesToBase64Url(bytes);
      expect(text).toBe(Buffer.from(bytes).toString("base64url"));
      expect(Array.from(base64UrlToBytes(text) ?? [])).toEqual(Array.from(bytes));
      const classic = Buffer.from(bytes).toString("base64");
      expect(Array.from(base64UrlToBytes(classic) ?? [])).toEqual(Array.from(bytes));
    }
  });

  it("refuses text that is not base64", () => {
    expect(base64UrlToBytes("")).toBeNull();
    expect(base64UrlToBytes("abc$")).toBeNull();
    expect(base64UrlToBytes("a")).toBeNull();
  });
});

describe("public key from the private key (P-256)", () => {
  it("matches Node's derivation for 200 generated key pairs", () => {
    for (let i = 0; i < 200; i += 1) {
      const pair = generatePair();
      expect(publicKeyFromPrivate(pair.privateKey)).toBe(pair.publicKey);
    }
  });

  it("an uncompressed point: 65 bytes starting with 4", () => {
    const point = publicPointFromPrivate(base64UrlToBytes(generatePair().privateKey) ?? new Uint8Array());
    expect(point).toHaveLength(65);
    expect(point?.[0]).toBe(4);
  });

  it("a scalar with leading zero bytes (about 1 key in 128)", () => {
    const ecdh = createECDH("prime256v1");
    const scalar = Buffer.alloc(32);
    scalar[2] = 0x5a;
    scalar[31] = 0x07;
    ecdh.setPrivateKey(scalar);
    expect(bytesToBase64Url(publicPointFromPrivate(scalar) ?? new Uint8Array())).toBe(
      ecdh.getPublicKey().toString("base64url"),
    );
  });

  it("the private key 1 gives the curve's generator point", () => {
    const one = new Uint8Array(32);
    one[31] = 1;
    expect(Buffer.from(publicPointFromPrivate(one) ?? []).toString("hex")).toBe(
      "04" +
        "6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296" +
        "4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5",
    );
  });

  it("not a key: wrong length, zero, at or above the group order", () => {
    expect(publicPointFromPrivate(new Uint8Array(31).fill(1))).toBeNull();
    expect(publicPointFromPrivate(new Uint8Array(32))).toBeNull();
    expect(publicPointFromPrivate(new Uint8Array(32).fill(0xff))).toBeNull();
    expect(publicKeyFromPrivate("not base64!")).toBeNull();
  });
});

describe("checkVapidKeys", () => {
  const pair = generatePair();
  const other = generatePair();

  it("ok when the private key, the public secret and the app's key agree", () => {
    expect(checkVapidKeys({ ...pair, appPublicKey: pair.publicKey })).toBe("ok");
    // Padding or classic base64 in a secret is tolerated.
    expect(
      checkVapidKeys({
        publicKey: Buffer.from(base64UrlToBytes(pair.publicKey) ?? []).toString("base64"),
        privateKey: `${pair.privateKey}=`,
        appPublicKey: pair.publicKey,
      }),
    ).toBe("ok");
  });

  it("mismatch: secrets from two pairs, the app built with another key, a broken key", () => {
    expect(checkVapidKeys({ publicKey: pair.publicKey, privateKey: other.privateKey, appPublicKey: pair.publicKey })).toBe(
      "mismatch",
    );
    expect(checkVapidKeys({ ...pair, appPublicKey: other.publicKey })).toBe("mismatch");
    expect(checkVapidKeys({ publicKey: "AAAA", privateKey: pair.privateKey, appPublicKey: "AAAA" })).toBe("mismatch");
    expect(checkVapidKeys({ publicKey: pair.publicKey, privateKey: "%%%", appPublicKey: pair.publicKey })).toBe("mismatch");
  });

  it("missing: a secret not set", () => {
    expect(checkVapidKeys({ publicKey: undefined, privateKey: pair.privateKey, appPublicKey: pair.publicKey })).toBe("missing");
    expect(checkVapidKeys({ publicKey: pair.publicKey, privateKey: " ", appPublicKey: pair.publicKey })).toBe("missing");
  });

  it("the cached checker answers the same and recomputes when a secret changes", () => {
    const check = createKeyChecker(pair.publicKey);
    expect(check(pair.publicKey, pair.privateKey)).toBe("ok");
    expect(check(pair.publicKey, pair.privateKey)).toBe("ok");
    expect(check(pair.publicKey, other.privateKey)).toBe("mismatch");
    expect(check(undefined, undefined)).toBe("missing");
  });

  it("the answer never contains a key", () => {
    const result = checkVapidKeys({ ...pair, appPublicKey: other.publicKey });
    expect(["ok", "mismatch", "missing"]).toContain(result);
  });
});

describe("the app's public key is defined once", () => {
  const root = join(__dirname, "../../../..");

  it("is a valid P-256 public point", () => {
    const bytes = base64UrlToBytes(APP_VAPID_PUBLIC_KEY);
    expect(bytes).toHaveLength(65);
    expect(bytes?.[0]).toBe(4);
  });

  it("the web build script bakes the same key into the app", () => {
    const script = readFileSync(join(root, "scripts/build-app-web.sh"), "utf8");
    const match = /^export EXPO_PUBLIC_VAPID_PUBLIC_KEY=(\S+)$/m.exec(script);
    expect(match?.[1]).toBe(APP_VAPID_PUBLIC_KEY);
  });

  it("the dormant Netlify mirror carries the same key", () => {
    const toml = readFileSync(join(root, "netlify.toml"), "utf8");
    const match = /EXPO_PUBLIC_VAPID_PUBLIC_KEY = "([^"]+)"/.exec(toml);
    expect(match?.[1]).toBe(APP_VAPID_PUBLIC_KEY);
  });
});
