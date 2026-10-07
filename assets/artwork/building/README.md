# Building questionnaire pictograms

24 single-colour line pictograms for the "Tag my building" questionnaire
(structure type, plan shape, photo slots). Hand-built SVG, no text or letters.

Conventions: `viewBox="0 0 64 64"`, uniform `stroke-width="3"` with round caps
and joins, `stroke="currentColor"`, `fill="none"`. Secondary detail uses
`stroke-opacity=".55"` and soft fills use `fill-opacity=".2"`, both on
`currentColor`, so one tint colour drives the whole drawing. Transparent
background. Keep the safe 4-unit margin when scaling.

Render with `react-native-svg` (`SvgXml` with the file contents and
`color={tint}`; `width`/`height` of 48 or more) or `<img>` on web with a
CSS-mask/inline SVG. Do not rely on `expo-image` `tintColor` for these.

| Group | Files |
| ----- | ----- |
| Structure | `structure-frame`, `-block-walls`, `-brick-walls`, `-stone-walls`, `-mud-walls`, `-steel-frame`, `-wood`, `-corner-column`, `-dont-know` |
| Plan shape | `shape-rectangle`, `-wing`, `-overhang`, `-dont-know` |
| Photo slots | `photo-front`, `-back`, `-left`, `-right`, `-ground-floor`, `-roof`, `-column-wall`, `-ceiling`, `-cracks`, `-basement`, `-add-more` |

Master sources and the generator live in the artwork package
(`building-questionnaire/`); edit there and re-export.
