# Bumelerze website

Pure static site for **bumelerze.com** — no build step, no frameworks, no
JavaScript. Every file in this folder is served exactly as-is, so any static
host works (Cloudflare Pages, Netlify, GitHub Pages). All links are
**relative**, so the site works from a domain root *or* a subdirectory.

## Current state (2026-08)

**The site is live at <https://bumelerze.com>**, deployed by GitHub Pages on
every push to `main` (`.github/workflows/deploy-pages.yml` — website at the
domain root, the app's web build under `/app`). The Netlify configuration
(`netlify.toml` at the repo root) is retained as a dormant mirror and is not
the live deploy path. Public contact address: `hello@bumelerze.com`. The
Cloudflare Pages instructions below predate this setup and are kept only as a
fallback deploy recipe.

## What's in here

| Path | What it is |
|---|---|
| `index.html`, `privacy.html`, `support.html` | English pages (site default, per D12 English-first) |
| `ckb/` | Sorani Kurdish (RTL) — same three pages |
| `kmr/` | Kurmanji Kurdish — same three pages |
| `ar/` | Arabic (RTL) — same three pages |
| `style.css` | The one shared stylesheet (dark-first surfaces; brand accent colors from the logo package) |
| `brand/` | Copies of the official logo package's horizontal logo (light + dark-background versions) and favicon artwork; see its own README note below |
| `favicon.ico` | Multi-size ICO, browsers request this from the site root by convention regardless of page depth |

Site weight is still small: a shared stylesheet, a handful of SVG/PNG brand
files (a few hundred KB total, mostly the two horizontal-logo SVGs and the
favicon set), system fonts only, no JavaScript, no frameworks.

Every page's `<header>` shows the real horizontal logo
(`brand/bumelerze-primary-horizontal.svg`), swapped for the ivory
"reversed" version (`brand/bumelerze-primary-horizontal-reversed.svg`) on
dark-mode visits via a `<picture>`/`prefers-color-scheme` source, exactly
per the logo package's own guidance for dark backgrounds. The logo image is
never mirrored on the RTL pages (ckb, ar): a wordmark is not a directional
icon.

## How to deploy (Cloudflare Pages, drag-and-drop — ~5 minutes)

You do not need Git, Node, or a terminal for this.

1. Go to <https://dash.cloudflare.com> and sign in (create a free account if
   needed — the free tier is more than enough forever for this site).
2. In the left sidebar choose **Workers & Pages** → **Create** → pick the
   **Pages** tab → **Upload assets** (the "Direct Upload" option).
3. Give the project a name, e.g. `bumelerze` (this becomes the temporary
   address `bumelerze.pages.dev`).
4. Drag the **contents of this `website/` folder** (not the folder itself —
   `index.html` must end up at the top level) into the upload box, or zip the
   contents and upload the zip.
5. Click **Deploy site**. Done — the site is live at
   `https://<project-name>.pages.dev` within a minute. Open it and check the
   four languages switch correctly.

To update the site later: same place → your project → **Create new
deployment** → drag the files again.

### Pointing the real domain at it (after registering bumelerze.com)

1. Register `bumelerze.com` at any registrar. Easiest path: register it (or
   transfer it) at **Cloudflare Registrar** itself — then step 3 is automatic.
2. In the Pages project, open **Custom domains** → **Set up a custom domain**
   → type `bumelerze.com` → follow the prompts. Repeat for `www.bumelerze.com`
   if you want the `www` form to work too.
3. If the domain is registered at Cloudflare, it wires up the DNS records
   itself and the site is on the real domain within minutes. If the domain is
   registered elsewhere, Cloudflare shows you a CNAME record to add in the
   registrar's DNS settings — copy it exactly, and allow up to a day for it to
   take effect (usually much faster).
4. HTTPS certificates are automatic — nothing to configure.

The same folder also works on Netlify ("Deploy manually" drag-and-drop at
<https://app.netlify.com/drop>) or GitHub Pages, if Cloudflare is ever a
problem.

## What to update when things go live

- **Store links exist** → in all 4 `index.html` files, replace the two
  `<span class="store-badge">… Coming soon …</span>` placeholders with real
  `<a href="…">` links to the App Store / Google Play listings.
- ~~**Domain + email live**~~ → done (2026-08): the pending-domain note
  paragraphs are removed from all 12 HTML files and every contact link points
  at the live `hello@bumelerze.com` address.
- **Supabase backend goes live** → the privacy policy MUST be revised first
  (all 4 locales): felt reports + device ID + location will then leave the
  device. The policy text already announces this future change; rewrite the
  "Where your data goes" / "Deleting your data" / telemetry sections to the
  then-true state and bump the effective date. Source of truth:
  `store/listing/README.md` → "Privacy / data-safety summary".
- **Native review** → all ckb / kmr / ar pages are machine-draft translations,
  marked with `<!-- translation: draft-machine, pending native review -->` at
  the top of each file (same convention as `src/i18n/locales/*.json`). Have a
  native speaker review them before promoting the site widely, and remove the
  marker comment when done.
- **Effective date / owner review** → each `privacy.html` carries a
  `<!-- DRAFT — pending owner (Peshawa) review -->` comment; remove it once
  you have read and approved the policy text.
