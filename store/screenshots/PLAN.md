# Screenshot plan

**Status:** planning doc only — no screenshots exist yet. Actual capture happens
**after** the MapLibre dev-build session (PROJECT.md "Next: MapLibre interactive
map (needs dev build)") produces a real device/simulator build; screenshotting
today's Expo-Go build would miss the map tab and lock in throwaway images.
This doc exists now so capture is a checklist item, not a design decision, once
that build exists.

## The 8 shots (screen → route → why it's in the set)

| # | Screen | Route | Why it's here |
|---|---|---|---|
| 1 | Home feed, Sorani | `app/(tabs)/index.tsx` | The first thing every user sees; region-first feed is the core value prop — leads the set. |
| 2 | Event detail + shakemap, Halabja event | `app/event/[id].tsx` (+ `ShakeMapSection`) | The single most differentiating feature (own shakemaps, not reposted USGS/EMSC) — use the Halabja-border event since it's the one shakemap output already web-verified against real data (PROJECT.md Phase 1 status), so the screenshot shows something scientifically real, not a placeholder. |
| 3 | Felt-report tier 1 | `app/felt-report/index.tsx` / `step/[step].tsx` | The one-tap "did you feel it?" cartoon picker — the community-data feature, and the app's most panic-time-relevant screen. |
| 4 | Catalog with filters | `app/catalog.tsx` | Shows depth (regional catalog, not just a live-feed toy) and the filter UI for the P3 (researcher) persona. |
| 5 | Safety guidance | `app/(tabs)/safety.tsx` | Before/during/after content — the "why this app matters beyond curiosity" screen. |
| 6 | Sensor (live seismometer) | `app/(tabs)/sensor.tsx` | Novel, hard-to-fake feature (real accelerometer trace) — good differentiator shot, no other regional app has this. |
| 7 | Handbook | `app/handbook.tsx` | Engineering/researcher-depth content (P3 persona, coordinate → design PGA) — signals scientific seriousness to reviewers and power users. |
| 8 | Historical view | `app/historical.tsx` | Kurdistan's own seismic history (Halabja 2017, Chamchamal 1958, etc.) — reinforces "built by people who know this region," ties to the trust story in the listing description. |

This order is also the recommended store-gallery order (first 2-3 images matter
most for conversion on both stores — lead with the feed + the shakemap, the two
strongest "this is real and different" signals).

## Device sizes required per store

**Apple App Store Connect** requires screenshots per device-size class it still
accepts uploads for (exact list depends on the certificate at submission time —
**[VERIFY AT SUBMISSION]**, Apple periodically retires older required sizes).
As of current guidance, plan to capture:
- **6.9" / 6.7" display** (iPhone 16 Pro Max / 15 Pro Max class) — required.
- **6.5" display** (iPhone 11 Pro Max / XS Max class) — still commonly required
  for back-compatibility with older active listings; confirm at submission.
- **12.9" iPad Pro** — only required if `supportsTablet: true` stays set in
  `app.config.ts` (it currently is) and the app is submitted as a universal
  iOS app rather than iPhone-only; confirm this scope decision before capture.

Apple accepts capturing on the largest required size and letting App Store
Connect down-scale for smaller device classes in the same size family, which
is the practical approach for a solo pipeline — capture once at the largest
required size per family, not once per literal device model.

**Google Play Console** requires:
- **Phone screenshots** — minimum 2, up to 8; 16:9 or 9:16 aspect, JPEG/PNG,
  min dimension 320px, max 3840px. All 8 shots above fit this in portrait.
- **Feature graphic** — 1024×500, a separate marketing banner (not one of the
  8 screenshots; not designed yet — flag as a follow-up task, not scope here).
- **Tablet screenshots** — optional but recommended if `supportsTablet` stays
  true; same 8-shot set re-captured on a 7"/10" tablet class if pursued.

## RTL and locale considerations

- **Show ckb (Sorani, RTL) as the primary screenshot set** — this matches the
  Kurdish-first identity (PROJECT.md hard requirement, D12 language strategy)
  and is the language the app defaults to for the target market. Every layout
  in the 8-shot list must be verified RTL-correct before capture (PROJECT.md
  gotcha: "test RTL on every UI change" — screenshot capture is exactly the
  moment that check is cheapest to redo, since the build is already up).
- **Capture one English variant of the full 8-shot set** for the `en.md`
  listing and for any storefront-locale slot that falls back to English
  (see `store/listing/README.md`'s store-locale-mapping section — Apple has no
  Kurdish locale slot, so an English (or Arabic-slotted Sorani) set is what
  most Apple storefronts will actually show).
- kmr/ar screenshot sets are **not planned as a third and fourth full capture
  pass** — recapturing 8 shots × 4 locales is a lot of solo-dev overhead for
  marginal conversion gain over the ckb+en pair. If Play Console's locale
  picker (per the README) does expose a genuine Kurmanji slot with its own
  screenshot requirement, reuse the ckb captures with just the on-screen text
  swapped, not a full re-shoot — most of these screens are numbers/maps/icons
  with a thin text layer, not text-heavy content.
- Status bar / clock / battery in every capture should be normalized (Apple
  and Google both flag or reject screenshots with real personal notification
  content or an obviously fake/inconsistent status bar) — use the simulator's
  default demo status bar or a clean fixed time, not a live device capture.
- No text overlays/marketing captions burned into the images for v1 — plain
  device-frame screenshots of real app state. Revisit captioned screenshots
  (a common conversion-rate improvement) as a v1.x polish item once real users
  exist to learn from, not as a blocker for first submission.

## What happens next (not part of this doc's scope)

1. MapLibre dev-build session lands (blocked item, PROJECT.md).
2. Seed the app with the Halabja event data + a realistic feed state (not an
   empty/loading screen) before capturing shot #1 and #2.
3. Capture the 16-shot set (8 × ckb, 8 × en) on the required device
   size classes above.
4. Design the Play feature graphic (1024×500) — separate small task.
5. Drop finished PNGs into this folder (`store/screenshots/<locale>/<n>-<screen>.png`)
   and update this doc's status line from "planning doc only" to "captured
   <date>".
