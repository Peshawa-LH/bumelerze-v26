# Bumelerze website

Static site for **bumelerze.com**, served exactly as it sits in this folder:
no framework, no runtime build, no trackers, and nothing on any page needs
JavaScript to be read. All links are relative, so the folder works from a
domain root or a subdirectory.

**The HTML here is generated. Do not edit `*.html`, `sitemap.xml` or
`robots.txt` by hand:** edit `website-src/` and run `npm run build:site`
from the repo root, then commit both. A jest test
(`src/__tests__/website-build.test.ts`) fails when the committed pages no
longer match a fresh render. `style.css` and `site.js` are hand-written and
live here; the build stamps their content hash into every page
(`style.css?v=...`), so change them, then rebuild.

## Current state (2026-10 redesign)

Live at <https://bumelerze.com>, deployed by GitHub Pages on every push to
`main` (`.github/workflows/deploy-pages.yml`: website at the domain root,
the app's web build under `/app`). Netlify (`netlify.toml`) is a dormant
mirror. Contact: `hello@bumelerze.com`, `dev@bumelerze.com`.

The 2026-10 redesign rebuilt the home page as a short, figure-led tour in
three acts (when the ground shakes / prepare ahead of time / explore the
data), added an About page with the official channels and how to spot a
fake, and moved every page onto one template with four strings files. The
English copy comes from the outreach brief; ckb, kmr and ar are machine
drafts pending native review, and every page in those languages carries
`<!-- translation: draft-machine, pending native review -->`.

## Pages

| Page | Source |
|---|---|
| `index.html` | `website-src/pages/index.html`, all text from `website-src/strings/<lang>.json` |
| `about.html` | `website-src/pages/about.html`, text from the strings files |
| `handbook.html` | per-language body in `website-src/pages/handbook/<lang>.html` (content and inline SVGs kept from the earlier site) |
| `support.html`, `privacy.html` | per-language body in `website-src/pages/<page>/<lang>.html` |

Each exists at the root (English) and under `ckb/` (Sorani, RTL), `kmr/`
(Kurmanji) and `ar/` (Arabic, RTL). Head, header, footer and the sitemap,
canonical, hreflang and Open Graph tags come from `website-src/partials/`
and the build script. See `website-src/README.md` for the template syntax.

## What's in here

| Path | What it is |
|---|---|
| `style.css` | The one stylesheet: tokens, the measured contrast table (comment at the top), every component. Logical properties throughout, so RTL needs no second stylesheet. |
| `site.js` | The one script (deferred, no dependencies): closes the language menu, draws the seismic line in, fills the live "latest earthquake" card, runs the felt-picture demo and the waveform. All progressive enhancement; honours `prefers-reduced-motion`. |
| `fonts/` | Vazirmatn 400 and 700, subset to Latin, Latin Extended-A and Arabic (Sorani letters included) as WOFF2, about 39 KB each. Licence: `OFL-Vazirmatn.txt`. |
| `img/` | Every image the pages use, resized and compressed. **Generated** by `npm run build:site-assets` (see below). |
| `og-image.jpg` | The 1200x630 social preview image. |
| `brand/`, `brand-v2/`, `brand-beta/`, `favicon.ico` | Logo and favicons. `brand/` and `favicon.ico` are **generated** by `node scripts/generate-assets.js` from whichever of `brand-v2/` or `brand-beta/` is active (`ACTIVE_BRAND_RELEASE`). The wordmark is never mirrored on RTL pages. |

### The live card

The home page asks USGS and EMSC (the public FDSN event services, the same
ones the app reads) for the newest earthquake of magnitude 3 or more inside
the app's region box (`REGION_BBOX` in `src/features/events/config.ts`) over
the last 180 days, with a 7-second timeout. When both answer with the same
quake (16 s, 50 km) the USGS record wins, as in the app. The place line uses
the app's own wording ("81 km N of Urmia") and town names, from
`website-src/data/places.json` (refresh it from the app's gazetteer with
`node scripts/build-website.mjs --sync-app-data`). The card links to
`/app/event/<id>`. If the feeds fail, the card shows a one-line fallback.

### Images

`npm run build:site-assets` resizes the felt cartoons (levels 01 to 06 only)
and six correct-advice safety pictures from `assets/artwork/`. With
`-- --external <dir>` it also takes the figures and app screenshots that are
produced outside this repository (`<dir>/figures`, `<dir>/screens`): the
cast compositions, the catalogue and SHAKEmap figures, the
vulnerability-class bar, the OG image, the seismic-line and skyline SVGs
(copied into `website-src/partials/svg/` for inlining), and one screenshot
per phone frame per language (`SITE_SCREENS` in the script: home, home-dark,
safe, hub). To show another app screen in a phone frame, add it to
`SITE_SCREENS`, rerun, and change the name in
`website-src/pages/index.html` (`{{>phone <screen> <alt-key>}}`).

Rules the scripts and the test enforce: no felt cartoon above level 6, no
`safety-dont-*` image, and no felt-picker screenshot (it shows levels 10 to
12).

### Weight

Measured 2026-10-09 (gzip for text, Chromium): the home page's first view on
a 390 px phone at 3x is about 365 KB in 17 requests (HTML, CSS, script, two
font files, the cast picture and the images the browser fetches early
because they sit just below the fold). With every image loaded it is about
615 KB. All images carry width and height, so the layout does not shift
(CLS under 0.01).

## How to deploy (Cloudflare Pages, drag-and-drop, about 5 minutes)

You do not need Git, Node, or a terminal for this.

1. Go to <https://dash.cloudflare.com> and sign in (create a free account if
   needed: the free tier is more than enough forever for this site).
2. In the left sidebar choose **Workers & Pages** → **Create** → pick the
   **Pages** tab → **Upload assets** (the "Direct Upload" option).
3. Give the project a name, e.g. `bumelerze` (this becomes the temporary
   address `bumelerze.pages.dev`).
4. Drag the **contents of this `website/` folder** (not the folder itself:
   `index.html` must end up at the top level) into the upload box, or zip the
   contents and upload the zip.
5. Click **Deploy site**. Done: the site is live at
   `https://<project-name>.pages.dev` within a minute. Open it and check the
   four languages switch correctly.

To update the site later: same place → your project → **Create new
deployment** → drag the files again.

### Pointing the real domain at it (after registering bumelerze.com)

1. Register `bumelerze.com` at any registrar. Easiest path: register it (or
   transfer it) at **Cloudflare Registrar** itself, then step 3 is automatic.
2. In the Pages project, open **Custom domains** → **Set up a custom domain**
   → type `bumelerze.com` → follow the prompts. Repeat for `www.bumelerze.com`
   if you want the `www` form to work too.
3. If the domain is registered at Cloudflare, it wires up the DNS records
   itself and the site is on the real domain within minutes. If the domain is
   registered elsewhere, Cloudflare shows you a CNAME record to add in the
   registrar's DNS settings: copy it exactly, and allow up to a day for it to
   take effect (usually much faster).
4. HTTPS certificates are automatic: nothing to configure.

The same folder also works on Netlify ("Deploy manually" drag-and-drop at
<https://app.netlify.com/drop>) or GitHub Pages, if Cloudflare is ever a
problem.

## What to update when things go live

- **Drop the Beta identity** → set `ACTIVE_BRAND_RELEASE = "v2"` in
  `scripts/generate-assets.js` and re-run it. Regenerates the app icon,
  favicon, this site's header/footer wordmark, and the Play Store hi-res
  icon in one pass; no HTML edits needed. See `assets/brand/README.md`
  "Beta vs v2.0".
- **Native apps publish** → the closing section of the home page points only
  at the web app (`https://bumelerze.com/app`) and says native apps come next
  (`get.line`); add real store links there once they exist rather than a
  placeholder badge, and update `about.fake_tip1` (not in any store yet).
- **Alerts go live** → remove the "Alerts: coming soon" pill (`get.alerts_tag`).
- **Numbers that move** (150,072 events, 37 stations, 15 safety cards) live in
  the strings files; re-check them before a deploy.
- ~~**Domain + email live**~~ → done (2026-08): the pending-domain note
  paragraphs are removed from all HTML files and every contact link points
  at the live `hello@bumelerze.com` address.
- ~~**Supabase backend goes live**~~ → done (2026-08-18): all four
  `privacy.html` locales and both `support.html` "How do I delete my data"
  FAQ entries were rewritten to match the live backend (felt reports, photos,
  and comments are transmitted to and stored in Bumelerze's own Supabase
  project, not device-only; see the header comment in each `privacy.html`
  for exactly what was verified and where). If data practices change again,
  update those sections and bump each page's effective date.
- **Native review** → all ckb / kmr / ar pages are machine-draft translations,
  marked with `<!-- translation: draft-machine, pending native review -->` at
  the top of each file (same convention as `src/i18n/locales/*.json`). Have a
  native speaker review `website-src/strings/{ckb,kmr,ar}.json` and the
  per-language bodies, then drop the marker in `scripts/build-website.mjs`.
- **Effective date / owner review** → each `privacy.html` carries a
  `<!-- DRAFT: pending owner (Peshawa) review -->` comment; remove it once
  you have read and approved the policy text.
