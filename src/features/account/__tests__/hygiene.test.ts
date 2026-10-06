import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Source hygiene for the account page redesign (spec §10 tests 6 and 10): no
 * hex colours in the new files, no physical left/right style keys (use
 * start/end so RTL mirrors), no camel-case "ShakeMap" for our own products,
 * no casualty wording, no hard-coded strings in JSX text.
 */
const ROOT = join(__dirname, "..", "..", "..", "..");

const NEW_FILES = [
  "app/my-data.tsx",
  "app/my-reports.tsx",
  "src/components/DirectionalChevron.tsx",
  ...listFiles("src/features/badges", [".ts", ".tsx"]).filter(
    (f) => !f.includes("__tests__"),
  ),
  "src/features/account/stats.ts",
  "src/features/account/use-my-summary.ts",
  "src/features/account/use-account-action.ts",
  "src/features/account/components/ProfileHeader.tsx",
  "src/features/account/components/SignUpInvite.tsx",
  "src/features/account/components/StatsStrip.tsx",
  "src/features/account/components/SettingsGroup.tsx",
  "src/features/account/components/SettingsRow.tsx",
  "src/features/account/components/PrivacyRow.tsx",
  "src/features/account/components/MyLocationRow.tsx",
  "src/features/account/components/SignOutRow.tsx",
  "src/features/account/components/DeleteAccountRow.tsx",
  "src/features/building/components/MyHomeCard.tsx",
  "src/features/building/components/HomeCard.tsx",
  "src/features/mydata/components/MyReportsSection.tsx",
  "src/features/mydata/use-my-reports.ts",
  "src/features/eventhub/components/RoleMark.tsx",
];

function listFiles(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) {
      out.push(...listFiles(path, extensions));
    } else if (extensions.some((ext) => name.endsWith(ext))) {
      out.push(path);
    }
  }
  return out;
}

function read(file: string): string {
  return readFileSync(join(ROOT, file), "utf8");
}

describe("account page source hygiene", () => {
  it("lists real files", () => {
    for (const file of NEW_FILES) {
      expect(() => read(file)).not.toThrow();
    }
  });

  it("uses no hex colour literals (theme tokens only)", () => {
    for (const file of NEW_FILES) {
      const hits = read(file).match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g);
      expect({ file, hits }).toEqual({ file, hits: null });
    }
  });

  it("uses start/end, never physical left/right style keys", () => {
    for (const file of NEW_FILES) {
      const hits = read(file).match(
        /\b(left|right|marginLeft|marginRight|paddingLeft|paddingRight|borderLeftWidth|borderRightWidth)\s*:/g,
      );
      expect({ file, hits }).toEqual({ file, hits: null });
    }
  });

  it("never writes the camel-case product name or casualty wording", () => {
    for (const file of NEW_FILES) {
      const source = read(file);
      expect({ file, bad: /ShakeMap/.test(source) }).toEqual({ file, bad: false });
      expect({
        file,
        bad: /casualt|fatalit|death toll|\bkilled\b/i.test(source),
      }).toEqual({
        file,
        bad: false,
      });
    }
    for (const locale of ["en", "ckb", "kmr", "ar"]) {
      const myData = JSON.stringify(
        JSON.parse(read(`src/i18n/locales/${locale}.json`)).myData,
      );
      expect(myData).not.toMatch(/ShakeMap/);
      expect(myData).not.toMatch(/casualt|fatalit|death toll/i);
    }
  });

  it("has no literal text between JSX tags (every string is translated)", () => {
    for (const file of NEW_FILES.filter((f) => f.endsWith(".tsx"))) {
      const hits = read(file).match(/>\s*[A-Za-z؀-ۿ][^<>{}=;]*<\//g);
      expect({ file, hits }).toEqual({ file, hits: null });
    }
  });
});
