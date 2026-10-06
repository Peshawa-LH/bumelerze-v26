import { clamp, orient, PHONE_EDGES, phoneCorners, projectPoint } from "../projection";

describe("projection", () => {
  it("maps the origin to the drawing centre", () => {
    expect(projectPoint({ x: 0, y: 0, z: 0 }, 100, 150, 120)).toEqual({ u: 150, v: 120 });
  });

  it("keeps +y pointing up the screen and +x to the right", () => {
    const up = projectPoint({ x: 0, y: 1, z: 0 }, 100, 0, 0);
    const right = projectPoint({ x: 1, y: 0, z: 0 }, 100, 0, 0);
    expect(up.v).toBeLessThan(0);
    expect(Math.abs(up.u)).toBeLessThan(1e-9);
    expect(right.u).toBeGreaterThan(0);
  });

  it("gives every axis a distinct direction on screen", () => {
    const dirs = (["x", "y", "z"] as const).map((axis) => {
      const p = projectPoint({ x: 0, y: 0, z: 0, [axis]: 1 }, 1, 0, 0);
      return Math.atan2(p.v, p.u);
    });
    const [a, b, c] = dirs;
    expect(Math.abs(a! - b!)).toBeGreaterThan(0.3);
    expect(Math.abs(b! - c!)).toBeGreaterThan(0.3);
    expect(Math.abs(a! - c!)).toBeGreaterThan(0.3);
  });

  it("describes a closed slab: eight corners, twelve edges, each corner on three edges", () => {
    expect(phoneCorners()).toHaveLength(8);
    expect(PHONE_EDGES).toHaveLength(12);
    for (let i = 0; i < 8; i += 1) {
      expect(PHONE_EDGES.filter(([a, b]) => a === i || b === i)).toHaveLength(3);
    }
  });

  it("clamps symmetrically", () => {
    expect(clamp(0.2, 0.5)).toBe(0.2);
    expect(clamp(3, 0.5)).toBe(0.5);
    expect(clamp(-3, 0.5)).toBe(-0.5);
  });

  it("lying flat, the screen's normal (z) points up the drawing and the long side recedes", () => {
    const zUp = projectPoint({ x: 0, y: 0, z: 1 }, 100, 0, 0, "flat");
    expect(zUp.v).toBeLessThan(0);
    expect(Math.abs(zUp.u)).toBeLessThan(1e-9);
    // The long side is no longer the vertical: it now runs mostly sideways/into the scene.
    const yFlat = projectPoint({ x: 0, y: 1, z: 0 }, 100, 0, 0, "flat");
    const yStanding = projectPoint({ x: 0, y: 1, z: 0 }, 100, 0, 0);
    expect(Math.abs(yFlat.v)).toBeLessThan(Math.abs(yStanding.v));
  });

  it("flipping is a rotation: lengths kept, standing is unchanged", () => {
    const p = { x: 0.3, y: -0.5, z: 0.2 };
    const flat = orient(p, "flat");
    expect(Math.hypot(flat.x, flat.y, flat.z)).toBeCloseTo(Math.hypot(p.x, p.y, p.z));
    expect(orient(p, "standing")).toEqual(p);
  });
});
