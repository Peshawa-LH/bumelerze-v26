#!/usr/bin/env node
// Renders the static website (website/**.html) from website-src/: one set of
// templates, four strings files (en, ckb, kmr, ar). No dependencies.
//
//   node scripts/build-website.mjs           write website/*.html, sitemap
//   node scripts/build-website.mjs --check   exit 1 if the committed output
//                                            differs from a fresh render
//   node scripts/build-website.mjs --sync-app-data
//                                            refresh website-src/data/places.json
//                                            from the app's gazetteer, then build
//
// Template syntax (see website-src/README.md):
//   {{key}}    string from strings/<lang>.json, inserted as-is (may hold
//              inline markup such as <bdi>)
//   {{=key}}   the same string, tags stripped and escaped for an attribute
//   {{@var}}   a per-page variable computed here (root, lang, dir, ...)
//   {{>name}}  a partial (website-src/partials/<name>.html) or a component
//              function defined below
// A key that is missing in any language is a build error, so no page can
// ship with an English hole in it.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "website-src");
const OUT = path.join(ROOT, "website");
const SITE_URL = "https://bumelerze.com/";
const APP_URL = "https://bumelerze.com/app/";

export const LANGS = [
  { code: "en", dir: "ltr", name: "English", og: "en_GB", digits: "latin" },
  { code: "ckb", dir: "rtl", name: "کوردیی ناوەندی", og: "ckb_IQ", digits: "arab" },
  { code: "kmr", dir: "ltr", name: "Kurmancî", og: "ku_IQ", digits: "latin" },
  { code: "ar", dir: "rtl", name: "العربية", og: "ar_IQ", digits: "arab" },
];

export const PAGES = [
  { id: "index", file: "index.html", nav: "home", kind: "template" },
  {
    id: "hiw",
    file: "how-it-works.html",
    nav: "how",
    kind: "template",
    template: "how-it-works",
  },
  { id: "handbook", file: "handbook.html", nav: "handbook", kind: "fragment" },
  { id: "about", file: "about.html", nav: "about", kind: "template" },
  {
    id: "support",
    file: "support.html",
    nav: "support",
    kind: "fragment",
    mainClass: "wrap",
    bodyClass: "prose-page",
  },
  {
    id: "privacy",
    file: "privacy.html",
    nav: null,
    kind: "fragment",
    mainClass: "wrap",
    bodyClass: "prose-page",
  },
];

const NAV = [
  { id: "home", file: "index.html", key: "nav.home" },
  { id: "how", file: "how-it-works.html", key: "nav.how_it_works" },
  { id: "handbook", file: "handbook.html", key: "nav.handbook" },
  { id: "about", file: "about.html", key: "nav.about" },
  { id: "support", file: "support.html", key: "nav.support" },
];

const read = (p) => fs.readFileSync(p, "utf8");

function loadStrings() {
  const strings = {};
  for (const { code } of LANGS) {
    strings[code] = JSON.parse(read(path.join(SRC, "strings", `${code}.json`)));
  }
  // Every language must carry exactly the English key set.
  const enKeys = Object.keys(strings.en).filter((k) => !k.startsWith("_"));
  for (const { code } of LANGS) {
    const missing = enKeys.filter((k) => !(k in strings[code]));
    if (missing.length)
      throw new Error(`strings/${code}.json is missing: ${missing.join(", ")}`);
  }
  return strings;
}

const escapeAttr = (s) =>
  String(s)
    .replace(/<[^>]*>/g, "")
    .replace(/&(?![a-z]+;|#\d+;)/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const hash = (file) =>
  crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(OUT, file)))
    .digest("hex")
    .slice(0, 10);

/** URL path of a page in a language, relative to the site root. */
function pagePath(lang, file) {
  const dir = lang === "en" ? "" : `${lang}/`;
  return file === "index.html" ? dir : dir + file;
}

// ---------------------------------------------------------------- components
// Repeating or computed markup lives here instead of in the templates.

/** Intensity numerals, the app's rule (src/features/shakemap/intensity-format.ts):
 * Roman in English and Kurmanji, Eastern Arabic digits in Sorani and Arabic. */
const ROMAN = [
  "",
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
];
function intensity(ctx, level) {
  return ctx.langInfo.digits === "arab" ? ctx.num(level) : ROMAN[level];
}

const svgCache = {};
function svgPartial(name) {
  svgCache[name] ??= read(path.join(SRC, "partials", "svg", name)).trim();
  return svgCache[name];
}

/** Hazard-zone map: the exact SVG from the handbook page, so the home
 * page's small copy can never drift from it. */
function hazardMap(ctx) {
  const handbook = read(path.join(SRC, "pages", "handbook", `${ctx.lang}.html`));
  const match = handbook.match(/<svg viewBox="0 0 300 360"[\s\S]*?<\/svg>/);
  if (!match) throw new Error("handbook hazard map SVG not found");
  return match[0];
}

function pictogram(name) {
  return read(path.join(ROOT, "assets", "artwork", "building", `${name}.svg`))
    .trim()
    .replace(/ width="64" height="64"/, "")
    .replace("<svg ", '<svg aria-hidden="true" focusable="false" ');
}

const COMPONENTS = {
  seismicLine: () =>
    svgPartial("seismic-line.svg")
      .replace("<svg ", '<svg class="seismic-line" ')
      .replace(
        'preserveAspectRatio="xMidYMid meet"',
        'preserveAspectRatio="xMidYMid slice"',
      )
      .replace(/<path d=/g, '<path pathLength="1" d='),
  skyline: () => svgPartial("skyline.svg").replace("<svg ", '<svg class="skyline" '),
  hazardMap,
  actNum: (ctx, [n]) => ctx.num(n),
  navLinks(ctx) {
    return NAV.map(
      (n) =>
        `<a href="${n.file}"${ctx.page.nav === n.id ? ' aria-current="page"' : ""}>${ctx.t(n.key)}</a>`,
    ).join("\n        ");
  },
  langLinks(ctx) {
    return LANGS.filter((l) => l.code !== ctx.lang)
      .map((l) => {
        const href = ctx.root + (l.code === "en" ? "" : `${l.code}/`) + ctx.page.file;
        return `<a href="${href}" lang="${l.code}" dir="${l.dir}" hreflang="${l.code}">${l.name}</a>`;
      })
      .join("\n          ");
  },
  hreflang(ctx) {
    const links = LANGS.map(
      (l) =>
        `<link rel="alternate" hreflang="${l.code}" href="${SITE_URL}${pagePath(l.code, ctx.page.file)}">`,
    );
    links.push(
      `<link rel="alternate" hreflang="x-default" href="${SITE_URL}${pagePath("en", ctx.page.file)}">`,
    );
    return links.join("\n");
  },
  ogLocaleAlternates(ctx) {
    return LANGS.filter((l) => l.code !== ctx.lang)
      .map((l) => `<meta property="og:locale:alternate" content="${l.og}">`)
      .join("\n");
  },
  feltStrip(ctx) {
    return ["01", "02", "03", "04", "05", "06"]
      .map((lvl, i) => {
        const n = i + 1;
        return `<li><button type="button" class="felt-btn" aria-pressed="false" data-level="${n}">
            <img src="${ctx.root}img/felt/level-${lvl}.webp" width="240" height="240" loading="lazy" decoding="async" alt="">
            <span class="felt-num" aria-hidden="true">${intensity(ctx, n)}</span>
            <span class="felt-label">${ctx.t(`felt.level${n}`)}</span>
          </button></li>`;
      })
      .join("\n          ");
  },
  safetyGrid(ctx) {
    const items = [
      ["safety-secure-water-tank", "safety.alt_tank"],
      ["safety-secure-gas-cylinder", "safety.alt_gas"],
      ["safety-cover-head-neck", "safety.alt_cover"],
      ["safety-drop-cover-hold", "safety.alt_drop"],
      ["safety-emergency-kit", "safety.alt_kit"],
      ["safety-family-plan", "safety.alt_plan"],
    ];
    return items
      .map(
        ([file, key]) =>
          `<li><img src="${ctx.root}img/safety/${file}.webp" width="320" height="320" loading="lazy" decoding="async" alt="${escapeAttr(ctx.t(key))}"></li>`,
      )
      .join("\n          ");
  },
  buildingTiles(ctx) {
    return [
      ["structure-frame", "building.frame"],
      ["structure-brick-walls", "building.brick"],
      ["structure-stone-walls", "building.stone"],
      ["structure-mud-walls", "building.mud"],
    ]
      .map(([file, key]) => `<li>${pictogram(file)}<span>${ctx.t(key)}</span></li>`)
      .join("\n            ");
  },
  intensityLegend(ctx) {
    // Colours: the app's intensityRamp (src/theme/palette.ts), levels IV-VIII
    // as shown on this map (shakemap-meta.json levels_shown). Numerals follow
    // the app's intensity rule (see `intensity` above).
    const ramp = { 4: "#A1D7E3", 5: "#8FC891", 6: "#F9EC33", 7: "#EEB509", 8: "#E9872D" };
    return Object.entries(ramp)
      .map(([lvl, c]) => `<li style="--swatch:${c}">${intensity(ctx, Number(lvl))}</li>`)
      .join("");
  },

  vcBar(ctx) {
    return `<div class="vc" dir="ltr">
          <img src="${ctx.root}img/vc-bar.svg" width="630" height="72" loading="lazy" decoding="async" alt="${escapeAttr(ctx.t("building.alt_vc"))}">
          <div class="vc-ends"><span dir="auto">A · ${ctx.t("building.vc_a")}</span><span dir="auto">F · ${ctx.t("building.vc_f")}</span></div>
        </div>`;
  },
  catalogMap(ctx) {
    const r = ctx.root;
    const sizes = "(min-width: 52rem) 36rem, 92vw";
    return `<picture>
            <source media="(prefers-color-scheme: dark)" srcset="${r}img/catalog-map-dark.webp 1600w, ${r}img/catalog-map-dark@2x.webp 3200w" sizes="${sizes}">
            <img src="${r}img/catalog-map-light.webp" srcset="${r}img/catalog-map-light.webp 1600w, ${r}img/catalog-map-light@2x.webp 3200w" sizes="${sizes}" width="1600" height="1100" loading="lazy" decoding="async" alt="${escapeAttr(ctx.t("catalog.alt"))}">
          </picture>`;
  },
  shakeFigure(ctx) {
    const r = ctx.root;
    return `<figure class="feature-fig map-fig">
        <div class="map-frame">
          <picture>
            <source media="(prefers-color-scheme: dark)" srcset="${r}img/shakemap-dark.webp">
            <img src="${r}img/shakemap-light.webp" width="1000" height="714" loading="lazy" decoding="async" alt="${escapeAttr(ctx.t("shake.alt"))}">
          </picture>
          <span class="status-chip">${ctx.t("shake.chip")}</span>
        </div>
        <figcaption>
          <span class="cap-event">${ctx.t("shake.caption")}</span>
          <span class="legend"><span class="legend-label">${ctx.t("shake.legend")}</span><ol class="intensity-legend" dir="ltr">${COMPONENTS.intensityLegend(ctx)}</ol></span>
        </figcaption>
      </figure>`;
  },
  feltMini(ctx) {
    return ["01", "02", "03", "04", "05", "06"]
      .map((lvl, i) => {
        const n = i + 1;
        return `<li><img src="${ctx.root}img/felt/level-${lvl}.webp" width="240" height="240" loading="lazy" decoding="async" alt=""><span class="felt-num" aria-hidden="true">${intensity(ctx, n)}</span><span class="felt-label">${ctx.t(`felt.level${n}`)}</span></li>`;
      })
      .join("\n          ");
  },
  flowDiagram(ctx) {
    // Networks -> merged feed -> SHAKEmap -> damage estimate, with felt
    // reports feeding the SHAKEmap. Labels are HTML (translated); the
    // drawing is a few line icons. Arrows follow the reading direction.
    const node = (cls, icon, label, sub = "") =>
      `<li class="flow-node ${cls}"><span class="flow-icon" aria-hidden="true">${FLOW_ICONS[icon]}</span><span class="flow-label">${label}</span>${sub}</li>`;
    return `<figure class="flow">
        <figcaption class="visually-hidden">${ctx.t("hiw.flow.caption")}</figcaption>
        <ol class="flow-steps">
          ${node("flow-networks", "networks", ctx.t("hiw.flow.networks"), '<span class="flow-sub" dir="ltr">USGS · EMSC · GEOFON</span>')}
          ${node("flow-feed", "feed", ctx.t("hiw.flow.feed"))}
          ${node("flow-shake", "shake", ctx.t("hiw.flow.shakemap"))}
          ${node("flow-damage", "damage", ctx.t("hiw.flow.damage"))}
          ${node("flow-reports", "reports", ctx.t("hiw.flow.reports"))}
        </ol>
      </figure>`;
  },
  phone(ctx, args) {
    // {{>phone home alt_key}} or {{>phone home alt_key dark}}: a CSS device
    // frame around a language-matched app screenshot (website/img/screens).
    const [screen, altKey, dark] = args;
    const src = `${ctx.root}img/screens/${screen}-${ctx.lang}.webp`;
    const darkSrc = dark
      ? `<source media="(prefers-color-scheme: dark)" srcset="${ctx.root}img/screens/${screen}-dark-${ctx.lang}.webp">`
      : "";
    return `<div class="phone"><picture>${darkSrc}<img src="${src}" width="540" height="1169" loading="lazy" decoding="async" alt="${escapeAttr(ctx.t(altKey))}"></picture></div>`;
  },
  channels(ctx) {
    const items = [
      ["about.channel_website", "https://bumelerze.com/", "globe"],
      ["about.channel_app", APP_URL, "phone"],
      ["about.channel_email_general", "mailto:hello@bumelerze.com", "mail"],
      ["about.channel_email_data", "mailto:dev@bumelerze.com", "mail"],
      ["about.channel_code", "https://github.com/Peshawa-LH/bumelerze-v26", "code"],
    ];
    return items
      .map(([key, href, icon]) => {
        // "Label: value" -> label + a link on the value. The colon is the
        // last ": " so labels may contain colons of their own.
        const full = ctx.t(key);
        const at = full.lastIndexOf(": ");
        const label = at === -1 ? "" : full.slice(0, at);
        const value = at === -1 ? full : full.slice(at + 2);
        return `<li><span class="ch-icon" aria-hidden="true">${ICONS[icon]}</span><span class="ch-label">${label}</span><a href="${href}" dir="ltr"><bdi>${value}</bdi></a></li>`;
      })
      .join("\n          ");
  },
  liveData(ctx) {
    // Everything the live card needs to name and date an event in the page
    // language, embedded so site.js stays language-agnostic.
    const places = JSON.parse(read(path.join(SRC, "data", "places.json")));
    const data = {
      lang: ctx.lang,
      digits: ctx.langInfo.digits,
      app: APP_URL,
      mag: ctx.t("live.mag_template"),
      km: ctx.t("live.km"),
      place: ctx.t("live.place_template"),
      dirs: ctx.t("live.directions").split("|"),
      rel: {
        m: ctx.t("live.rel_minutes"),
        h: ctx.t("live.rel_hours"),
        d: ctx.t("live.rel_days"),
      },
      fallback: ctx.t("live.fallback"),
      open: ctx.t("live.open"),
      cities: places.map((p) => [p.names[ctx.lang] ?? p.names.en, p.lat, p.lon]),
    };
    return `<script type="application/json" id="site-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
  },
};

const FLOW_ICONS = {
  networks:
    '<svg viewBox="0 0 32 32"><path d="M16 9 25 27H7Z"/><path d="M9 7a10 10 0 0 0 0 9M23 7a10 10 0 0 1 0 9M5 4a15 15 0 0 0 0 15M27 4a15 15 0 0 1 0 15"/></svg>',
  feed: '<svg viewBox="0 0 32 32"><rect x="5" y="5" width="22" height="22" rx="4"/><path d="M10 12h12M10 17h12M10 22h7"/></svg>',
  shake:
    '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="12"/><circle cx="16" cy="16" r="7.5"/><circle cx="16" cy="16" r="3" class="fill"/></svg>',
  damage:
    '<svg viewBox="0 0 32 32"><path d="M5 15 16 6l11 9v12H5Z"/><path d="m15 13 3 4-3 3 2 4"/></svg>',
  reports:
    '<svg viewBox="0 0 32 32"><circle cx="16" cy="10" r="4.5"/><path d="M7 27c1-6 4.5-9 9-9s8 3 9 9"/></svg>',
};

const ICONS = {
  globe:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18"/></svg>',
  phone:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6 8.5 7 8.5-7"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 7-5 5 5 5M16 7l5 5-5 5"/></svg>',
};

// ------------------------------------------------------------------ renderer

function makeContext(strings, langInfo, page, assetHashes) {
  const lang = langInfo.code;
  const t = (key) => {
    const v = strings[lang][key];
    if (v === undefined) throw new Error(`missing string "${key}" (${lang}, ${page.id})`);
    // {{red}}...{{/red}} marks the brand-red phrase of a headline.
    return v.replace(
      /\{\{red\}\}([\s\S]*?)\{\{\/red\}\}/g,
      '<span class="accent">$1</span>',
    );
  };
  const root = lang === "en" ? "" : "../";
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const num = (n) =>
    langInfo.digits === "arab"
      ? String(n).replace(/\d/g, (d) => arabicDigits[Number(d)])
      : String(n);
  const title = t(`${page.id === "index" ? "meta" : `${page.id}.meta`}.title`);
  const description = t(
    `${page.id === "index" ? "meta" : `${page.id}.meta`}.description`,
  );
  return {
    lang,
    langInfo,
    page,
    t,
    num,
    root,
    vars: {
      lang,
      dir: langInfo.dir,
      langName: langInfo.name,
      root,
      title: escapeAttr(title),
      description: escapeAttr(description),
      canonical: SITE_URL + pagePath(lang, page.file),
      ogLocale: langInfo.og,
      siteUrl: SITE_URL,
      appUrl: APP_URL,
      cssHash: assetHashes.css,
      jsHash: assetHashes.js,
      bodyClass: page.bodyClass ? ` class="${page.bodyClass}"` : "",
      mainClass: page.mainClass ? ` class="${page.mainClass}"` : "",
      translationMarker:
        lang === "en"
          ? ""
          : "<!-- translation: draft-machine, pending native review -->\n",
    },
  };
}

function render(tpl, ctx, depth = 0) {
  if (depth > 8) throw new Error("partial nesting too deep");
  return tpl.replace(
    /\{\{([>=@]?)\s*([\w.-]+)((?:\s+[\w.-]+)*)\s*\}\}/g,
    (_, sigil, name, rest) => {
      if (sigil === ">") {
        const args = rest.trim() ? rest.trim().split(/\s+/) : [];
        if (COMPONENTS[name]) return COMPONENTS[name](ctx, args);
        const file = path.join(SRC, "partials", `${name}.html`);
        return render(read(file), ctx, depth + 1).replace(/\n$/, "");
      }
      if (sigil === "@") {
        if (!(name in ctx.vars)) throw new Error(`unknown variable @${name}`);
        return ctx.vars[name];
      }
      if (sigil === "=") return escapeAttr(ctx.t(name));
      return ctx.t(name);
    },
  );
}

function renderPage(strings, langInfo, page, hashes) {
  const ctx = makeContext(strings, langInfo, page, hashes);
  let body;
  if (page.kind === "template") {
    body = read(path.join(SRC, "pages", `${page.template ?? page.id}.html`));
  } else {
    body = `<main id="main"{{@mainClass}}>\n${read(path.join(SRC, "pages", page.id, `${langInfo.code}.html`))}</main>\n`;
    // Fragments are trusted HTML, but literal {{ in them must not be
    // mistaken for template tags: only the wrapper above is rendered.
    const [open, ...restParts] = body.split("\n");
    body = render(open, ctx) + "\n" + restParts.join("\n");
    const layout = read(path.join(SRC, "partials", "layout.html"));
    return render(layout.replace("{{>content}}", "\u0000CONTENT\u0000"), ctx).replace(
      "\u0000CONTENT\u0000",
      body.trimEnd(),
    );
  }
  const layout = read(path.join(SRC, "partials", "layout.html"));
  return render(layout.replace("{{>content}}", body.trimEnd()), ctx);
}

function sitemap() {
  const urls = [];
  for (const page of PAGES) {
    for (const l of LANGS) {
      const alts = LANGS.map(
        (a) =>
          `    <xhtml:link rel="alternate" hreflang="${a.code}" href="${SITE_URL}${pagePath(a.code, page.file)}"/>`,
      ).join("\n");
      urls.push(
        `  <url>\n    <loc>${SITE_URL}${pagePath(l.code, page.file)}</loc>\n${alts}\n  </url>`,
      );
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
}

const ROBOTS = `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`;

/** Renders every output file in memory: { relativePath: content }. */
export function renderSite() {
  const strings = loadStrings();
  const hashes = { css: hash("style.css"), js: hash("site.js") };
  const out = {};
  for (const page of PAGES) {
    for (const l of LANGS) {
      const rel = (l.code === "en" ? "" : `${l.code}/`) + page.file;
      out[rel] = renderPage(strings, l, page, hashes);
    }
  }
  out["sitemap.xml"] = sitemap();
  out["robots.txt"] = ROBOTS;
  return out;
}

function syncAppData() {
  const src = read(path.join(ROOT, "src/features/geo/gazetteer.ts"));
  const body = src.split("export const GAZETTEER_CITIES")[1];
  const re =
    /id: "([^"]+)",\s*names: \{\s*en: "([^"]+)",\s*ckb: "([^"]+)",\s*kmr: "([^"]+)",\s*ar: "([^"]+)",?\s*\},\s*lat: ([\d.-]+),\s*lon: ([\d.-]+)/g;
  const places = [...body.matchAll(re)].map((m) => ({
    id: m[1],
    names: { en: m[2], ckb: m[3], kmr: m[4], ar: m[5] },
    lat: Number(m[6]),
    lon: Number(m[7]),
  }));
  const expected = (body.split("\nexport function")[0].match(/\bnames:/g) || []).length;
  if (places.length !== expected)
    throw new Error(`parsed ${places.length} of ${expected} gazetteer entries`);
  fs.writeFileSync(
    path.join(SRC, "data", "places.json"),
    JSON.stringify(places, null, 1) + "\n",
  );
  console.log(`places.json: ${places.length} places`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--sync-app-data")) syncAppData();
  const files = renderSite();
  if (args.includes("--check")) {
    const stale = Object.entries(files)
      .filter(([rel, content]) => {
        const p = path.join(OUT, rel);
        return !fs.existsSync(p) || read(p) !== content;
      })
      .map(([rel]) => rel);
    if (stale.length) {
      console.error(
        `website/ is stale; run \`npm run build:site\`. Out of date: ${stale.join(", ")}`,
      );
      process.exit(1);
    }
    console.log(`website/ is up to date (${Object.keys(files).length} files)`);
    return;
  }
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  console.log(`wrote ${Object.keys(files).length} files to website/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
