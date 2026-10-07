import fs from "node:fs";
import path from "node:path";

import { PICTOGRAM_XML } from "../pictograms.generated";

const DIR = path.join(__dirname, "../../../../assets/artwork/building");

describe("building pictograms", () => {
  const files = fs.readdirSync(DIR).filter((file) => file.endsWith(".svg"));

  it("the generated module holds exactly the drawings in assets/artwork/building", () => {
    expect(Object.keys(PICTOGRAM_XML).sort()).toEqual(
      files.map((file) => file.replace(/\.svg$/, "")).sort(),
    );
    expect(files).toHaveLength(24);
  });

  it("is in sync with the SVG files (run `npm run generate:building-pictograms` after editing one)", () => {
    for (const file of files) {
      const name = file.replace(/\.svg$/, "") as keyof typeof PICTOGRAM_XML;
      const xml = fs
        .readFileSync(path.join(DIR, file), "utf8")
        .replace(/>\s+</g, "><")
        .trim();
      expect(PICTOGRAM_XML[name]).toBe(xml);
    }
  });

  it("follows the drawing conventions: viewBox 64, stroke 3, tinted by currentColor, no text", () => {
    for (const xml of Object.values(PICTOGRAM_XML)) {
      expect(xml).toContain('viewBox="0 0 64 64"');
      expect(xml).toContain('stroke-width="3"');
      expect(xml).toContain('stroke="currentColor"');
      expect(xml).not.toMatch(/<text|<image|#[0-9a-f]{3,6}/i);
    }
  });
});
