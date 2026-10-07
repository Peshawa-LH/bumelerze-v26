import { buildQrPath } from "../qr-path";

describe("buildQrPath", () => {
  it("draws the dark modules as one path in the requested box", () => {
    const { modules, path } = buildQrPath(
      "https://bumelerze.com/app/event/bml202602ia",
      200,
    );
    // A short URL fits a version-3 symbol (29 modules) at error correction M.
    expect(modules).toBeGreaterThanOrEqual(25);
    expect(modules).toBeLessThanOrEqual(41);
    expect(path.startsWith("M")).toBe(true);
    expect(path).toMatch(/h[\d.]+v[\d.]+h-[\d.]+z/);
  });

  it("is deterministic and depends on the value", () => {
    const a = buildQrPath("https://bumelerze.com/app/event/bml202602ia", 100).path;
    expect(buildQrPath("https://bumelerze.com/app/event/bml202602ia", 100).path).toBe(a);
    expect(buildQrPath("https://bumelerze.com/app/event/bml202600rx", 100).path).not.toBe(
      a,
    );
  });

  it("keeps every coordinate inside the box", () => {
    const { path } = buildQrPath("hello", 120);
    const starts = [...path.matchAll(/M([\d.]+) ([\d.]+)/g)];
    for (const [, x, y] of starts) {
      expect(Number(x)).toBeLessThan(120);
      expect(Number(y)).toBeLessThan(120);
    }
  });
});
