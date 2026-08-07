import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

/**
 * Repo-wide static accessibility invariants (accessibility-tester Phase 5
 * audit) — the kind of thing a lint rule would catch in a larger codebase,
 * reimplemented as a plain filesystem scan since this project doesn't run
 * eslint-plugin-react-native-a11y yet. Scans `app/` and `src/` (skipping
 * this file's own directory of test fixtures) for source files, not test
 * files, so a future regression fails CI instead of silently reappearing.
 */

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["app", "src"];
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function collectSourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) {
        continue;
      }
      collectSourceFiles(fullPath, files);
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  return files;
}

const sourceFiles = SCAN_DIRS.flatMap((dir) => collectSourceFiles(join(ROOT, dir)));

describe("a11y static invariants — repo-wide", () => {
  it("scanned at least one file in each of app/ and src/ (sanity check the scan itself isn't silently empty)", () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  it("never disables font scaling (allowFontScaling={false}) anywhere — 200% Dynamic Type support is a hard requirement (PROJECT.md, design-language.md §8)", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const content = readFileSync(file, "utf8");
      if (/allowFontScaling\s*[=:]\s*\{?\s*false\s*\}?/.test(content)) {
        offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never sets maxFontSizeMultiplier without an inline justification comment on the same or a nearby line (design-language.md §8: only \"with justification\")", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!line.includes("maxFontSizeMultiplier")) {
          return;
        }
        const context = lines.slice(Math.max(0, index - 3), index + 1).join("\n");
        if (!/\/\/|\/\*/.test(context)) {
          offenders.push(`${relative(ROOT, file)}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
