import fs from "node:fs";
import path from "node:path";

import glyphMap from "@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json";

import subsetNames from "../../../assets/fonts/web/Ionicons-subset.json";

/**
 * The web build draws icons with a cut-down Ionicons font (only the icons in
 * use, `scripts/build-web-icon-font.py`). An icon missing from it would show
 * as an empty box on the web, so every Ionicons name written in the code must
 * be in the cut-down font. When this fails after adding an icon, run:
 *
 *     pip install fonttools && python3 scripts/build-web-icon-font.py
 */
const ROOT = path.resolve(__dirname, "../../..");
const LITERAL = /["'`]([a-z0-9-]+)["'`]/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") {
        out.push(...sourceFiles(full));
      }
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("web icon font subset", () => {
  it("contains every Ionicons name used in src/ and app/", () => {
    const glyphs = glyphMap as Record<string, number>;
    const inSubset = new Set(subsetNames as string[]);
    const missing = new Set<string>();
    for (const file of [
      ...sourceFiles(path.join(ROOT, "src")),
      ...sourceFiles(path.join(ROOT, "app")),
    ]) {
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(LITERAL)) {
        const name = match[1]!;
        if (Object.prototype.hasOwnProperty.call(glyphs, name) && !inSubset.has(name)) {
          missing.add(`${name} (${path.relative(ROOT, file)})`);
        }
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("is a real font file", () => {
    const font = fs.readFileSync(path.join(ROOT, "assets/fonts/web/Ionicons-subset.ttf"));
    expect(font.length).toBeGreaterThan(10_000);
    expect(font.length).toBeLessThan(200_000);
  });
});
