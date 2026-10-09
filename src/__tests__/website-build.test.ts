/**
 * The website (website/**.html) is generated from website-src/ by
 * scripts/build-website.mjs and the output is committed, because the deploy
 * workflow publishes website/ as-is. These tests fail when the committed
 * pages no longer match a fresh render (run `npm run build:site`), and guard
 * the few things a page must never ship with.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
const SITE = path.join(ROOT, "website");
const LANGS = ["en", "ckb", "kmr", "ar"];
const PAGES = [
  "index.html",
  "about.html",
  "handbook.html",
  "support.html",
  "privacy.html",
];

function pageFiles(): string[] {
  return LANGS.flatMap((lang) =>
    PAGES.map((page) => (lang === "en" ? page : path.join(lang, page))),
  );
}

function read(rel: string): string {
  return fs.readFileSync(path.join(SITE, rel), "utf8");
}

describe("website build", () => {
  it("committed website/ matches a fresh render of website-src/", () => {
    let output = "";
    let failed = false;
    try {
      output = execFileSync(process.execPath, ["scripts/build-website.mjs", "--check"], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (error) {
      failed = true;
      const e = error as { stdout?: string; stderr?: string };
      output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    expect({ failed, output }).toEqual({
      failed: false,
      output: expect.stringContaining("up to date"),
    });
  });

  it("renders every page in every language", () => {
    for (const rel of pageFiles()) {
      expect(fs.existsSync(path.join(SITE, rel))).toBe(true);
    }
  });

  it("marks every ckb/kmr/ar page as an unreviewed machine draft", () => {
    for (const rel of pageFiles().filter((f) => f.includes(path.sep))) {
      expect(read(rel)).toContain(
        "<!-- translation: draft-machine, pending native review -->",
      );
    }
  });

  it("sets lang and direction per language", () => {
    expect(read("index.html")).toContain('<html lang="en" dir="ltr">');
    expect(read("ckb/index.html")).toContain('<html lang="ckb" dir="rtl">');
    expect(read("kmr/index.html")).toContain('<html lang="kmr" dir="ltr">');
    expect(read("ar/index.html")).toContain('<html lang="ar" dir="rtl">');
  });

  it("never makes a claim the project must not make", () => {
    const forbidden = [
      /EMS-98/,
      /ShakeMap/, // camel case is USGS's own system; ours is SHAKEmap(s)
      /Shake Service/i,
      /real-time/i,
      /early warning/i,
      /\bAtlas\b/,
    ];
    for (const rel of pageFiles()) {
      const html = read(rel);
      for (const pattern of forbidden) {
        expect({ rel, match: html.match(pattern)?.[0] ?? null }).toEqual({
          rel,
          match: null,
        });
      }
    }
  });

  it("only shows felt cartoons 1-6 and never a safety-dont image", () => {
    for (const rel of pageFiles()) {
      const html = read(rel);
      expect(html).not.toMatch(/level-(0[7-9]|1[0-2])\./);
      expect(html).not.toMatch(/safety-dont-/);
      expect(html).not.toMatch(/screens\/felt-/);
    }
  });

  it("every local file a page references exists", () => {
    const missing: string[] = [];
    for (const rel of pageFiles()) {
      const html = read(rel);
      const dir = path.dirname(path.join(SITE, rel));
      const refs = [...html.matchAll(/(?:src|href|srcset)="([^"]+)"/g)].flatMap((m) =>
        m[1]!.split(",").map((part) => part.trim().split(/\s+/)[0]!),
      );
      for (const ref of refs) {
        if (/^(https?:|mailto:|#|data:)/.test(ref) || ref === "") continue;
        const file = path.resolve(dir, ref.split(/[?#]/)[0]!);
        if (!fs.existsSync(file)) missing.push(`${rel} -> ${ref}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("loads nothing from third-party hosts except the two quake feeds", () => {
    const js = fs.readFileSync(path.join(SITE, "site.js"), "utf8");
    const hosts = [...js.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]);
    expect(new Set(hosts)).toEqual(
      new Set(["earthquake.usgs.gov", "www.seismicportal.eu"]),
    );
    for (const rel of pageFiles()) {
      expect(read(rel)).not.toMatch(/<script[^>]+src="https?:/);
    }
  });
});
