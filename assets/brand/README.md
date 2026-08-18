# Bumelerze brand assets

## The mark

The Bumelerze mark is the owner's finished logo system, delivered as
`assets/Bumelerze-App-Visual-Assets/08-Logo_Package/`. **That package is
the source of truth**, not this directory. It is a two-peak Zagros mountain
profile flowing into a seismic waveform (seismogram/P-wave trace), ending in
a small gold endpoint dot representing a reported observation: "a signal
moving from terrain to measurable community data" (the package's own
`Brand-Info/brand-guidelines.md`). It replaces the earlier "concentric
rings" placeholder mark that shipped before the logo package existed.

This directory (`assets/brand/`) holds only two **generated** intermediate
SVGs that don't exist pre-made in the logo package, the safe-zone-fitted
mark used for the Android adaptive-icon layers, kept here for easy
inspection:

| File | Purpose |
|---|---|
| `adaptive-icon-mark.svg` | Ivory mark + gold dot, fitted to the Android adaptive-icon safe zone; source for `android-icon-foreground.png` |
| `adaptive-icon-mark-monochrome.svg` | Same fit, pure white; source for `android-icon-monochrome.png` / `notification-icon.png` |

Everything else (colors, wordmark, symbol-only artwork, app icons,
favicons) is read directly from the logo package by
`scripts/generate-assets.js`, never hand-copied into this directory.

## Regeneration

```sh
export PATH="/opt/homebrew/bin:$PATH"   # ensure node/npm are on PATH
node scripts/generate-assets.js         # or: npm run generate:assets
```

This reads `assets/Bumelerze-App-Visual-Assets/08-Logo_Package/SVG/` and
`Design-Tokens/bumelerze-colors.json` and writes/overwrites:

| File | Purpose |
|---|---|
| `assets/brand/adaptive-icon-mark.svg` | see above |
| `assets/brand/adaptive-icon-mark-monochrome.svg` | see above |
| `assets/images/icon.png` | 1024×1024, **opaque**: iOS/generic app icon (full-bleed square icon master) |
| `assets/images/android-icon-foreground.png` | 1024×1024, transparent: Android adaptive-icon foreground, sits on `adaptiveIcon.backgroundColor` (Signal Red, app.config.ts) |
| `assets/images/android-icon-monochrome.png` | 432×432, transparent, pure white: Android 13+ themed icon |
| `assets/images/notification-icon.png` | 96×96, transparent, pure white: Android status-bar notification icon |
| `assets/images/splash-icon.png` | 512×512, transparent (ivory mark + gold dot): splash centerpiece, composited on `expo-splash-screen`'s `backgroundColor` (Signal Red light / Approved Navy dark) |
| `assets/images/favicon.png` | 48×48, opaque: Expo web preview favicon |

Tooling: rasterized with [`sharp`](https://sharp.pixelplumbing.com/) (Node
bindings around libvips/resvg), a devDependency of this repo. No
image-generation model is used anywhere in this pipeline: every pixel comes
from the logo package's own SVG path/circle data, recolored and
safe-zone-fitted by the script, never redrawn.

The script **measures before it fits** rather than trusting hand-picked
numbers: it rasterizes the package's `bumelerze-symbol-color.svg` and scans
the alpha channel for the mark's true pixel bounding box, then scales and
centers that measured box to a target radius inside Android's adaptive-icon
safe zone (the central 66%-diameter circle every launcher mask guarantees
stays visible). After rendering, it re-measures the *actual output pixels*
of the foreground/monochrome/notification PNGs and fails loudly if any
opaque/anti-aliased pixel falls outside that safe zone, so a future change
to the source artwork can never silently ship a clipped icon. It also fails
loudly if:

- `icon.png`/`favicon.png` end up with an alpha channel (the App Store
  rejects an icon with one), or
- any "transparent" output ends up without alpha, or
- any opaque/anti-aliased pixel in the notification or monochrome icon
  isn't pure white (a previously-fixed store-rejection bug: Android
  renders anything else as solid black in the status bar).

## The brand-red-vs-app-red split

The logo's Signal Red (`#C8202F`) reads as almost the same hue as this
app's existing in-product danger/action-red tokens
(`src/theme/palette.ts`'s `actionRed` and `status.danger`, `#C6202D` and
`#C3202B`: a measured WCAG contrast delta of ~1.02 between Signal Red and
`actionRed.light`, i.e. perceptually the same color). In an earthquake app,
red already carries meaning: danger, high intensity, urgency. So this
pipeline deliberately keeps two palettes apart:

- **Brand surfaces**: this directory, `assets/images/icon.png`,
  `splash-icon.png`, `favicon.png`, the website header, and store listing
  assets use the logo package's full palette (Signal Red, Warm Ivory,
  Endpoint Gold, Wordmark Ink, Approved Navy) without restriction. That is
  the brand identity, and it is meant to be recognizable and red.
- **In-product semantic colors**: `intensityRamp`, `damageGradePalette`,
  `actionRed`, and `status.danger` in `src/theme/palette.ts` are untouched
  by this pipeline and by the brand-logo integration that introduced the
  logo package. Those are scientific-scale colors the owner specified
  directly; nothing in `assets/` or `scripts/generate-assets.js` reads or
  writes them.
- **The app's neutral brand accent** (links, the active tab, primary
  buttons: `colors.brand.primary` in `src/theme/semantic.ts`) deliberately
  stayed "Zagros Blue" (`brand.primaryLight`/`primaryDark`,
  `src/theme/palette.ts`) rather than switching to the logo's Signal Red,
  for the same reason: reusing near-danger-red as ordinary chrome would make
  routine interface elements (a link, the active tab) readable as alarms,
  and would blunt the EMS intensity ramp's own use of red at its high end.
  Zagros Blue already has audited WCAG contrast in both themes (see
  `src/theme/__tests__/palette.test.ts` and the doc comments on
  `brand.primaryDark`/`darkColors.brand.onPrimary` in `semantic.ts`) and
  keeps "red means danger" true everywhere in the product. The exact blue
  hex may still be refined later; the decision to stay in the blue family,
  not switch to brand red, is the settled part.

The Android notification `color` tint (`app.config.ts`, `expo-notifications`
plugin) follows the same logic and stays Zagros Blue: an earthquake-alert
notification tinted the logo's red would read as more severe than a routine
"new earthquake near you" update warrants.

## D5 caveat: the name may change

Per `docs/decisions.md` D5, "Bumelerze" is a working-title-final name that
may change before release. The logo package's wordmark spells the name in
plain Latin letters without the "û" circumflex (vector-outlined from Arial
Rounded MT Bold, per the package's own `brand-guidelines.md`: "Do not
retype or stretch the wordmark"); this pipeline does not alter it. The
icon/adaptive-icon/splash/favicon assets this script generates carry no
wordmark at all (symbol only), so they need no rework if the name changes.
