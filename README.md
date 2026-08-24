# Bumelerze

**Bumelerze** (Kurdish *bûmelerze*, earthquake) is a Kurdish-first earthquake
monitoring and felt-reporting app for the Kurdistan Region of Iraq. It shows
what just shook, lets people say what they felt, and turns those reports back
into usable intensity data. It is built for a region that gets shaken regularly
and is not well served by the existing apps.

**Website:** <https://bumelerze.com> · **App:** <https://bumelerze.com/app> ·
**Contact:** <hello@bumelerze.com>

> **Status: in development.** This is not a finished release. The web build at
> the link above is the current preview channel; native iOS and Android builds
> are pending. Expect rough edges, and expect things to change.

## What it does

- **Live multi-source feed.** Events from USGS, EMSC, and GEOFON, merged and
  deduplicated into one internal event model rather than three competing lists.
  A regional view for Kurdistan and the Zagros margin, plus a world view.
- **One-tap felt reports.** A three-window flow built around commissioned
  intensity artwork rather than a wall of questions: pick the picture that looks
  like what you felt, add building damage if there was any, send. It works
  offline and queues.
- **Crowdsourced detection.** When enough people report shaking with no event in
  any feed yet, the backend raises a "possible event", the way EMSC's LastQuake
  does. Small local earthquakes are often felt before any agency publishes them.
- **Own-computed SHAKEmaps.** For regional events, the project computes its own
  ground-motion and intensity fields instead of waiting for a USGS product that
  may never arrive for a M4.5 in Iraq.
- **Safety guidance.** What to do during and after an earthquake, written for
  the local building stock, not translated boilerplate.
- **Offline regional catalog.** About 21,000 historical events for the region,
  bundled with the app so it stays useful with no network.
- **Four languages, properly.** Sorani Kurdish (Arabic script, right-to-left),
  Kurmanji Kurdish (Latin), Arabic, and English. RTL is a first-class layout
  requirement across every screen, not a translation afterthought.

## Where it stands scientifically

- Intensity uses **EMS-98** as the underlying scale, with the felt-report
  artwork built on the IMS-25 illustrated scale, so what a user picks maps onto
  something a seismologist can actually use.
- Felt reports are collected as **the project's own macroseismic data**, not
  forwarded into someone else's system, and aggregated into intensity cells
  server-side.
- **Provenance is recorded, not assumed.** Every catalog entry carries its
  source and its merge history; every computed shakemap product records the
  ground-motion models, the site data, and the distance method that produced it.
- The **engine is separate from the app.** `shake-service/` is a standalone
  Python worker that publishes finished products; the app only consumes them.
  That keeps the science reviewable on its own terms and keeps the app simple.

Where a number is uncertain, the aim is to say so rather than round it into
false confidence. The regional catalog's build report is committed alongside the
data for exactly that reason.

## Repository layout

| Path                | What it is                                                            |
| ------------------- | --------------------------------------------------------------------- |
| `app/`, `src/`      | The Expo (React Native) + TypeScript app: routes, features, i18n, theme |
| `shake-service/`    | Standalone Python SHAKEmap engine and worker, plus the regional catalog |
| `supabase/`         | Postgres migrations, RLS policies, and edge functions                   |
| `website/`          | The static site at bumelerze.com, including the privacy policy          |
| `assets/`           | App icons, brand marks, and the commissioned illustration set           |

## Running it

Requires Node and npm. From the repository root:

```bash
npm install
npm start          # Expo dev server (then npm run ios / npm run android / npm run web)
npm run typecheck  # tsc --noEmit
npm run lint
npm test
```

To produce the web build that gets deployed:

```bash
npx expo export --platform web --output-dir pages-dist/app
```

The `shake-service/` worker is a separate Python package with its own
environment and its own README; it is not needed to run the app.

## Contributing

Issues and pull requests are welcome, and so is a plain email if that is easier.

**Translations especially.** The Sorani, Kurmanji, and Arabic strings live in
`src/i18n/locales/` and would genuinely benefit from native speakers reading
them critically, particularly the safety guidance and the felt-report wording,
where a slightly-off phrase costs real clarity at the worst possible moment.

Reports of things being wrong are useful too: a misplaced city name, an
intensity description that does not match how people actually talk about
shaking, a screen that breaks in RTL.

## Licensing

The repository is not under a single licence:

- **App, website, and database code:** Apache-2.0 ([`LICENSE`](LICENSE))
- **`shake-service/`:** AGPL-3.0-or-later, because it builds on the OpenQuake
  Engine ([`shake-service/LICENSE`](shake-service/LICENSE))
- **Illustrations, icon, logo, and the name:** all rights reserved, not covered
  by the code licence
- **Data:** varies by source, listed in [`DATA-SOURCES.md`](DATA-SOURCES.md)

The plain-language explanation of all of it, including what a fork may and may
not carry over, is in [`LICENSING.md`](LICENSING.md).

## Contact

Peshawa L. Hasan · <hello@bumelerze.com>
