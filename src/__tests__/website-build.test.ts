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
import { runInNewContext } from "vm";

import { APP_ORIGIN } from "@/config/urls";
import { buildJoinLink } from "@/features/building/constants";
import { SHARE_EVENT_URL_BASE, SHARE_PROFILE_URL_BASE } from "@/features/share/config";

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

  it("the app has not changed under any website statement (app-facts.lock.json)", () => {
    // website-src/data/app-facts.json lists the statements that rest on the
    // app's labels, behaviour or data. When this fails, the output names each
    // statement to review; after reviewing, refresh with
    //   node scripts/build-website.mjs --refresh-facts
    let output = "";
    let failed = false;
    try {
      output = execFileSync(
        process.execPath,
        ["scripts/build-website.mjs", "--check-facts"],
        {
          cwd: ROOT,
          encoding: "utf8",
          stdio: "pipe",
        },
      );
    } catch (error) {
      failed = true;
      const e = error as { stdout?: string; stderr?: string };
      output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    expect({ failed, output }).toEqual({
      failed: false,
      output: expect.stringContaining("all sources unchanged"),
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

  it("writes the brand as Bumelerze in Arabic and بوومەلەرزە in Sorani (owner decision 2026-10-14)", () => {
    const strings = (lang: string) =>
      JSON.parse(
        fs.readFileSync(
          path.join(ROOT, "website-src", "strings", `${lang}.json`),
          "utf8",
        ),
      ) as Record<string, string>;
    const ar = strings("ar");
    expect(ar.brand).toBe("Bumelerze");
    // ێ (U+06CE) and ە (U+06D5) are Sorani letters, not Arabic: in the
    // Arabic file they can only be the Kurdish word the About intro derives
    // the name from, inside «…». Elsewhere the Latin name sits in a bidi
    // isolate so it reads right inside Arabic text.
    for (const [key, value] of Object.entries(ar)) {
      const text = key === "about.intro" ? value.replace(/«[^»]*»/g, "") : value;
      expect({ key, sorani: text.match(/[ێە]/)?.[0] ?? null }).toEqual({
        key,
        sorani: null,
      });
      if (/Bumelerze/.test(value) && /[؀-ۿ]/.test(value)) {
        expect({ key, isolated: /⁦Bumelerze⁩/.test(value) }).toEqual({
          key,
          isolated: true,
        });
      }
    }
    expect(ar["about.intro"]).toContain('«<span lang="ckb">بوومەلەرزە</span>»');
    for (const [key, value] of Object.entries(strings("ckb"))) {
      expect({ key, short: /بومەلەرزە/.test(value) }).toEqual({ key, short: false });
    }
    // and the rendered Arabic pages: nothing Sorani outside what is marked
    // as Kurdish (the language switcher's own name, the etymology)
    for (const page of PAGES) {
      const html = read(path.join("ar", page)).replace(
        /<(a|span)\b[^>]*\blang="ckb"[^>]*>[\s\S]*?<\/\1>/g,
        "",
      );
      expect({ page, sorani: html.match(/[ێە]/)?.[0] ?? null }).toEqual({
        page,
        sorani: null,
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
    // the shared goals say where early warning stands, and what it is not
    expect(read("how-it-works.html")).toMatch(
      /early warning[^<]*is in testing\. It is not prediction\./i,
    );
    expect(read("index.html")).toMatch(/early warning models in testing/);
  });

  it("how it works explains the method with its own figures, not Home's", () => {
    for (const lang of LANGS) {
      const html = read(
        lang === "en" ? "how-it-works.html" : path.join(lang, "how-it-works.html"),
      );
      for (const fig of ["mfig--data", "mfig--shake", "mfig--damage", "mfig--reports"]) {
        expect(html).toContain(fig);
      }
      expect(html).toContain('class="flow"');
      // no shakemap image, felt pictures, building pictograms or app screenshot
      expect(html).not.toMatch(/img\/(shakemap-|felt\/|screens\/)/);
      expect(html).not.toContain("vc-tiles");
      expect(html).not.toContain('id="community"');
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

/** Runs website-src/redirects.js, or a forwarding page's inline script, in a
 * sandbox with a fake browser location. */
function loadMapping(): (
  pathname: string,
  search?: string,
  hash?: string,
) => string | null {
  const source = fs.readFileSync(path.join(ROOT, "website-src", "redirects.js"), "utf8");
  const sandbox: Record<string, unknown> = {};
  runInNewContext(source, sandbox);
  return sandbox.appRedirect as (p: string, s?: string, h?: string) => string | null;
}

/** The page's inline script against a fake browser: where it forwards (null
 * when it stays), the class it gives <html>, and where the visible "open in
 * the app" links point once the DOM is ready. */
function forwardPage(rel: string, url: string) {
  const html = read(rel);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  const u = new URL(url);
  let replaced: string | null = null;
  const ready: (() => void)[] = [];
  const links = [...html.matchAll(/<a data-app-link href="([^"]+)"/g)].map((m) => ({
    href: m[1]!,
  }));
  const sandbox = {
    location: {
      pathname: u.pathname,
      search: u.search,
      hash: u.hash,
      replace: (to: string) => {
        replaced = to;
      },
    },
    document: {
      documentElement: { className: "" },
      title: "",
      addEventListener: (_: string, fn: () => void) => ready.push(fn),
      querySelectorAll: () => links,
    },
  };
  runInNewContext(script, sandbox);
  for (const fn of ready) fn();
  return {
    replaced: replaced as string | null,
    className: sandbox.document.documentElement.className,
    title: sandbox.document.title,
    links: links.map((l) => l.href),
  };
}

function runForwardPage(rel: string, url: string): string | null {
  return forwardPage(rel, url).replaced;
}

describe("forwards from bumelerze.com to app.bumelerze.com", () => {
  const appRedirect = loadMapping();
  const APP = "https://app.bumelerze.com";

  it.each([
    ["/app", "", "", `${APP}/`],
    ["/app/", "", "", `${APP}/`],
    ["/app/index.html", "", "", `${APP}/`],
    ["/app/event/bml20170001", "", "", `${APP}/event/bml20170001`],
    ["/app/map", "?lat=35.5&lon=45.4", "#layers", `${APP}/map?lat=35.5&lon=45.4#layers`],
    ["/app/u/dilan.k", "", "#top", `${APP}/u/dilan.k#top`],
    [
      "/app/home/join",
      "?code=BMH-7K3Q9P&key=ABCD2345",
      "",
      `${APP}/home/join?code=BMH-7K3Q9P&key=ABCD2345`,
    ],
    [
      "/app/account/sign-in",
      "?next=%2Fevent%2Fx",
      "",
      `${APP}/account/sign-in?next=%2Fevent%2Fx`,
    ],
    ["/e/bml20170001", "", "", `${APP}/event/bml20170001`],
    ["/e/bml20170001/", "?ref=qr", "#felt", `${APP}/event/bml20170001?ref=qr#felt`],
    ["/u/a%20b", "", "", `${APP}/u/a%20b`],
    [
      "/join",
      "?code=BMH-7K3Q9P&key=ABCD2345",
      "",
      `${APP}/home/join?code=BMH-7K3Q9P&key=ABCD2345`,
    ],
    [
      "/join/",
      "?code=BMH-7K3Q9P&key=ABCD2345",
      "#x",
      `${APP}/home/join?code=BMH-7K3Q9P&key=ABCD2345#x`,
    ],
  ])("%s%s%s -> %s", (pathname, search, hash, expected) => {
    expect(appRedirect(pathname, search, hash)).toBe(expected);
  });

  it.each([
    "/",
    "/apple",
    "/application/x",
    "/e",
    "/e/",
    "/e/a/b",
    "/u/",
    "/joint",
    "/about.html",
    "/ckb/missing",
  ])("leaves %s alone (not ours to forward)", (pathname) => {
    expect(appRedirect(pathname, "?q=1", "#h")).toBeNull();
  });

  it("the links the app shares land on the right app pages", () => {
    const via = (link: string) => {
      const u = new URL(link);
      expect(u.origin).toBe("https://bumelerze.com");
      return appRedirect(u.pathname, u.search, u.hash);
    };
    expect(APP_ORIGIN).toBe(APP);
    expect(via(`${SHARE_EVENT_URL_BASE}/bml20170001`)).toBe(`${APP}/event/bml20170001`);
    expect(via(`${SHARE_PROFILE_URL_BASE}/dilan.k`)).toBe(`${APP}/u/dilan.k`);
    expect(via(buildJoinLink("BMH-7K3Q9P", "ABCD2345"))).toBe(
      `${APP}/home/join?code=BMH-7K3Q9P&key=ABCD2345`,
    );
  });

  it("bumelerze.com/app forwards every path, query and hash to the same place on the app", () => {
    expect(runForwardPage("app/index.html", "https://bumelerze.com/app/")).toBe(
      `${APP}/`,
    );
    expect(runForwardPage("app/index.html", "https://bumelerze.com/app/?x=1#y")).toBe(
      `${APP}/?x=1#y`,
    );
    // deeper paths are not files on the site, so Pages serves 404.html
    expect(
      runForwardPage("404.html", "https://bumelerze.com/app/event/bml20170001?a=1#b"),
    ).toBe(`${APP}/event/bml20170001?a=1#b`);
    expect(runForwardPage("404.html", "https://bumelerze.com/e/bml20170001")).toBe(
      `${APP}/event/bml20170001`,
    );
    expect(
      runForwardPage(
        "404.html",
        "https://bumelerze.com/join?code=BMH-7K3Q9P&key=ABCD2345",
      ),
    ).toBe(`${APP}/home/join?code=BMH-7K3Q9P&key=ABCD2345`);
    // anything else stays on the "page not found" page
    expect(runForwardPage("404.html", "https://bumelerze.com/nothing-here")).toBeNull();
    expect(read("404.html")).toContain("Page not found");
    expect(read("404.html")).toContain('href="https://bumelerze.com/"');
  });

  it("a shared short link previews as Bumelerze and opens in the app without script", () => {
    // Link-preview bots and other clients that run no script see the page
    // as served: it must carry the brand's preview tags, never "Page not
    // found" as its title, and a visible way into the app in every language.
    for (const rel of ["404.html", "app/index.html"]) {
      const html = read(rel);
      const head = html.split("<body>")[0]!;
      expect(head).toMatch(/<title>Bumelerze: [^<]+<\/title>/);
      expect(head).not.toMatch(/<(title|meta)[^>]*Page not found/);
      for (const tag of [
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="Bumelerze">',
        '<meta property="og:title" content="Bumelerze: ',
        '<meta property="og:description" content="',
        '<meta property="og:image" content="https://bumelerze.com/og-image.jpg">',
        '<meta name="twitter:card" content="summary_large_image">',
        '<meta name="twitter:image" content="https://bumelerze.com/og-image.jpg">',
      ]) {
        expect(head).toContain(tag);
      }
      expect(fs.existsSync(path.join(SITE, "og-image.jpg"))).toBe(true);
      // one "open this in the app" line per language, each in its own
      // language and direction, all pointing at the app without script
      for (const [lang, dir] of [
        ["en", "ltr"],
        ["ckb", "rtl"],
        ["kmr", "ltr"],
        ["ar", "rtl"],
      ]) {
        expect(html).toContain(
          `<li lang="${lang}" dir="${dir}"><a data-app-link href="https://app.bumelerze.com/">`,
        );
      }
    }
    // the 404 page is never indexed, and a genuinely wrong URL still reads
    // as a missing page once the script has run
    expect(read("404.html")).toContain('<meta name="robots" content="noindex">');
    const missing = forwardPage("404.html", "https://bumelerze.com/nothing-here");
    expect(missing).toMatchObject({
      replaced: null,
      className: "missing",
      title: "Page not found · Bumelerze",
    });
    // with script, the visible links point at the exact target too (in case
    // the forward is slow or blocked)
    const shared = forwardPage("404.html", "https://bumelerze.com/e/bml20170001?ref=qr");
    expect(shared.replaced).toBe(`${APP}/event/bml20170001?ref=qr`);
    expect(shared.className).toBe("forwarding");
    expect(shared.links).toEqual(Array(4).fill(`${APP}/event/bml20170001?ref=qr`));
    const moved = forwardPage("app/index.html", "https://bumelerze.com/app/");
    expect(moved.links).toEqual(Array(4).fill(`${APP}/`));
  });

  it("bumelerze.com no longer hosts the app: only the forwarding page under /app, no app build in the deploy", () => {
    // the site build puts exactly one file under app/: the forwarding page
    expect(fs.readdirSync(path.join(SITE, "app"))).toEqual(["index.html"]);
    const stub = read("app/index.html");
    expect(stub).not.toMatch(/<script[^>]+src=/);
    expect(stub).not.toMatch(/_expo|bundle|entry-/);
    expect(stub).toContain("location.replace");
    // the Pages workflow publishes website/ as-is and exports no app
    const workflow = fs.readFileSync(
      path.join(ROOT, ".github", "workflows", "deploy-pages.yml"),
      "utf8",
    );
    const steps = workflow.split("\njobs:")[1]!;
    expect(steps).not.toMatch(
      /expo export|BUMELERZE_WEB_BASE_URL|pages-dist\/app|npm ci/,
    );
    expect(steps).toContain("cp -r website/. pages-dist/");
    // and the site's own links point at the app's new address
    for (const rel of pageFiles()) {
      expect(read(rel)).not.toMatch(/bumelerze\.com\/app\b/);
    }
  });
});
