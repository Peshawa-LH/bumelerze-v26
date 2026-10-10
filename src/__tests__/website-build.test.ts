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
  "how-it-works.html",
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
      /(?<!How )did you feel it/i, // the feature is "share your experience"; "How did you feel it?" is the app's picker title
      /\btestimony\b/i,
      // No source-code links or licence claims: the code is not published.
      /github\.com\/Peshawa-LH/i,
      /Apache/i,
      /open[- ]source/i,
      /source (code|repository)/i,
    ];
    for (const rel of pageFiles()) {
      // Early warning may be named only as a future aim, inside the
      // sections marked data-aim (home "future", How it works "next").
      const html = read(rel).replace(
        /<section[^>]*\bdata-aim\b[^>]*>[\s\S]*?<\/section>/g,
        "",
      );
      for (const pattern of forbidden) {
        expect({ rel, match: html.match(pattern)?.[0] ?? null }).toEqual({
          rel,
          match: null,
        });
      }
    }
  });

  it("never calls the app free, in any language (owner decision 2026-10-10)", () => {
    // en "free", ckb "(بە)خۆڕایی", kmr "belaş", ar "مجان(ي/ًا)".
    const free = /\bfree\b|خۆڕایی|belaş|مجان/i;
    for (const rel of pageFiles()) {
      expect({ rel, match: read(rel).match(free)?.[0] ?? null }).toEqual({
        rel,
        match: null,
      });
    }
  });

  it("names early warning only as an aim, never as available", () => {
    const aims = [read("index.html"), read("how-it-works.html")]
      .flatMap(
        (html) => html.match(/<section[^>]*\bdata-aim\b[^>]*>[\s\S]*?<\/section>/g) ?? [],
      )
      .join("\n");
    expect(aims).toMatch(/early warning/i);
    // the shared goals list says where early warning stands
    expect(read("how-it-works.html")).toMatch(/early warning is not available today/);
    for (const rel of ["index.html", "how-it-works.html", "about.html"]) {
      expect(read(rel)).toMatch(/class="status status--testing">In testing</);
    }
  });

  it("support: seven anchored groups, every question an accordion with its own anchor", () => {
    const groups = ["start", "quakes", "share", "family", "account", "alerts", "contact"];
    for (const lang of LANGS) {
      const html = read(lang === "en" ? "support.html" : path.join(lang, "support.html"));
      for (const g of groups) expect(html).toContain(`id="${g}"`);
      const ids = [...html.matchAll(/<details class="faq-item" id="([a-z]+-q\d+)"/g)].map(
        (m) => m[1],
      );
      expect(ids).toHaveLength(37);
      expect(new Set(ids).size).toBe(37);
      // numbered steps become lists; contact addresses become mailto links
      expect((html.match(/<ol class="steps">/g) ?? []).length).toBe(6);
      expect(html).toContain('href="mailto:dev@bumelerze.com"');
      expect(html).toContain('href="mailto:hello@bumelerze.com"');
      expect(html).toContain('href="how-it-works.html"');
      expect(html).toContain('href="privacy.html"');
      expect(html).toContain('href="about.html#official"');
      // search box stays hidden until site.js shows it
      expect(html).toMatch(/data-faq-search-wrap hidden/);
    }
  });

  it("social accounts from social.json show as icon links on About and in every footer", () => {
    const social = JSON.parse(
      fs.readFileSync(path.join(ROOT, "website-src", "data", "social.json"), "utf8"),
    ) as { platform: string; url: string }[];
    for (const rel of pageFiles()) {
      const html = read(rel);
      if (rel.endsWith("about.html")) expect(html).toContain('id="official"');
      if (social.length === 0) {
        expect(html).not.toContain('class="social-link"');
        continue;
      }
      for (const s of social) {
        // icons only: the address is never printed as visible text
        expect(html).toContain(
          `href="${s.url}" rel="me noopener noreferrer" target="_blank"`,
        );
        expect(html).not.toContain(`>${s.url}<`);
        expect(s.url).not.toMatch(/[?&](s|utm_[a-z]+)=/);
      }
    }
  });

  it("writes intensity in Roman numerals for en/kmr and Eastern digits for ckb/ar", () => {
    const legend = (rel: string) =>
      read(rel).match(/class="intensity-legend"[^>]*>([\s\S]*?)<\/ol>/)![1]!;
    expect(legend("index.html")).toContain(">VIII<");
    expect(legend("kmr/index.html")).toContain(">VIII<");
    expect(legend("ckb/index.html")).toContain(">٨<");
    expect(legend("ar/index.html")).toContain(">٨<");
    expect(legend("ckb/index.html")).not.toMatch(/[IVX]/);
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
