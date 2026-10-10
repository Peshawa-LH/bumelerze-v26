# website-src

Source of the static site in `website/`. One set of templates, four strings
files. Build from the repo root:

```sh
npm run build:site            # render website/**/*.html, sitemap.xml, robots.txt
node scripts/build-website.mjs --check           # exit 1 if website/ is stale
node scripts/build-website.mjs --sync-app-data   # refresh data/places.json, then build
```

Commit `website-src/` and the regenerated `website/` together; the jest test
`src/__tests__/website-build.test.ts` fails if they disagree.

## Layout

| Path | What |
|---|---|
| `strings/{en,ckb,kmr,ar}.json` | Every visible string, flat `key: value`. English copy keys are verbatim from the outreach copy file; the other three are machine drafts. Every language must have every English key, or the build stops. Feature names (Did you feel it, I'm safe, SHAKEmap, Tag my building, ...) match `src/i18n/locales/*.json`. |
| `pages/index.html`, `pages/how-it-works.html`, `pages/support.html`, `pages/about.html` | Templates rendered from the strings. |
| `pages/{handbook,privacy}/<lang>.html` | Per-language page bodies (the inside of `<main>`), copied verbatim into the shared layout. Edit the text here. |
| `partials/layout.html`, `head.html`, `header.html`, `footer.html` | Shared page chrome. |
| `partials/svg/` | The seismic line (from `npm run build:site-assets -- --external <dir>`) and the skyline (from `node scripts/draw-website-skyline.mjs`), inlined so CSS can tint them. |
| `data/places.json` | Town names in four languages for the live card's place line, from the app's gazetteer. |
| `data/social.json` | Official social media accounts for the About page (empty until confirmed). |

## Template syntax

| Tag | Inserts |
|---|---|
| `{{key}}` | the string, as-is (it may hold inline markup such as `<bdi>`) |
| `{{=key}}` | the string, tags stripped, escaped for an HTML attribute |
| `{{red}}…{{/red}}` | inside a string value: the brand-red phrase of a headline (e.g. "in your language"); each language marks its own equivalent |
| `{{@var}}` | a computed page variable: `lang`, `dir`, `root` (`""` or `"../"`), `title`, `description`, `canonical`, `appUrl`, `cssHash`, `jsHash`, ... |
| `{{>name args}}` | a partial file or a component function in `scripts/build-website.mjs` (`rich`, `supportGroups`, `supportCards`, `principles`, `timeline`, `social`, `fakeTips`, `phone`, `feltStrip`, `buildingTiles`, `vcBar`, `shakeFigure`, `catalogMap`, `flowDiagram`, `channels`, `seismicLine`, `hazardMap`, ...) |

Sorani and Arabic strings use Eastern Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) with
"." as the decimal point. Kurmanji and English use Latin digits.
