// Pure: checks that the three copies of the web push (VAPID) key pair agree,
// without ever revealing a key. No Deno, no network, no dependency; Jest runs
// the same code (__tests__/vapid-check.test.ts).
//
// A browser subscribes with the PUBLIC key baked into the app build; the push
// service then accepts only pushes signed with the matching PRIVATE key. If
// the secrets and the app disagree, every push is refused (403) and nobody
// gets an alert. So, before sending anything, the function derives the public
// key from VAPID_PRIVATE_KEY (P-256: public = private x G, as an uncompressed
// point, base64url) and compares it with VAPID_PUBLIC_KEY and with the app's
// key (app-key.ts). The answer is only "ok", "mismatch" or "missing".

export type KeyCheck = "ok" | "mismatch" | "missing";

// ------------------------------------------------------------ base64url
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** base64 or base64url, padded or not. Null if it is not valid. */
export function base64UrlToBytes(text: string): Uint8Array | null {
  const clean = text.trim().replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  if (clean.length === 0 || clean.length % 4 === 1 || /[^A-Za-z0-9_-]/.test(clean)) {
    return null;
  }
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += ALPHABET[(buffer >> bits) & 0x3f];
    }
    buffer &= 0xff;
  }
  if (bits > 0) {
    out += ALPHABET[(buffer << (6 - bits)) & 0x3f];
  }
  return out;
}

// ------------------------------------------------------------ P-256
const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
const GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;

const mod = (value: bigint): bigint => {
  const r = value % P;
  return r < 0n ? r + P : r;
};

function modPow(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let b = mod(base);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = mod(result * b);
    b = mod(b * b);
    e >>= 1n;
  }
  return result;
}

/** Jacobian point (X, Y, Z); null is the point at infinity. */
type Jacobian = [bigint, bigint, bigint] | null;

function double(point: Jacobian): Jacobian {
  if (!point) return null;
  const [x, y, z] = point;
  if (y === 0n) return null;
  // a = -3 for P-256.
  const delta = mod(z * z);
  const gamma = mod(y * y);
  const beta = mod(x * gamma);
  const alpha = mod(3n * (x - delta) * (x + delta));
  const x3 = mod(alpha * alpha - 8n * beta);
  const z3 = mod((y + z) * (y + z) - gamma - delta);
  const y3 = mod(alpha * (4n * beta - x3) - 8n * gamma * gamma);
  return [x3, y3, z3];
}

/** point + (ax, ay), the second in affine coordinates. */
function addAffine(point: Jacobian, ax: bigint, ay: bigint): Jacobian {
  if (!point) return [ax, ay, 1n];
  const [x1, y1, z1] = point;
  const z1z1 = mod(z1 * z1);
  const u2 = mod(ax * z1z1);
  const s2 = mod(ay * z1 * z1z1);
  const h = mod(u2 - x1);
  const r = mod(s2 - y1);
  if (h === 0n) {
    return r === 0n ? double(point) : null;
  }
  const hh = mod(h * h);
  const hhh = mod(h * hh);
  const v = mod(x1 * hh);
  const x3 = mod(r * r - hhh - 2n * v);
  const y3 = mod(r * (v - x3) - y1 * hhh);
  const z3 = mod(z1 * h);
  return [x3, y3, z3];
}

function toHex32(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    out.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
}

/**
 * The uncompressed public point (0x04 || x || y, 65 bytes) of a 32-byte
 * P-256 private scalar, or null if the scalar is not a valid key.
 */
export function publicPointFromPrivate(privateKey: Uint8Array): Uint8Array | null {
  if (privateKey.length !== 32) {
    return null;
  }
  let d = 0n;
  for (const byte of privateKey) {
    d = (d << 8n) | BigInt(byte);
  }
  if (d === 0n || d >= N) {
    return null;
  }
  let acc: Jacobian = null;
  for (let bit = 255; bit >= 0; bit -= 1) {
    acc = double(acc);
    if ((d >> BigInt(bit)) & 1n) {
      acc = addAffine(acc, GX, GY);
    }
  }
  if (!acc) {
    return null;
  }
  const [x, y, z] = acc;
  const zInv = modPow(z, P - 2n);
  const zInv2 = mod(zInv * zInv);
  const ax = mod(x * zInv2);
  const ay = mod(y * zInv2 * zInv);
  return Uint8Array.from([4, ...hexToBytes(toHex32(ax)), ...hexToBytes(toHex32(ay))]);
}

/** base64url public key for a base64url private key (null if invalid). */
export function publicKeyFromPrivate(privateKey: string): string | null {
  const bytes = base64UrlToBytes(privateKey);
  const point = bytes ? publicPointFromPrivate(bytes) : null;
  return point ? bytesToBase64Url(point) : null;
}

function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  return a !== null && b !== null && a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/**
 * "missing"  a secret is not set (nothing can be signed);
 * "mismatch" the private key is invalid, or its public key differs from
 *            VAPID_PUBLIC_KEY, or VAPID_PUBLIC_KEY differs from the app's;
 * "ok"       all three agree.
 */
export function checkVapidKeys(keys: {
  publicKey: string | null | undefined;
  privateKey: string | null | undefined;
  appPublicKey: string;
}): KeyCheck {
  const publicKey = keys.publicKey?.trim() ?? "";
  const privateKey = keys.privateKey?.trim() ?? "";
  if (publicKey === "" || privateKey === "") {
    return "missing";
  }
  const declared = base64UrlToBytes(publicKey);
  const derived = (() => {
    const bytes = base64UrlToBytes(privateKey);
    return bytes ? publicPointFromPrivate(bytes) : null;
  })();
  const app = base64UrlToBytes(keys.appPublicKey);
  if (declared === null || declared.length !== 65 || !sameBytes(derived, declared) || !sameBytes(declared, app)) {
    return "mismatch";
  }
  return "ok";
}

/** checkVapidKeys, computed once per key pair (the derivation costs a few ms). */
export function createKeyChecker(appPublicKey: string) {
  let lastInput: string | null = null;
  let lastResult: KeyCheck = "missing";
  return (publicKey: string | null | undefined, privateKey: string | null | undefined): KeyCheck => {
    const input = `${publicKey ?? ""}\n${privateKey ?? ""}`;
    if (input !== lastInput) {
      lastResult = checkVapidKeys({ publicKey, privateKey, appPublicKey });
      lastInput = input;
    }
    return lastResult;
  };
}
