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
| `data/social.json` | Official social media accounts (platform + URL, no tracking parameters). Rendered as icon links on About and in every footer. |
| `data/fe-regions.json` | The app's Flinn-Engdahl grid, English names and translations (from `--sync-app-data`). The build writes `website/data/fe-<lang>.json`, which the live card fetches only when it shows a far-away earthquake. |
| `data/app-facts.json`, `data/app-facts.lock.json` | The register of website statements that rest on the app, and the fingerprints of their app sources (see below). |

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

## Keeping the site in step with the app

Some website text describes app behaviour, quotes app labels or states
numbers from app data. Three mechanisms keep it honest:

1. **Numbers from data at build time.** `{{fact:stations}}` in a string is
   replaced with the number of live stations in
   `assets/stations/live-stations.json` (digits localised). Add more facts in
   `appFacts()` in `scripts/build-website.mjs`.
2. **The facts register.** `data/app-facts.json` lists each statement that
   rests on the app: `id`, `statement`, `usedIn` (pages and string keys) and
   `appSources` (English locale keys in `src/i18n/locales/en.json`, or file
   paths). The catalogue numbers on How it works (150,072 earthquakes, six
   catalogues) are such a statement, tied to the SQLite catalogue file,
   because there is no light way to read that file at build time.
3. **The lock.** `data/app-facts.lock.json` holds a fingerprint of every app
   source. The jest test (`src/__tests__/website-build.test.ts`) runs
   `node scripts/build-website.mjs --check-facts` and fails when any source
   changed, listing the statements and string keys to review. After
   reviewing them (and editing the site strings if the app now says or does
   something else), run:

   ```sh
   node scripts/build-website.mjs --refresh-facts
   npm run build:site
   ```

When you add a new website statement about the app, add it to
`data/app-facts.json` and refresh the lock.
