import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import ts from "typescript";

/**
 * Static rules for direction and dates that only fail on a phone (iOS
 * parity, 2026-10-20). Jest runs in Node, whose ICU and layout never show
 * these bugs, so they are pinned down here as source rules.
 *
 * 1. Physical text alignment goes through `physicalTextAlign`,
 *    `directionStyle` or `ltrValueStyle` (`src/i18n/index.ts`). iOS and
 *    Android swap a bare `textAlign: "left"`/`"right"` under a right-to-left
 *    layout, and a side picked by locale ("right" for Sorani) flips twice.
 *    The sites below predate the rule and are fixed in the closing sweep of
 *    the iOS parity work (batch b, phase 2): the list may only shrink.
 * 2. A `Text` styled inline with a size of its own (not the whole type
 *    token, which carries `READING_START`) states its alignment. Without
 *    one, iOS aligns it by the app's iOS language, which only follows a
 *    language picked in the app after the next cold start: right after the
 *    switch, Sorani paragraphs sat on the left under right-aligned headings.
 * 3. Dates and times go through `src/features/events/format.ts`. Hermes on
 *    iOS answers `Intl` in the locale's own digits whatever `-u-nu-latn`
 *    says (Sorani dates read "NaN months.short.NaN") and has no Sorani or
 *    Kurmanji month names, so `toLocaleString(locale)` and friends, and
 *    `Intl.DateTimeFormat` with the reader's locale, are not used anywhere
 *    else.
 */

const ROOT = join(__dirname, "..", "..", "..");
const SCAN_DIRS = ["app", "src"];

function collect(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry.startsWith("__") || entry.startsWith(".")) {
        continue;
      }
      collect(full, files);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

const FILES = SCAN_DIRS.flatMap((dir) => collect(join(ROOT, dir))).map((file) => ({
  path: relative(ROOT, file),
  // Code only: comments may describe the old patterns.
  code: readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    // Sides handed to the helper are fine.
    .replace(/physicalTextAlign\((?:[^()]|\([^()]*\))*\)/g, "physicalTextAlign()"),
}));

function countMatches(pattern: RegExp): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { path, code } of FILES) {
    const found = code.match(pattern)?.length ?? 0;
    if (found > 0) {
      counts[path] = found;
    }
  }
  return counts;
}

/** Bare physical sides and sides picked by locale, per file, still to be
 * moved to the helpers (phase 2). Keep in step: remove an entry when its
 * file is fixed. */
const PHYSICAL_ALIGN_PHASE_2: Record<string, number> = {
  // The catalogue link row: `row-reverse` picked by locale flips twice on the
  // web as well (fixed on both in its own commit).
  "app/(tabs)/(home,map,sensor,profile,settings)/historical.tsx": 1,
};

describe("native direction and date rules (source scan)", () => {
  it("scans the app", () => {
    expect(FILES.length).toBeGreaterThan(300);
  });

  it("[regression] physical textAlign only through the helpers (the known sites may only shrink)", () => {
    const literal = /textAlign:[^,}\n]*["'](?:left|right)["']/g;
    const pickedByLocale = /\?\s*["'](?:left|right)["']\s*:\s*["'](?:left|right)["']/g;
    const reverseByLocale =
      /\?\s*["']row-reverse["']\s*:\s*["']row["']|\?\s*["']row["']\s*:\s*["']row-reverse["']/g;
    const counts: Record<string, number> = {};
    for (const pattern of [literal, pickedByLocale, reverseByLocale]) {
      for (const [path, found] of Object.entries(countMatches(pattern))) {
        counts[path] = (counts[path] ?? 0) + found;
      }
    }
    // The helpers themselves, and the iOS reading start of the theme.
    delete counts["src/i18n/index.ts"];
    delete counts["src/theme/typography.ts"];
    // The share card is a fixed picture: its container pins `direction: "ltr"`, so its
    // physical sides are meant literally and iOS does not swap them.
    delete counts["src/features/share/ShareCardSvg.tsx"];
    expect(counts).toEqual(PHYSICAL_ALIGN_PHASE_2);
  });

  it("[regression] a Text styled inline with its own size states its alignment (READING_START)", () => {
    // Files the notifications batch owns: a follow-up sweep after it merges.
    const pending =
      /^(src\/features\/(alerts|notifications)\/|app\/onboarding\/notifications\.tsx$|app\/\(tabs\)\/[^/]+\/notification-settings\.tsx$)/;
    const isText = (tag: string) => tag === "Text" || tag === "Animated.Text";
    const offenders: string[] = [];
    for (const { path } of FILES) {
      if (!path.endsWith(".tsx") || pending.test(path)) {
        continue;
      }
      const source = readFileSync(join(ROOT, path), "utf8");
      const file = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const insideText = (element: ts.Node): boolean => {
        for (let node = element.parent; node; node = node.parent) {
          if (
            ts.isJsxElement(node) &&
            node !== element.parent &&
            isText(node.openingElement.tagName.getText(file))
          ) {
            return true;
          }
          if (!(
            ts.isJsxElement(node) ||
            ts.isJsxFragment(node) ||
            ts.isJsxExpression(node) ||
            ts.isParenthesizedExpression(node) ||
            ts.isConditionalExpression(node) ||
            ts.isBinaryExpression(node)
          )) {
            return false;
          }
        }
        return false;
      };
      const visit = (node: ts.Node): void => {
        if (
          ts.isJsxAttribute(node) &&
          node.name.getText(file) === "style" &&
          node.initializer &&
          ts.isJsxExpression(node.initializer) &&
          node.initializer.expression &&
          ts.isObjectLiteralExpression(node.initializer.expression)
        ) {
          const element = node.parent.parent;
          const names = node.initializer.expression.properties.map((property) =>
            ts.isSpreadAssignment(property)
              ? "..."
              : (property.name?.getText(file) ?? ""),
          );
          if (
            isText(element.tagName.getText(file)) &&
            names.includes("fontSize") &&
            !names.some(
              (name) =>
                name === "textAlign" || name === "writingDirection" || name === "...",
            ) &&
            !insideText(element)
          ) {
            const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
            offenders.push(`${path}:${line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    expect(offenders).toEqual([]);
  });

  it("[regression] no locale-dependent toLocaleString / toLocaleDateString / toLocaleTimeString", () => {
    const offenders = Object.keys(
      countMatches(/\.toLocale(?:Date|Time)?String\(\s*(?!["']en-US["']\s*\))[^)]/g),
    );
    expect(offenders).toEqual([]);
  });

  it("[regression] Intl.DateTimeFormat only in events/format.ts, never with -u-nu-latn (Hermes ignores it)", () => {
    expect(Object.keys(countMatches(/Intl\.DateTimeFormat\(/g))).toEqual([
      "src/features/events/format.ts",
    ]);
    expect(Object.keys(countMatches(/-u-nu-/g))).toEqual([]);
  });
});
