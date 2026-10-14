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
const APP_URL = "https://app.bumelerze.com/";

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
  { id: "support", file: "support.html", nav: "support", kind: "template" },
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
  { id: "support", file: "support.html", key: "nav.support" },
];

const read = (p) => fs.readFileSync(p, "utf8");

/** Numbers the site states that come straight from the app's data, read at
 * build time so the site cannot drift from the app (website-src/README.md). */
let factsCache = null;
function appFacts() {
  if (!factsCache) {
    const stations = JSON.parse(
      read(path.join(ROOT, "assets", "stations", "live-stations.json")),
    );
    factsCache = { stations: stations.stations.length };
  }
  return factsCache;
}

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
  checkBrandSpelling(strings);
  return strings;
}

/** The brand is written "Bumelerze" in Arabic copy (owner decision
 * 2026-10-14), inside a bidi isolate (U+2066 … U+2069) when it sits in Arabic
 * text, and "بوومەلەرزە" in Sorani. The Sorani letters ێ (U+06CE) and ە
 * (U+06D5) do not exist in Arabic, so any such letter in the Arabic file is a
 * stray Kurdish transliteration; the one place they belong is the Kurdish
 * word the About intro derives the name from, inside «…». */
export const ARABIC_ETYMOLOGY_KEY = "about.intro";
export function checkBrandSpelling(strings) {
  const problems = [];
  for (const [key, value] of Object.entries(strings.ar)) {
    const text = key === ARABIC_ETYMOLOGY_KEY ? value.replace(/«[^»]*»/g, "") : value;
    if (/[ێە]/.test(text))
      problems.push(
        `strings/ar.json ${key}: Sorani letters in Arabic copy, write the brand as Bumelerze`,
      );
    if (/Bumelerze/.test(value) && /[؀-ۿ]/.test(value) && !/⁦Bumelerze⁩/.test(value))
      problems.push(
        `strings/ar.json ${key}: Bumelerze inside Arabic text needs a bidi isolate (\\u2066…\\u2069)`,
      );
  }
  for (const [key, value] of Object.entries(strings.ckb)) {
    if (/بومەلەرزە/.test(value))
      problems.push(`strings/ckb.json ${key}: the brand is spelt بوومەلەرزە`);
  }
  if (problems.length) throw new Error(problems.join("\n"));
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
  intensityLegend(ctx) {
    // Colours: the app's intensityRamp (src/theme/palette.ts), levels IV-VIII
    // as shown on this map (shakemap-meta.json levels_shown). Numerals follow
    // the app's intensity rule (see `intensity` above).
    const ramp = { 4: "#A1D7E3", 5: "#8FC891", 6: "#F9EC33", 7: "#EEB509", 8: "#E9872D" };
    return Object.entries(ramp)
      .map(([lvl, c]) => `<li style="--swatch:${c}">${intensity(ctx, Number(lvl))}</li>`)
      .join("");
  },
  vcFigure(ctx) {
    // Four building types in one even row, in the page's reading direction
    // (mud walls on the reading-start side), and the A-F scale below as its
    // own row. Deliberately no link between a building and a class.
    const tiles = [
      ["structure-mud-walls", "building.mud"],
      ["structure-stone-walls", "building.stone"],
      ["structure-brick-walls", "building.brick"],
      ["structure-frame", "building.frame"],
    ]
      .map(([file, key]) => `<li>${pictogram(file)}<span>${ctx.t(key)}</span></li>`)
      .join("\n            ");
    const classes = ["A", "B", "C", "D", "E", "F"]
      .map((c) => `<li class="vc-${c.toLowerCase()}">${c}</li>`)
      .join("");
    return `<div class="vc-figure">
          <ul class="vc-tiles">
            ${tiles}
          </ul>
          <ol class="vc-scale" aria-label="${escapeAttr(ctx.t("building.alt_vc"))}">${classes}</ol>
          <div class="vc-ends"><span>A · ${ctx.t("building.vc_a")}</span><span>F · ${ctx.t("building.vc_f")}</span></div>
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
        </div>
        <figcaption>
          <span class="cap-event">${ctx.t("shake.caption")}</span>
          <span class="legend"><span class="legend-label">${ctx.t("shake.legend")}</span><ol class="intensity-legend" dir="ltr">${COMPONENTS.intensityLegend(ctx)}</ol></span>
        </figcaption>
      </figure>`;
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
  // ---- How it works: method figures. Code-drawn, labels are HTML (so they
  // translate and follow the page direction); drawings are small inline SVGs
  // in the flow diagram's line style. Arrows are glyphs swapped for RTL.
  methodData(ctx) {
    const names = ["USGS", "EMSC", "GEOFON"];
    const chips = names
      .map(
        (n) =>
          `<li class="mfig-chip">${icon(METHOD_ICONS.station)}<span dir="ltr">${n}</span></li>`,
      )
      .join("");
    const card = `<div class="mfig-event">
            <p class="mfig-event-head">${icon(METHOD_ICONS.quake)}<span>${ctx.t("hiw.data.fig.one_event")}</span></p>
            <ul class="mfig-tags">${names.map((n) => `<li dir="ltr">${n}</li>`).join("")}</ul>
          </div>`;
    return mfig("mfig--data", [
      stage(`<ul class="mfig-chips">${chips}</ul>`, ctx.t("hiw.data.fig.networks")),
      merge(ctx.t("hiw.data.fig.merge")),
      stage(card, ctx.t("hiw.data.fig.sources")),
    ]);
  },
  methodShake(ctx) {
    const chip = (ic, key) =>
      `<li class="mfig-chip">${icon(METHOD_ICONS[ic])}<span>${ctx.t(key)}</span></li>`;
    return mfig("mfig--shake", [
      stage(
        `<ul class="mfig-chips">${chip("models", "hiw.shakemaps.fig.models")}${chip("station", "hiw.shakemaps.fig.stations")}${chip("person", "hiw.shakemaps.fig.reports")}</ul>`,
      ),
      merge(),
      stage(
        `${shakeDrawing()}<ol class="intensity-legend" dir="ltr">${COMPONENTS.intensityLegend(ctx)}</ol>`,
        ctx.t("hiw.shakemaps.fig.map"),
      ),
    ]);
  },
  methodDamage(ctx) {
    // A schematic, not an estimate: one intensity level, the A-F classes,
    // and illustrative shares of damage grades 1-5 (no casualty figure).
    const level = 7;
    const shaking = `<div class="mfig-swatch" style="--swatch:${INTENSITY_RAMP[level]}">${intensity(ctx, level)}</div>`;
    const classes = `<ol class="mfig-vc">${["A", "B", "C", "D", "E", "F"]
      .map((c) => `<li class="vc-${c.toLowerCase()}">${c}</li>`)
      .join("")}</ol>`;
    const shares = [34, 28, 20, 12, 6];
    const bars = `<ol class="mfig-dg">${shares
      .map(
        (h, i) =>
          `<li><span class="mfig-dg-bar" style="--h:${h};--dg:${DAMAGE_GRADES[i]}"></span><span class="mfig-dg-num">${ctx.num(i + 1)}</span></li>`,
      )
      .join("")}</ol>`;
    return mfig("mfig--damage", [
      stage(shaking, ctx.t("hiw.damage.fig.shaking")),
      '<span class="mfig-op" aria-hidden="true">×</span>',
      stage(
        classes,
        ctx.t("hiw.damage.fig.buildings"),
        ctx.t("hiw.damage.fig.classes_note"),
      ),
      ARROW,
      stage(
        bars,
        ctx.t("hiw.damage.fig.result"),
        // keep the scale's Latin name in one left-to-right run in RTL text
        ctx
          .t("hiw.damage.fig.grades")
          .replace(/\(([A-Z]+-\d+)\)/, '<bdi dir="ltr">($1)</bdi>'),
      ),
    ]);
  },
  methodReports(ctx) {
    return mfig("mfig--reports", [
      stage(reportsDrawing("taps"), ctx.t("hiw.reports.fig.taps")),
      ARROW,
      stage(reportsDrawing("cells"), ctx.t("hiw.reports.fig.areas")),
      ARROW,
      stage(reportsDrawing("map"), ctx.t("hiw.reports.fig.map")),
    ]);
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
      labelNear: ctx.t("live.label"),
      labelWorld: ctx.t("live.label_world"),
      prev: ctx.t("live.prev"),
      next: ctx.t("live.next"),
      slide: ctx.t("live.slide"),
      fe: `${ctx.root}data/fe-${ctx.lang}.json`,
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

// ------------------------------------------- How it works: method figures

/** The app's intensity ramp (src/theme/palette.ts intensityRamp) and
 * damage-grade palette (damageGradePalette, DG1-DG5). */
const INTENSITY_RAMP = [
  "",
  "#FFFFFF",
  "#EDEFF3",
  "#ACB4CE",
  "#A1D7E3",
  "#8FC891",
  "#F9EC33",
  "#EEB509",
  "#E9872D",
  "#DF532A",
  "#D9262A",
  "#DB0000",
  "#CC0000",
];
const DAMAGE_GRADES = ["#1B5E20", "#8FC891", "#F9EC33", "#DF532A", "#B3141A"];

const METHOD_ICONS = {
  station:
    '<path d="M12 6.5 18.5 19h-13Z"/><path d="M8 5a6 6 0 0 0 0 6M16 5a6 6 0 0 1 0 6"/>',
  quake: '<path d="M2 13h4l2-6.5 3.2 12 3-9 2 3.5H22"/>',
  models: '<path d="M4 4v16h16"/><path d="M6.5 7c2 6 5 9.5 12 10.5"/>',
  person:
    '<circle cx="12" cy="8" r="3.6"/><path d="M5 20.5c.8-4.6 3.5-7 7-7s6.2 2.4 7 7"/>',
};

const ARROW = '<span class="mfig-arrow" aria-hidden="true"></span>';

/** Several inputs converging into one: three lines merging into an arrow
 * (wide layout) or a plain arrow (stacked), with an optional step label. */
function merge(label = "") {
  return `<div class="mfig-merge"><span class="mfig-arrow" aria-hidden="true"><svg viewBox="0 0 48 96" focusable="false"><path d="M2 14c22 0 20 34 40 34M2 48h40M2 82c22 0 20-34 40-34"/><path d="m35 41 8 7-8 7"/></svg></span>${label ? `<p class="mfig-step">${label}</p>` : ""}</div>`;
}

function stage(visual, label = "", sub = "") {
  return `<div class="mfig-stage"><div class="mfig-visual">${visual}</div>${label ? `<p class="mfig-label">${label}</p>` : ""}${sub ? `<p class="mfig-sub">${sub}</p>` : ""}</div>`;
}

/** A method figure: stages in a row (or a column on narrow screens); the
 * labels are page text, so the figure reads in the page's language. */
function mfig(cls, parts) {
  return `<figure class="feature-fig mfig ${cls}">
        <div class="mfig-row">${parts.join("")}</div>
      </figure>`;
}

/** A closed, gently irregular ring around (cx, cy): the stylised contour
 * of one intensity level. */
function blob(cx, cy, rx, ry, phase) {
  const pts = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const k = 1 + 0.1 * Math.sin(2 * a + phase) + 0.05 * Math.sin(3 * a + 1.3 * phase);
    pts.push(
      `${(cx + rx * k * Math.cos(a)).toFixed(1)} ${(cy + ry * k * Math.sin(a)).toFixed(1)}`,
    );
  }
  return `M${pts.join("L")}Z`;
}

/** Stylised SHAKEmap: intensity IV-VIII rings around the epicentre, a few
 * stations (triangles) and felt reports (dots). No real data. */
function shakeDrawing() {
  const levels = [4, 5, 6, 7, 8];
  const rings = levels
    .map((lvl, i) => {
      const s = 1 - i * 0.19;
      return `<path d="${blob(104, 70, 92 * s, 58 * s, 0.6 + i * 0.5)}" fill="${INTENSITY_RAMP[lvl]}"/>`;
    })
    .join("");
  const stations = [
    [36, 40],
    [162, 34],
    [150, 112],
    [62, 116],
  ]
    .map(([x, y]) => `<path class="sd-station" d="M${x} ${y - 6}l5.5 9.5h-11Z"/>`)
    .join("");
  const reports = [
    [80, 52],
    [128, 88],
    [118, 46],
    [72, 90],
    [140, 66],
    [96, 102],
  ]
    .map(([x, y]) => `<circle class="sd-report" cx="${x}" cy="${y}" r="3"/>`)
    .join("");
  return `<svg class="mfig-map" viewBox="0 0 208 140" aria-hidden="true" focusable="false"><rect class="sd-bg" width="208" height="140" rx="12"/><g class="sd-rings">${rings}</g>${stations}${reports}<path class="sd-epi" d="m104 61 2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6-4.5-4.1 6-.7Z"/></svg>`;
}

/** Felt reports, grouped into square area cells (the app bins reports by
 * geohash cell), coloured by community intensity. One grid, three states:
 * "taps", "cells", "map". */
function reportsDrawing(state) {
  const size = 20;
  const x0 = 4;
  const y0 = 9;
  // reports per cell and the community intensity they average to
  const filled = {
    "1,1": [3, 5],
    "2,1": [5, 6],
    "2,0": [2, 4],
    "3,1": [3, 5],
    "1,2": [1, 4],
    "3,2": [2, 4],
    "2,2": [2, 5],
    "2,3": [1, 4],
  };
  let grid = "";
  let dots = "";
  for (let c = 0; c < 5; c++)
    for (let r = 0; r < 5; r++) {
      const [x, y] = [x0 + c * size, y0 + r * size];
      const f = filled[`${c},${r}`];
      const on = state === "map" && f;
      if (state !== "taps") {
        grid += `<rect class="rd-cell${on ? " rd-cell--on" : ""}" x="${x}" y="${y}" width="${size}" height="${size}"${on ? ` style="fill:${INTENSITY_RAMP[f[1]]}"` : ""}/>`;
      }
      if (f && state !== "map") {
        for (let i = 0; i < f[0]; i++) {
          const a = i * 2.4 + c;
          const d = i === 0 ? 0 : 5.5;
          dots += `<circle class="rd-dot" cx="${(x + size / 2 + d * Math.cos(a)).toFixed(1)}" cy="${(y + size / 2 + d * Math.sin(a)).toFixed(1)}" r="2.3"/>`;
        }
      }
    }
  // "Your tap": one report ringed in the first state
  const you =
    state === "taps"
      ? `<circle class="rd-you" cx="${x0 + 2 * size + size / 2}" cy="${y0 + size + size / 2}" r="5.8"/>`
      : "";
  return `<svg class="mfig-cells" viewBox="0 0 108 118" aria-hidden="true" focusable="false"><rect class="rd-bg" x="0.5" y="0.5" width="107" height="117" rx="10"/>${grid}${dots}${you}</svg>`;
}

// ------------------------------------------------ support + about helpers

const PAGE_LINKS = {
  how: "how-it-works.html",
  next: "how-it-works.html#next",
  privacy: "privacy.html",
  official: "about.html#official",
  tag: `${APP_URL}home/new`,
};

/** Inline formatting for copy: [[how|label]] page links, e-mail addresses
 * as mailto links, and app.bumelerze.com as a link to the app. Strings are
 * trusted (they come from website-src/strings). */
function rich(text) {
  return text
    .replace(
      /\[\[(how|next|privacy|official|tag)\|([^\]]+)\]\]/g,
      (_, k, label) => `<a href="${PAGE_LINKS[k]}">${label}</a>`,
    )
    .replace(/\b([a-z]+@bumelerze\.com)\b/g, '<a href="mailto:$1"><bdi>$1</bdi></a>')
    .replace(
      /(^|[\s(«“])app\.bumelerze\.com\b/g,
      `$1<a href="${APP_URL}"><bdi>app.bumelerze.com</bdi></a>`,
    );
}

/** An answer: "1) … 2) …" steps become an ordered list after any lead text. */
function answer(text) {
  const parts = text.split(/(?:^|\s+)\d\)\s+/);
  if (parts.length < 3) return `<p>${rich(text)}</p>`;
  const lead = parts[0].trim();
  const steps = parts
    .slice(1)
    .map((step) => `<li><span>${rich(step.trim())}</span></li>`);
  return `${lead ? `<p>${rich(lead)}</p>` : ""}<ol class="steps">${steps.join("")}</ol>`;
}

const icon = (paths, cls = "line-icon") =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;

const GROUP_ICONS = {
  start:
    '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M12 8.2v5.6M9.2 11h5.6M10.8 18.5h2.4"/>',
  quakes: '<path d="M2 13h4l2-6.5 3.2 12 3-9 2 3.5H22"/>',
  share:
    '<circle cx="12" cy="12" r="2.4"/><path d="M7.6 7.6a6.2 6.2 0 0 0 0 8.8M16.4 7.6a6.2 6.2 0 0 1 0 8.8M4.7 4.7a10.3 10.3 0 0 0 0 14.6M19.3 4.7a10.3 10.3 0 0 1 0 14.6"/>',
  family:
    '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.6V20h13V9.6"/><path d="M12 17.4s-3.1-1.9-3.1-4a1.6 1.6 0 0 1 3.1-.7 1.6 1.6 0 0 1 3.1.7c0 2.1-3.1 4-3.1 4Z"/>',
  account:
    '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c.8-4 3.8-6 7.5-6s6.7 2 7.5 6"/>',
  alerts:
    '<path d="M12 3.5c-3.3 0-5.8 2.6-5.8 6v4L4.5 17h15l-1.7-3.5v-4c0-3.4-2.5-6-5.8-6Z"/><path d="M9.8 19.5a2.3 2.3 0 0 0 4.4 0"/>',
  contact:
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
};
const SUPPORT_GROUPS = [
  "start",
  "quakes",
  "share",
  "family",
  "account",
  "alerts",
  "contact",
];

const PRINCIPLE_ICONS = [
  '<path d="M12 9.5 19 21H5Z"/><path d="M7.5 6.5a6.4 6.4 0 0 0 0 7M16.5 6.5a6.4 6.4 0 0 1 0 7M4.6 3.6a10.4 10.4 0 0 0 0 12.8M19.4 3.6a10.4 10.4 0 0 1 0 12.8"/>',
  '<path d="M4 5.5h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-3.5 3v-3H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z"/><path d="M16 9.5h4a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2h-1v2.5L16 18h-3"/>',
  '<path d="M12 2.8 4.5 5.8v5.7c0 4.7 3.2 8.2 7.5 9.7 4.3-1.5 7.5-5 7.5-9.7V5.8Z"/><rect x="9" y="10.5" width="6" height="5" rx="1"/><path d="M10.3 10.5V9a1.7 1.7 0 0 1 3.4 0v1.5"/>',
  '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4.5l-3 15"/>',
];

// Monochrome brand glyphs (currentColor), one size everywhere.
const SOCIAL_ICONS = {
  instagram:
    '<svg class="social-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="5.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.4" cy="6.6" r="1.3" fill="currentColor"/></svg>',
  facebook:
    '<svg class="social-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z"/></svg>',
  x: '<svg class="social-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.96 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64Z"/></svg>',
};

/** The three shared goals (Home outlook, How it works section 7, About
 * aims), in render order, each with a line icon. */
const GOALS = [
  {
    key: "warning",
    icon: '<path d="M12 3.5c-3.3 0-5.8 2.6-5.8 6v4L4.5 17h15l-1.7-3.5v-4c0-3.4-2.5-6-5.8-6Z"/><path d="M9.8 19.5a2.3 2.3 0 0 0 4.4 0"/>',
  },
  {
    key: "buildings",
    icon: '<path d="M3.5 20V8.5l6.5-4.5 6.5 4.5v3"/><path d="M3.5 20h8"/><path d="M7.5 12h2.5M7.5 16h2.5"/><circle cx="17" cy="16.5" r="3.2"/><path d="m19.4 18.9 2.2 2.2"/>',
  },
  {
    key: "resilience",
    icon: '<path d="M12 2.8 4.5 5.8v5.7c0 4.7 3.2 8.2 7.5 9.7 4.3-1.5 7.5-5 7.5-9.7V5.8Z"/><path d="M8.5 13 12 10l3.5 3v3.5h-7Z"/>',
  },
];

/** About roadmap ("Next") items with their icons. */
const ROADMAP = {
  next: [
    [
      "next1",
      '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M10.8 18.5h2.4"/>',
    ],
    [
      "next2",
      '<path d="M12 3.5c-3.3 0-5.8 2.6-5.8 6v4L4.5 17h15l-1.7-3.5v-4c0-3.4-2.5-6-5.8-6Z"/><path d="M9.8 19.5a2.3 2.3 0 0 0 4.4 0"/>',
    ],
  ],
};

const SUPPORT_ABOUT_COMPONENTS = {
  rich: (ctx, [key]) => rich(ctx.t(key)),
  supportChips(ctx) {
    return SUPPORT_GROUPS.map(
      (g) => `<a class="chip-link" href="#${g}">${ctx.t(`support.group_${g}.title`)}</a>`,
    ).join("\n        ");
  },
  supportCards(ctx) {
    const cards = [
      ["start", "#start", GROUP_ICONS.start],
      ["contact", "#contact", GROUP_ICONS.contact],
      [
        "fake",
        "about.html#official",
        '<path d="M12 2.8 4.5 5.8v5.7c0 4.7 3.2 8.2 7.5 9.7 4.3-1.5 7.5-5 7.5-9.7V5.8Z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
      ],
    ];
    return cards
      .map(
        ([k, href, paths]) => `<article class="quick-card">
          <span class="quick-icon">${icon(paths)}</span>
          <h2>${ctx.t(`support.card_${k}.title`)}</h2>
          <p>${rich(ctx.t(`support.card_${k}.body`))}</p>
          <a class="text-link" href="${href}">${ctx.t(`support.card_${k}.link`)}<span class="arrow" aria-hidden="true"></span></a>
        </article>`,
      )
      .join("\n        ");
  },
  supportGroups(ctx) {
    return SUPPORT_GROUPS.map((g, gi) => {
      const items = [];
      for (let n = 1; ctx.has(`support.${g}.q${n}`); n++) {
        items.push(`<details class="faq-item" id="${g}-q${n}">
          <summary><span class="faq-q">${ctx.t(`support.${g}.q${n}`)}</span><span class="faq-chev" aria-hidden="true"></span></summary>
          <div class="faq-a">${answer(ctx.t(`support.${g}.a${n}`))}</div>
        </details>`);
      }
      // "alerts" names early warning, as an aim only: marked for the test.
      const aim = g === "alerts" ? " data-aim" : "";
      return `<section class="band${gi % 2 ? "" : " band--alt"} faq-band" id="${g}" aria-labelledby="${g}-h" data-faq-group${aim}>
    <div class="faq-group">
      <h2 id="${g}-h" class="faq-title"><span class="faq-icon">${icon(GROUP_ICONS[g])}</span><span>${ctx.t(`support.group_${g}.title`)}</span></h2>
      <div class="faq-list">
        ${items.join("\n        ")}
      </div>
    </div>
  </section>`;
    }).join("\n\n  ");
  },
  principles(ctx) {
    return [1, 2, 3]
      .map(
        (n) => `<li class="principle">
          <span class="principle-icon">${icon(PRINCIPLE_ICONS[n - 1])}</span>
          <h3>${ctx.t(`about.principle${n}.title`)}</h3>
          <p>${rich(ctx.t(`about.principle${n}.body`))}</p>
        </li>`,
      )
      .join("\n        ");
  },
  goals(ctx, [length = "short", level = "h3"]) {
    // The same three goals on Home and About (title + short line) and on
    // How it works (title + long text).
    return GOALS.map(
      (g) => `<li class="goal">
          <span class="goal-icon">${icon(g.icon)}</span>
          <div class="goal-text">
            <${level} class="goal-title">${ctx.t(`goal.${g.key}.title`)}</${level}>
            <p>${ctx.t(`goal.${g.key}.${length}`)}</p>
          </div>
        </li>`,
    ).join("\n        ");
  },

  roadmapItems(ctx, [group]) {
    return ROADMAP[group]
      .map(
        ([key, paths]) =>
          `<li><span class="road-icon">${icon(paths)}</span><span>${ctx.t(`about.roadmap.${key}`)}</span></li>`,
      )
      .join("\n            ");
  },
  social(ctx, [variant = "block"]) {
    // Official accounts from website-src/data/social.json, as icon links
    // (the platform name is the accessible name and the tooltip).
    const list = JSON.parse(read(path.join(SRC, "data", "social.json")));
    const shown = list.filter((s) => SOCIAL_ICONS[s.platform] && s.url);
    if (!shown.length) {
      return variant === "block"
        ? `<p class="social-none">${ctx.t("about.social.none")}</p>`
        : "";
    }
    return `<ul class="social-icons social-icons--${variant}">${shown
      .map((s) => {
        const name = escapeAttr(ctx.t(`about.social.${s.platform}`));
        return `<li><a class="social-link" href="${escapeAttr(s.url)}" rel="me noopener noreferrer" target="_blank" aria-label="${name}" title="${name}">${SOCIAL_ICONS[s.platform]}</a></li>`;
      })
      .join("")}</ul>`;
  },
  fakeTips(ctx) {
    const check =
      '<path d="M12 2.8 4.5 5.8v5.7c0 4.7 3.2 8.2 7.5 9.7 4.3-1.5 7.5-5 7.5-9.7V5.8Z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>';
    return [1, 2, 3]
      .map(
        (n) =>
          `<li>${icon(check, "tip-icon")}<span>${rich(ctx.t(`about.fake_tip${n}`))}</span></li>`,
      )
      .join("\n          ");
  },
};
Object.assign(COMPONENTS, SUPPORT_ABOUT_COMPONENTS);

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
    return v
      .replace(/\{\{red\}\}([\s\S]*?)\{\{\/red\}\}/g, '<span class="accent">$1</span>')
      .replace(/\{\{fact:(\w+)\}\}/g, (_, name) => num(appFacts()[name]));
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
  const has = (key) => strings[lang][key] !== undefined;
  return {
    lang,
    langInfo,
    page,
    t,
    has,
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

// ------------------------------------------------ forwards to the app
// bumelerze.com no longer hosts the app (it lives at app.bumelerze.com).
// Two small pages keep old and short links working; both inline the one
// mapping in website-src/redirects.js. GitHub Pages serves 404.html for any
// path that is not a file, which is how /app/<path>, /e/<id>, /u/<name> and
// /join reach the script; app/index.html answers /app and /app/ directly.

//
// Both pages are also what a client that runs no script sees: a messenger's
// link-preview bot, a plain fetch, some in-app browsers. So they carry the
// site's Open Graph and Twitter cards (a generic Bumelerze title and the site
// image, so a shared bumelerze.com/e/… unfurls as the brand, never as "Page
// not found") and a visible way into the app in all four languages. Once the
// script runs, it points those links at the exact target and forwards.

const REDIRECT_PAGE_STYLE =
  "body{margin:0;font:18px/1.5 system-ui,sans-serif;background:#fff5e8;color:#1c1b1f}" +
  "main{max-width:32rem;margin:15vh auto;padding:0 1.25rem}" +
  "a{color:#a8151f;font-weight:600}" +
  "@media (prefers-color-scheme:dark){body{background:#0b1a26;color:#f2f2f3}a{color:#ff8a8f}}" +
  ".open-app{list-style:none;margin:0 0 2rem;padding:0;display:grid;gap:.6rem}" +
  "html.forwarding .not-found{display:none}" +
  "html.missing .open-app{display:none}";

function redirectScript(fallbackToApp) {
  const mapping = read(path.join(SRC, "redirects.js"))
    .replace(/\/\*[\s\S]*?\*\//, "")
    .trim();
  return `<script>
${mapping}
(function () {
  var to = appRedirect(location.pathname, location.search, location.hash)${fallbackToApp ? ' || APP_ORIGIN + "/"' : ""};
  var root = document.documentElement;
  if (!to) {
    root.className = "missing";
    document.title = "Page not found \\u00b7 Bumelerze";
    return;
  }
  root.className = "forwarding";
  if (document.addEventListener) {
    document.addEventListener("DOMContentLoaded", function () {
      var links = document.querySelectorAll("a[data-app-link]");
      for (var i = 0; i < links.length; i++) links[i].href = to;
    });
  }
  location.replace(to);
})();
</script>`;
}

/** "Open this in the Bumelerze app", once per language, each line in its own
 * language and direction; the script repoints every link at the exact target. */
function openAppLinks(strings) {
  return `<ul class="open-app">
${LANGS.map(
  (l) =>
    `<li lang="${l.code}" dir="${l.dir}"><a data-app-link href="${APP_URL}">${strings[l.code]["forward.open_app"]}</a></li>`,
).join("\n")}
</ul>`;
}

function redirectPage(strings, { script, body, noscriptTo }) {
  const en = strings.en;
  const title = escapeAttr(en["meta.title"]);
  const description = escapeAttr(en["forward.description"]);
  const image = `${SITE_URL}og-image.jpg`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="color-scheme" content="light dark">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeAttr(en.brand)}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escapeAttr(en["ui.og_alt"])}">
<meta property="og:locale" content="en_GB">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${image}">
<link rel="icon" href="${SITE_URL}favicon.ico" sizes="any">
${noscriptTo ? `<noscript><meta http-equiv="refresh" content="0; url=${noscriptTo}"></noscript>\n` : ""}<style>${REDIRECT_PAGE_STYLE}</style>
${script}
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

/** website/app/index.html: bumelerze.com/app(/) -> app.bumelerze.com. */
function appForwardPage(strings) {
  return redirectPage(strings, {
    script: redirectScript(true),
    noscriptTo: APP_URL,
    body: `${openAppLinks(strings)}
<p>The Bumelerze app is now at <a href="${APP_URL}">app.bumelerze.com</a>.</p>`,
  });
}

/** website/404.html: forwards old and short links, else "page not found". */
function notFoundPage(strings) {
  return redirectPage(strings, {
    script: redirectScript(false),
    body: `${openAppLinks(strings)}
<div class="not-found">
<h1>Page not found</h1>
<p>This page does not exist on bumelerze.com.</p>
<p><a href="${SITE_URL}">Go to the Bumelerze website</a> · <a href="${APP_URL}">Open the app</a></p>
</div>`,
  });
}

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
  // Per-language Flinn-Engdahl names for the live card's world slides
  // (fetched only when a far-away earthquake is shown). English fallback
  // names inside right-to-left text are isolated, as in the app.
  const fe = JSON.parse(read(path.join(SRC, "data", "fe-regions.json")));
  for (const l of LANGS) {
    const names = fe.en.map((en, i) => {
      const tr = fe.tr[i + 1]?.[l.code];
      if (l.code !== "en" && tr) return tr;
      return l.dir === "rtl" ? `\u2066${en}\u2069` : en;
    });
    out[`data/fe-${l.code}.json`] = JSON.stringify({ grid: fe.grid, names }) + "\n";
  }
  out["sitemap.xml"] = sitemap();
  out["robots.txt"] = ROBOTS;
  // Forwards only: the app itself is never built into the website.
  out["404.html"] = notFoundPage(strings);
  out["app/index.html"] = appForwardPage(strings);
  return out;
}

async function syncAppData() {
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
  // Flinn-Engdahl regions (the app's names for far-away earthquakes): the
  // 1-degree grid, the English names and the app's translations.
  const fe = await import(
    path.join(ROOT, "src/features/geo/data/fe-regions.generated.ts")
  );
  const feTr = await import(
    path.join(ROOT, "src/features/geo/data/fe-region-translations.ts")
  );
  fs.writeFileSync(
    path.join(SRC, "data", "fe-regions.json"),
    JSON.stringify({
      grid: fe.FE_GRID_ROWS,
      en: fe.FE_REGION_NAMES_EN,
      tr: feTr.FE_REGION_TRANSLATIONS,
    }) + "\n",
  );
  console.log("fe-regions.json: Flinn-Engdahl grid and names");
}

// ------------------------------------------------------------- app facts
// website-src/data/app-facts.json lists every website statement that rests on
// the app's behaviour, labels or data, with the app sources it rests on (an
// English locale key or a file). The lock file stores a fingerprint of each
// source; --check-facts fails, naming the statements to review, when any
// source changed. Review those statements, fix the site copy if needed, then
// --refresh-facts.

const FACTS_FILE = path.join(SRC, "data", "app-facts.json");
const LOCK_FILE = path.join(SRC, "data", "app-facts.lock.json");

function factFingerprints() {
  const en = JSON.parse(read(path.join(ROOT, "src", "i18n", "locales", "en.json")));
  const siteEn = JSON.parse(read(path.join(SRC, "strings", "en.json")));
  const lookup = (key) =>
    key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), en);
  const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
  const { facts } = JSON.parse(read(FACTS_FILE));
  const prints = {};
  const problems = [];
  for (const fact of facts) {
    prints[fact.id] = {};
    for (const src of fact.appSources) {
      const name = src.key ? `key:${src.key}` : `file:${src.file}`;
      if (src.key) {
        const value = lookup(src.key);
        if (typeof value !== "string")
          problems.push(`${fact.id}: app key ${src.key} no longer exists`);
        prints[fact.id][name] = typeof value === "string" ? sha(value) : null;
      } else {
        const file = path.join(ROOT, src.file);
        if (!fs.existsSync(file))
          problems.push(`${fact.id}: app file ${src.file} no longer exists`);
        prints[fact.id][name] = fs.existsSync(file) ? sha(fs.readFileSync(file)) : null;
      }
    }
    for (const key of fact.usedIn.keys) {
      if (!(key in siteEn))
        problems.push(`${fact.id}: site string ${key} no longer exists`);
    }
  }
  return { facts, prints, problems };
}

function checkFacts() {
  const { facts, prints, problems } = factFingerprints();
  const lock = fs.existsSync(LOCK_FILE) ? JSON.parse(read(LOCK_FILE)) : {};
  for (const fact of facts) {
    const changed = Object.keys(prints[fact.id]).filter(
      (name) => lock[fact.id]?.[name] !== prints[fact.id][name],
    );
    if (changed.length) {
      const where = `${fact.usedIn.pages.join(", ")}: ${fact.usedIn.keys.join(", ")}`;
      problems.push(
        `${fact.id}: app source changed: ${changed.join(", ")}\n    statement: ${fact.statement}\n    review: ${where}`,
      );
    }
  }
  return problems;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--sync-app-data")) await syncAppData();
  if (args.includes("--refresh-facts")) {
    const { prints, problems } = factFingerprints();
    if (problems.length) {
      console.error(problems.join("\n"));
      process.exit(1);
    }
    fs.writeFileSync(LOCK_FILE, JSON.stringify(prints, null, 2) + "\n");
    console.log(
      `app-facts.lock.json refreshed (${Object.keys(prints).length} statements)`,
    );
    return;
  }
  if (args.includes("--check-facts")) {
    const problems = checkFacts();
    if (problems.length) {
      console.error(
        `The app changed under ${problems.length} website statement(s). Review each one, ` +
          "update the site copy if needed, then run `node scripts/build-website.mjs --refresh-facts`.\n\n" +
          problems.join("\n"),
      );
      process.exit(1);
    }
    console.log("app facts: all sources unchanged");
    return;
  }
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
