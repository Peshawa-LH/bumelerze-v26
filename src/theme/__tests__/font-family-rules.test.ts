import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import ts from "typescript";

import { Platform } from "react-native";

import { arabicScriptFontFor, nativeFontFamily, typography } from "../typography";

/**
 * Sorani and Arabic draw in Vazirmatn on iOS and Android only where a style
 * names the family (item 44 of the iOS parity inventory): the system face
 * lacks the Kurdish letter forms (ە ڵ ێ ۆ ڕ) and swaps them in mid-word.
 * The web draws every right-to-left page in Vazirmatn through one document
 * rule, so a style that copies a token's size without its family looked
 * right in a browser and wrong on a phone. This scan makes such a style
 * fail: every style object whose `fontSize` comes from a type token
 * (`typography.bodyMeta.fontSize`, `titleToken.fontSize`) also states a
 * `fontFamily` (`nativeFontFamily(...)`), or spreads one.
 */

const ROOT = join(__dirname, "..", "..", "..");

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

/** Files the notifications batch owns: it runs in parallel with this rule's
 * sweep, and a short follow-up sweep adds their families after it merges
 * (whole files, so that batch's own edits cannot make this test fail on a
 * count). The list may only shrink. */
const PENDING_NOTIFICATIONS_BATCH = [
  "app/(tabs)/(home,map,sensor,profile,settings)/notification-settings.tsx",
  "src/features/alerts/components/AlertsAdminContent.tsx",
  "src/features/alerts/components/AlertsComingSoonNote.tsx",
  "src/features/alerts/components/AlertsPreferenceNotes.tsx",
  "src/features/alerts/components/AlertsTesterPanel.tsx",
  "src/features/notifications/components/PermissionDeniedRow.tsx",
  "src/features/notifications/components/RehearsalAlertModal.tsx",
  "src/features/notifications/components/TierSelector.tsx",
];

function stylesWithoutFamily(): Record<string, number> {
  const counts: Record<string, number> = {};
  const files = ["app", "src"].flatMap((dir) => collect(join(ROOT, dir)));
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("fontSize")) {
      continue;
    }
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const named = (name: string) =>
          node.properties.find(
            (property) =>
              (ts.isPropertyAssignment(property) ||
                ts.isShorthandPropertyAssignment(property)) &&
              property.name.getText(sourceFile) === name,
          );
        const fontSize = named("fontSize");
        const fromToken =
          fontSize !== undefined &&
          ts.isPropertyAssignment(fontSize) &&
          /\.fontSize\b/.test(fontSize.initializer.getText(sourceFile));
        const spreadsFamily = node.properties.some(
          (property) =>
            ts.isSpreadAssignment(property) &&
            /fontFamily|^typography\.\w+$/.test(property.expression.getText(sourceFile)),
        );
        if (fromToken && named("fontFamily") === undefined && !spreadsFamily) {
          const path = relative(ROOT, file);
          counts[path] = (counts[path] ?? 0) + 1;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return counts;
}

describe("font family rules", () => {
  it("[regression] every fontSize taken from a type token names its font family (Vazirmatn on iOS/Android)", () => {
    const missing = stylesWithoutFamily();
    for (const path of PENDING_NOTIFICATIONS_BATCH) {
      delete missing[path];
    }
    expect(missing).toEqual({});
  });
});

describe("nativeFontFamily", () => {
  it("names the Vazirmatn face of the token's weight on iOS", () => {
    expect(Platform.OS).toBe("ios");
    const arabic = typography(true);
    expect(nativeFontFamily(arabic.h1)).toBe(arabicScriptFontFor("700"));
    expect(nativeFontFamily(arabic.bodyMeta)).toBe(arabicScriptFontFor("400"));
  });

  it("matches the weight the text is drawn in", () => {
    const arabic = typography(true);
    expect(nativeFontFamily(arabic.bodyMeta, "700")).toBe("Vazirmatn-Bold");
    expect(nativeFontFamily(arabic.bodyMeta, "bold")).toBe("Vazirmatn-Bold");
    expect(nativeFontFamily(arabic.h3, "400")).toBe("Vazirmatn-Regular");
    expect(nativeFontFamily(arabic.h3, "normal")).toBe("Vazirmatn-Regular");
    expect(nativeFontFamily(arabic.bodyDefault, "600")).toBe("Vazirmatn-SemiBold");
    expect(nativeFontFamily(arabic.bodyDefault, 500)).toBe("Vazirmatn-Medium");
    expect(nativeFontFamily(arabic.bodyDefault, "800")).toBe("Vazirmatn-Bold");
  });

  it("is undefined for Latin-script languages and while the faces load", () => {
    expect(nativeFontFamily(typography(false).h1)).toBeUndefined();
    expect(nativeFontFamily(typography(true, false).h1, "700")).toBeUndefined();
  });

  it("is undefined on the web, which draws right-to-left pages in Vazirmatn by CSS", () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require with a web platform
      const rn = require("react-native") as typeof import("react-native");
      const original = rn.Platform.OS;
      rn.Platform.OS = "web";
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require with a web platform
        const web = require("../typography") as typeof import("../typography");
        expect(web.nativeFontFamily(web.typography(true).h1)).toBeUndefined();
      } finally {
        rn.Platform.OS = original;
      }
    });
  });
});
