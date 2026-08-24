# App artwork

The illustration files this app actually bundles, and nothing else.

| Folder | What | Used by |
| ------ | ---- | ------- |
| `felt/` | 12 IMS-25 intensity cartoons (`level-01..12`) and 10 building-damage tiles (`damage-{lowrise,highrise}-01..05`) | the three-window felt-report flow, `src/features/felt/artwork.ts` |
| `safety/` | 18 safety illustrations | the safety guides, `src/features/safety/artwork.ts` |

All WebP-512: lossless, decoded natively by `expo-image` on both platforms,
and roughly 30% smaller than the PNG set at the same resolution. That matters
because a low-end Android phone is the baseline device.

## Where the originals live

These 40 files are a **subset**. The full commissioned package (character
sheets, source PNGs, previews, reference material, validation reports and
checksums) is internal design material and no longer lives in this
repository. It sits in the project's working folder:

```
BumelerzeApp/Bumelerze_illustration_Artworks/Bumelerze-App-Visual-Assets/
```

That package remains the canonical source. To add or replace an image here,
export it from there rather than editing these files, and add a matching
`require()` in the relevant `artwork.ts` (Metro only bundles `require()`
calls whose argument is a plain string literal, so the paths are written out
by hand rather than generated).

## Licence

All rights reserved, like the rest of the artwork. See `LICENSING.md` at the
repository root. These files are bundled with the app; they are not offered
for reuse.
