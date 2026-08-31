# Bumelerze website

Pure static site for **bumelerze.com**: no build step, no frameworks, and no
JavaScript required to use it (a small progressive-enhancement script powers
the homepage hero slider; see below). Every file in this folder is served
exactly as-is, so any static host works (Cloudflare Pages, Netlify, GitHub
Pages). All links are **relative**, so the site works from a domain root *or*
a subdirectory.

## Current state (2026-08)

**The site is live at <https://bumelerze.com>**, deployed by GitHub Pages on
every push to `main` (`.github/workflows/deploy-pages.yml`: website at the
domain root, the app's web build under `/app`). The Netlify configuration
(`netlify.toml` at the repo root) is retained as a dormant mirror and is not
the live deploy path. Public contact address: `hello@bumelerze.com`. The
Cloudflare Pages instructions below predate this setup and are kept only as a
fallback deploy recipe.

The 2026-08-18 redesign moved the site from a dark-first, generic-gray theme
to a white-based, brand-true design built directly from the owner's logo
package tokens (Signal Red, Warm Ivory, Endpoint Gold, Wordmark Ink, Approved
Navy). Dark mode still exists, rebuilt on the brand's own Approved Navy
rather than arbitrary near-black grays, so both themes read as the same
product. Full rationale, every measured contrast pair, and the token
definitions live in the long comment at the top of `style.css`.

## What's in here

| Path | What it is |
|---|---|
| `index.html` | English homepage: hero with a slider, feature grid, how-the-science-works, open-data, who-it's-for, and get-the-app sections |
| `handbook.html` | English page for the Engineer's handbook: what it is, the three standards it works in, and the report it produces. Conceptual, no code values on it; the tool itself lives in the app at `/app` |
| `privacy.html`, `support.html` | English privacy policy and support/FAQ pages |
| `ckb/` | Sorani Kurdish (RTL), the same four pages |
| `kmr/` | Kurmanji Kurdish, the same four pages |
| `ar/` | Arabic (RTL), the same four pages |
| `style.css` | The one shared stylesheet: tokens, contrast notes, every component |
| `slider.js` | Progressive-enhancement script for the homepage hero slider only; deferred, no dependency, no autoplay ever (see the design-decision comment in `style.css`) |
| `images/` | Optimized WebP illustrations used in the hero slider, resized and re-compressed from the commissioned artwork package, which lives outside this repository (not hotlinked into it) |
| `brand/` | **Generated.** The horizontal logo (light + dark-background versions), the symbol-only mark, and favicon artwork, copied from whichever of `brand-v2/` or `brand-beta/` is active. Do not hand-edit; re-run `node scripts/generate-assets.js` from the repo root instead. |
| `brand-v2/` | Source: the plain, unlabeled v2.0 identity's copies of the same files (preserved so dropping Beta at launch needs no re-import) |
| `brand-beta/` | Source: the Beta identity's copies (BETA release-band wordmark, favicon) — current default, added 2026-08-29 |
| `favicon.ico` | **Generated**, same switch as `brand/`. Multi-size ICO, browsers request this from the site root by convention regardless of page depth |

Site weight: a shared stylesheet, a tiny slider script, three ~20 to 35 KB
WebP illustrations plus two logo SVGs, system fonts only (no web font
download), no frameworks. The homepage is the heaviest page at roughly
120 KB estimated over-the-wire (gzip'd text plus already-compressed images);
every other page is under 10 KB of markup on top of the same shared,
cacheable CSS/logo/favicon assets.

Every page's `<header>` shows the real horizontal logo
(`brand/bumelerze-primary-horizontal.svg`), swapped for the ivory "reversed"
version (`brand/bumelerze-primary-horizontal-reversed.svg`) on dark-mode
visits via a `<picture>`/`prefers-color-scheme` source, exactly per the logo
package's own guidance for dark backgrounds. The footer always shows the
reversed logo on its own fixed Approved Navy background, regardless of
theme. The logo image is never mirrored on the RTL pages (ckb, ar): a
wordmark is not a directional icon.

None of the 16 HTML pages reference "beta" or "v2" anywhere — they always
point at the fixed filenames under `brand/`. Which identity actually shows up
there is controlled from exactly one place, `ACTIVE_BRAND_RELEASE` in
`scripts/generate-assets.js` (see `assets/brand/README.md` "Beta vs
v2.0"), which also drives the app's own icon/favicon and the Play Store
hi-res icon — flip that one constant and re-run the script to change all of
them together.

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
- **Native apps publish** → the "Get Bumelerze" section on each `index.html`
  currently points only at the web app (`https://bumelerze.com/app`) and
  says native iOS/Android apps are next; add real store links there once they
  exist rather than a placeholder badge.
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
  native speaker review them before promoting the site widely, and remove the
  marker comment when done.
- **Effective date / owner review** → each `privacy.html` carries a
  `<!-- DRAFT: pending owner (Peshawa) review -->` comment; remove it once
  you have read and approved the policy text.
