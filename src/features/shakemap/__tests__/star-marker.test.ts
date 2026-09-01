import { buildStarMarkerSvgMarkup, starPointsAttribute, starVertices } from "../star-marker";

describe("starVertices", () => {
  it("returns 10 alternating outer/inner vertices centered at (cx, cy)", () => {
    const vertices = starVertices(10, 10, 6);
    expect(vertices).toHaveLength(10);
  });

  it("places the first vertex straight up from center (outer radius, -90deg)", () => {
    const [first] = starVertices(0, 0, 6);
    expect(first?.[0]).toBeCloseTo(0, 5);
    expect(first?.[1]).toBeCloseTo(-6, 5);
  });

  it("alternates outer/inner radius — every other vertex is closer to center", () => {
    const vertices = starVertices(0, 0, 10);
    const distances = vertices.map(([x, y]) => Math.sqrt(x * x + y * y));
    for (let i = 0; i < distances.length; i += 2) {
      expect(distances[i]).toBeCloseTo(10, 5);
    }
    for (let i = 1; i < distances.length; i += 2) {
      expect(distances[i]).toBeCloseTo(4, 5);
    }
  });
});

describe("starPointsAttribute", () => {
  it("joins vertices into an SVG points=\"x,y x,y ...\" string", () => {
    const attribute = starPointsAttribute(5, 5, 6);
    const pairs = attribute.split(" ");
    expect(pairs).toHaveLength(10);
    for (const pair of pairs) {
      expect(pair).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
    }
  });
});

describe("buildStarMarkerSvgMarkup", () => {
  it("builds a standalone <svg> markup string sized to the requested pixel size", () => {
    const markup = buildStarMarkerSvgMarkup(22, "#ff0000", "#ffffff");

    expect(markup).toContain('width="22"');
    expect(markup).toContain('height="22"');
    expect(markup).toContain('viewBox="0 0 22 22"');
    expect(markup).toContain("<polygon");
    expect(markup).toContain('fill="#ff0000"');
    expect(markup).toContain('stroke="#ffffff"');
  });

  it("keeps every star point well inside the requested viewBox (not clipped)", () => {
    const markup = buildStarMarkerSvgMarkup(20, "#ff0000", "#ffffff");
    const match = markup.match(/points="([^"]+)"/);
    expect(match).not.toBeNull();
    const points = match![1]!.split(" ").map((pair) => pair.split(",").map(Number));
    for (const [x, y] of points) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(20);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(20);
    }
  });
});
