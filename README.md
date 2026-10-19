# Bumelerze

**Bumelerze** (Kurdish _bûmelerze_, earthquake) is a Kurdish-first earthquake
monitoring and felt-reporting app for the Kurdistan Region of Iraq. It shows
what just shook, lets people say what they felt, and turns those reports back
into usable intensity data. It is built for a region that gets shaken regularly
and is not well served by the existing apps.

**Website:** <https://bumelerze.com> · **App:** <https://app.bumelerze.com> ·
**Contact:** <hello@bumelerze.com>

> **Status:** the 26.x web release is live at the link above. Native iOS and
> Android builds are pending.

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
- **Offline regional catalog.** About 150,000 historical events (150,072) from
  six catalogues (ISC 130,153 · KISC 8,130 · Onur 2017 7,364 · EMME 3,544 ·
  USGS 764 · ISC-GEM 117), bundled with the app so it stays useful with no
  network.
- **Accounts and profiles.** Optional accounts with public or private
  profiles, follows and mentions; the feed, felt reports, safety guide and
  catalog work without one.
- **Event hubs.** Regional earthquakes get a hub page where people share what
  they felt, post and comment; moderated by the Bumelerze team.
- **I'm safe.** A one-tap check-in after an earthquake, seen by the people you
  choose (family, mutual follows or followers), never with your location.
- **Tag my building / My home and family.** Describe your building and get an
  automatic estimate of how it may behave in shaking on the IMS-25 scale; family
  members can join the same home.
- **Sensor and live stations.** The phone's accelerometer as a live
  seismometer view (with recording), plus live waveforms from regional
  seismic stations.
- **Engineer's handbook.** Design spectra, site classes and code values for
  engineers.
- **Officials page.** Area-level building and "I'm safe" summaries for
  government officials who are given access.
- **Alerts.** Earthquake alerts are coming soon; they run today only for a
  small group of testers.
- **Four languages, properly.** Sorani Kurdish (Arabic script, right-to-left),
  Kurmanji Kurdish (Latin), Arabic, and English. RTL is a first-class layout
  requirement across every screen, not a translation afterthought.

## Where it stands scientifically

- Intensity uses **IMS-25**, with the felt-report
  artwork built on the IMS-25 illustrated scale, so what a user picks maps onto
  something a seismologist can actually use.
- Felt reports are collected as **the project's own macroseismic data**, not
  forwarded into someone else's system, and aggregated into intensity cells
  server-side.
- **Provenance is recorded, not assumed.** Every catalog entry carries its
  source and its merge history; every computed shakemap product records the
  ground-motion models, the site data, and the distance method that produced it.
- The **engine is separate from the app.** It lives in its own repository,
  `bumelerze-engine`, as a standalone Python worker that publishes finished
  products; this app only consumes them. That keeps the science reviewable on
  its own terms and keeps the app simple.

Where a number is uncertain, the aim is to say so rather than round it into
false confidence. The regional catalog's build report is committed alongside the
data for exactly that reason.

## Repository layout

| Path           | What it is                                                                |
| -------------- | ------------------------------------------------------------------------- |
| `app/`, `src/` | The Expo (React Native) + TypeScript app: routes, features, i18n, theme   |
| `supabase/`    | Postgres migrations, RLS policies, and edge functions                     |
| `website-src/` | The source of the website: page templates and strings in four languages   |
| `website/`     | The static site at bumelerze.com, GENERATED from `website-src/`           |
| `public/`      | Files served as-is with the web app: HTML shell, service worker, map data |
| `scripts/`     | Build and data scripts (web build, website build, assets, datasets)       |
| `store/`       | App Store and Google Play listing texts, checklist and screenshot plan    |
| `assets/`      | App icons, brand marks, and the commissioned illustration set             |

## Running it

Requires Node and npm. From the repository root:

```bash
npm install
npm start          # Expo dev server (then npm run ios / npm run android / npm run web)
npm run typecheck  # tsc --noEmit
npm run lint
npm test
```

To produce the web build that gets deployed (it needs a clean `npm ci`):

```bash
bash scripts/build-app-web.sh
```

It writes `dist-app/`, which Cloudflare Pages (project `bumelerze-app`) builds
and serves from `main` at <https://app.bumelerze.com>.

The SHAKEmap engine and worker live in a separate repository,
`bumelerze-engine`, with their own environment and README. Neither is needed
to run this app: the app reads finished products from the Bumelerze Atlas.

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

This repository is Apache-2.0, but not everything shipped with the project
is:

- **App, website, and database code:** Apache-2.0 ([`LICENSE`](LICENSE))
- **The SHAKEmap engine**, in the separate `bumelerze-engine` repository:
  AGPL-3.0-or-later, because it builds on the OpenQuake Engine
- **Illustrations, icon, logo, and the name:** all rights reserved, not covered
  by the code licence
- **Data:** varies by source, listed in [`DATA-SOURCES.md`](DATA-SOURCES.md)

The plain-language explanation of all of it, including what a fork may and may
not carry over, is in [`LICENSING.md`](LICENSING.md).

## Contact

Peshawa L. Hasan · <hello@bumelerze.com>
