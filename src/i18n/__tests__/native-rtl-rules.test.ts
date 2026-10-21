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
 *    The sites that predated the rule were moved in the closing sweep of the
 *    iOS parity work (batch b, phase 2): none is left.
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
 * 4. A text box (`TextInput`) takes "left" and "right" literally on every
 *    platform, so it never gets a paragraph's alignment: not
 *    `physicalTextAlign`, `directionStyle`, `ltrValueStyle` or
 *    `READING_START`, and a whole type token (which carries
 *    `READING_START`) only with an alignment of its own. Boxes use
 *    `physicalInputAlign`, `inputDirectionStyle` and `ltrValueInputStyle`
 *    (parity re-check N1: Sorani coordinates on the left, the sign-in
 *    email on the right).
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

/** Bare physical sides and sides picked by locale. The closing sweep of the
 * iOS parity work (2026-10-21) moved the last of them to the helpers: the
 * list is empty and stays so. */
const PHYSICAL_ALIGN_PHASE_2: Record<string, number> = {};

describe("native direction and date rules (source scan)", () => {
  it("scans the app", () => {
    expect(FILES.length).toBeGreaterThan(300);
  });

  it("[regression] physical textAlign only through the helpers (no site left)", () => {
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
    // Runs of a share-card string, built in a variable and rendered inside
    // that string's own Text: an alignment on a run overrode the parent's
    // (the hub card's "٣.٢ پلە" lost its side and its unit word).
    const nestedElsewhere = ["src/features/share/ShareCardSvg.tsx"];
    const isText = (tag: string) => tag === "Text" || tag === "Animated.Text";
    const offenders: string[] = [];
    for (const { path } of FILES) {
      if (!path.endsWith(".tsx") || nestedElsewhere.includes(path)) {
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

  it('[regression] app text never takes UIKit\'s natural side: a Text showing a translation with textAlign "auto" also spreads READING_START', () => {
    // `textAlign: "auto"` is the web's own start, but on iOS it is UIKit's
    // "natural" side, which follows the language the app process started in,
    // not the one chosen in the app: after a switch from Sorani to English
    // the hub's prediction notice sat on the right until the next cold start.
    // It stays right for what people write (posts, notes, feedback), whose
    // direction is their own; app strings (`t(...)`) start at the reading start.
    const offenders: string[] = [];
    for (const { path } of FILES) {
      if (!path.endsWith(".tsx")) {
        continue;
      }
      const source = readFileSync(join(ROOT, path), "utf8");
      if (!source.includes('"auto"')) {
        continue;
      }
      const file = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const showsTranslation = (element: ts.JsxElement): boolean =>
        element.children.some(
          (child) =>
            ts.isJsxExpression(child) &&
            child.expression !== undefined &&
            ts.isCallExpression(child.expression) &&
            child.expression.expression.getText(file) === "t",
        );
      const visit = (node: ts.Node): void => {
        if (
          ts.isJsxElement(node) &&
          node.openingElement.tagName.getText(file) === "Text"
        ) {
          for (const attribute of node.openingElement.attributes.properties) {
            if (
              !ts.isJsxAttribute(attribute) ||
              attribute.name.getText(file) !== "style" ||
              !attribute.initializer ||
              !ts.isJsxExpression(attribute.initializer) ||
              !attribute.initializer.expression ||
              !ts.isObjectLiteralExpression(attribute.initializer.expression)
            ) {
              continue;
            }
            const properties = attribute.initializer.expression.properties;
            const natural = properties.some(
              (property) =>
                ts.isPropertyAssignment(property) &&
                property.name.getText(file) === "textAlign" &&
                property.initializer.getText(file) === '"auto"',
            );
            const spread = properties.some((property) => ts.isSpreadAssignment(property));
            if (natural && !spread && showsTranslation(node)) {
              const { line } = file.getLineAndCharacterOfPosition(
                attribute.getStart(file),
              );
              offenders.push(`${path}:${line + 1}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    expect(offenders).toEqual([]);
  });

  it("[regression] a text box never takes a paragraph's alignment (physicalInputAlign, inputDirectionStyle, ltrValueInputStyle)", () => {
    const paragraphSide =
      /\b(?:physicalTextAlign|directionStyle|ltrValueStyle)\(|\bREADING_START\b/;
    // A whole token in a style list or spread (not `typography.x.fontSize`).
    const wholeToken = /(?:\[\s*|,\s*|\.\.\.)typography\.\w+\s*(?=[,\]}])/;
    const ownAlignment = /\btextAlign\s*:|\b(?:inputDirectionStyle|ltrValueInputStyle)\(/;
    const offenders: string[] = [];
    for (const { path } of FILES) {
      if (!path.endsWith(".tsx")) {
        continue;
      }
      const source = readFileSync(join(ROOT, path), "utf8");
      if (!/<(?:\w+\.)?TextInput\b/.test(source)) {
        continue;
      }
      const file = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      // A style is often built in a local variable (`inputStyle`,
      // `dirStyle`): follow those, a few levels deep.
      const declarations = new Map<string, string>();
      const collectDeclarations = (node: ts.Node): void => {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.initializer
        ) {
          declarations.set(node.name.text, node.initializer.getText(file));
        }
        ts.forEachChild(node, collectDeclarations);
      };
      collectDeclarations(file);
      const expand = (text: string, depth: number): string => {
        if (depth === 0) {
          return text;
        }
        let expanded = text;
        for (const word of new Set(text.match(/\b[A-Za-z_]\w*\b/g) ?? [])) {
          const initializer = declarations.get(word);
          if (
            initializer !== undefined &&
            !["styles", "colors", "typography", "spacing", "t"].includes(word)
          ) {
            expanded += `\n${expand(initializer, depth - 1)}`;
          }
        }
        return expanded;
      };
      const visit = (node: ts.Node): void => {
        if (
          (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
          /TextInput$/.test(node.tagName.getText(file))
        ) {
          for (const attribute of node.attributes.properties) {
            if (
              !ts.isJsxAttribute(attribute) ||
              attribute.name.getText(file) !== "style" ||
              !attribute.initializer
            ) {
              continue;
            }
            const style = expand(attribute.initializer.getText(file), 3);
            if (
              paragraphSide.test(style) ||
              (wholeToken.test(style) && !ownAlignment.test(style))
            ) {
              const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
              offenders.push(`${path}:${line + 1}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    expect(offenders).toEqual([]);
  });

  it("[regression] a localized date or time is isolated in its own direction (isolateLocalizedTime), never forced left to right", () => {
    // U+2066 (isolateNumeric) lays a date out left to right: a Latin run in a
    // Sorani or Arabic date ("UTC") then lands at the wrong end of it.
    const forced =
      /isolateNumeric\(\s*(?:formatClockTime|formatAbsoluteDual|formatAbsoluteOne|formatDateOnly|[A-Za-z]*(?:Local|TimeText)\b)/g;
    expect(countMatches(forced)).toEqual({});
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
