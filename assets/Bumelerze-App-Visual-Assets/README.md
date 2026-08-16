# Bumelerze App Visual Assets

This folder is the complete handoff package for the Bumelerze earthquake app.

## What is final

- `01-Characters/` contains the 10 approved full-resolution character cutouts.
- `02-Intensity-Levels/` contains the 12 approved IMS intensity illustrations.
- `03-Building-Damage/` contains the two approved five-grade building-damage sequences.
- `04-Previews/` contains light- and dark-background review sheets. Preview sheets are not production assets.
- `05-App-Ready/` contains resized PNG and WebP files ready for app integration.
- `06-Reference/` contains the production brief and IMS-25 source reference for future revisions.

The 32 master production images are 1254 x 1254 RGBA PNGs with transparent backgrounds. They are the canonical source files.

## App-ready formats

### Visual tiles

Use the 22 files under `05-App-Ready/Visuals/`:

- `PNG-512/` or `WebP-512/` for high-density displays and larger cards.
- `PNG-120/` or `WebP-120/` for direct 120 x 120 tile use.

The intensity files must remain ordered from `level-01` through `level-12`. The IMS damage grades progress from `01` / DG1 (no visible damage) through `05` / DG5 (partial collapse).

### Character elements

Use the 512 px transparent cutouts under `05-App-Ready/Characters/` for layouts that do not require the full 1254 px masters.

## Integration files

- `asset-manifest.json` provides IDs, labels, ordering, and relative paths for every asset and runtime variant.
- `asset-catalog.csv` is the same mapping in spreadsheet-friendly form.
- `SHA256SUMS.txt` can be used to verify that copied or downloaded files are unchanged.

## Rendering notes

- Composite the assets over the app's tile background; do not flatten them onto white.
- The illustrations were checked on both near-white and near-black backgrounds.
- No labels or numerals are baked into the artwork. The application should supply all localized text.
- Do not use the preview sheets as image sources.
- JPEG is intentionally excluded because it does not preserve transparency.
- SVG is intentionally excluded because these illustrations are raster artwork rather than vector masters.
