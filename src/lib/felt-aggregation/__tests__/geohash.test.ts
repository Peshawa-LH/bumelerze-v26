import { encodeGeohash } from "../geohash";

describe("encodeGeohash", () => {
  // Canonical geohash.org worked example — published on the geohash.org
  // homepage and reproduced in every geohash implementation's test suite:
  // (57.64911, 10.40744) → "u4pruydqqvj..." (11-char precision shown here;
  // the 4/5/6 truncations below are prefixes of the same string, which is
  // an intrinsic property of the geohash algorithm — each additional
  // character only subdivides the previous cell, it never changes earlier
  // characters).
  it("matches the canonical geohash.org vector at 11-char precision", () => {
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe("u4pruydqqvj");
  });

  it("matches the canonical vector truncated to p4/p5/p6 (D18 §3.1 precisions)", () => {
    expect(encodeGeohash(57.64911, 10.40744, 4)).toBe("u4pr");
    expect(encodeGeohash(57.64911, 10.40744, 5)).toBe("u4pru");
    expect(encodeGeohash(57.64911, 10.40744, 6)).toBe("u4pruy");
  });

  // Regional sanity vectors — Slemani (As-Sulaymaniyah), Kurdistan Region,
  // Iraq (35.56, 45.43). Ground truth computed independently in Python with
  // the same standard Niemeyer geohash algorithm (not derived from this
  // file's implementation), so this is a genuine cross-check, not a
  // tautology.
  it("encodes Slemani (35.56, 45.43) at p4/p5/p6", () => {
    expect(encodeGeohash(35.56, 45.43, 4)).toBe("tn26");
    expect(encodeGeohash(35.56, 45.43, 5)).toBe("tn263");
    expect(encodeGeohash(35.56, 45.43, 6)).toBe("tn263c");
  });

  it("longer precisions are prefix-extensions of shorter ones (nesting property)", () => {
    const p6 = encodeGeohash(35.56, 45.43, 6);
    expect(p6.startsWith(encodeGeohash(35.56, 45.43, 5))).toBe(true);
    expect(p6.startsWith(encodeGeohash(35.56, 45.43, 4))).toBe(true);
  });

  it("handles the origin and boundary coordinates without throwing", () => {
    expect(encodeGeohash(0, 0, 5)).toBe("s0000");
    expect(encodeGeohash(90, 180, 5)).toHaveLength(5);
    expect(encodeGeohash(-90, -180, 5)).toHaveLength(5);
  });
});
