# Bumelerze brand assets

## The mark

An off-center epicenter dot with four concentric rings, spaced and thinned
outward — a stylized epicenter/seismograph glyph, redrawn as Bumelerze's own
asset from the "concentric-rings shaking" motif in
`docs/research/design-language.md` §6 (the same family used app-wide for
`FeltReportPill`, `EpicenterMarker`, and the recency pulse). The rings sit
off-center, not as a bullseye, so the mark reads as a map epicenter marker
rather than a plain target — and so it's visually distinct from LastQuake's
centered ring icon and Rasathane's icon at a glance, per this task's
distinctness requirement. It carries no text (Bumelerze in two scripts,
Latin and Sorani Arabic-script, won't render legibly at icon sizes — see the
D5 caveat below) and no color meaning of its own: the same white silhouette
is reused unmodified for the adaptive-icon foreground, the Android
themed/monochrome icon, the notification icon, and the splash centerpiece,
so "what this shape means" never gets confused with the app's actual
severity color language (magnitude/intensity tokens, §3.2 of the design
language — this mark is brand chrome, not a data visualization).

## Regeneration

Everything is generated from `scripts/generate-assets.js`, which reads the
brand hue live from `src/theme/palette.ts` (`brand.primaryLight` /
`brand.primaryDark`) — there is no hand-copied hex anywhere else in this
pipeline. One command regenerates the full set:

```sh
export PATH="/opt/homebrew/bin:$PATH"   # ensure node/npm are on PATH
node scripts/generate-assets.js         # or: npm run generate:assets
```

This writes/overwrites:

| File | Purpose |
|---|---|
| `assets/brand/icon.svg` | Master mark, opaque brand-color field (source for `icon.png`, `favicon.png`) |
| `assets/brand/mark.svg` | Mark only, transparent field (source for the adaptive-icon foreground, monochrome icon, notification icon, splash icon) |
| `assets/images/icon.png` | 1024×1024, **opaque** — iOS app icon |
| `assets/images/android-icon-foreground.png` | 1024×1024, transparent — Android adaptive-icon foreground, on `adaptiveIcon.backgroundColor` |
| `assets/images/android-icon-monochrome.png` | 432×432, transparent, pure white — Android 13+ themed icon |
| `assets/images/notification-icon.png` | 96×96, transparent, pure white — Android status-bar notification icon |
| `assets/images/splash-icon.png` | 512×512, transparent — splash centerpiece, composited on `expo-splash-screen`'s `backgroundColor`/`dark.backgroundColor` |
| `assets/images/favicon.png` | 48×48, opaque — Expo web preview favicon |

Tooling: rasterized with [`sharp`](https://sharp.pixelplumbing.com/) (Node
bindings around libvips/resvg), a devDependency of this repo — chosen over
`rsvg-convert`/ImageMagick because it needed no system package install and
gives the script direct access to raw pixel buffers for the validation
checks below, without a second CLI round-trip. No image-generation model is
used anywhere in this pipeline: every pixel comes from the SVG circle/rect
paths in the script.

The script **fails loudly** rather than writing a bad asset if:

- any ring stroke is thinner than 2% of canvas width (the task's icon-artwork
  legibility floor),
- the mark's outer edge would fall outside the Android adaptive-icon safe
  zone (the central 66%-diameter circle every launcher mask guarantees is
  visible),
- `icon.png`/`favicon.png` end up with an alpha channel (iOS icon must be
  opaque),
- any "transparent" output ends up without alpha, or
- any opaque/anti-aliased pixel in the notification or monochrome icon isn't
  pure white (Android renders anything else as solid black in the status
  bar).

## Owner-review note on the brand hue

`brand.primaryLight` (`#1F4E5F`, "Zagros Blue") and `brand.primaryDark`
(`#3E7C93`) in `src/theme/palette.ts` are **explicitly flagged owner-review**
(design-language.md §3 / "Handoff notes") — not yet a final, locked brand
color. This mark was deliberately built so that changing the hue is a
one-command regeneration (`node scripts/generate-assets.js`), not a redesign:
the geometry, script, and validation are all hue-independent. When Peshawa
confirms the final blue, update `palette.ts`, rerun the script, and commit
the new PNGs — nothing else in this directory needs to change.

## D5 caveat: the name may change

Per `docs/decisions.md` D5, "Bumelerze" is a working-title-final name that
may change before release. This mark carries no wordmark or lettering
anywhere — it was designed to be **name-independent**: if the app is
renamed, none of these assets need to be touched or regenerated on that
account.
