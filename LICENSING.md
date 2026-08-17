# Licensing, in plain language

Bumelerze is not under a single licence. Different parts of this repository come
from different places and carry different obligations, so they are licensed
separately. This page is the map. It is written for people, not lawyers; the
actual licence files are what legally counts.

Short version:

| Part of the repo                       | Licence                | File                                                  |
| -------------------------------------- | ---------------------- | ----------------------------------------------------- |
| The app, website, and database code     | Apache-2.0             | [`LICENSE`](LICENSE)                                  |
| `shake-service/` (the SHAKEmap engine)  | AGPL-3.0-or-later      | [`shake-service/LICENSE`](shake-service/LICENSE)      |
| Illustrations, icon, logo, the name     | All rights reserved    | [`assets/Bumelerze-App-Visual-Assets/LICENSE-ARTWORK.md`](assets/Bumelerze-App-Visual-Assets/LICENSE-ARTWORK.md) |
| Earthquake and map data                 | Varies by source       | [`DATA-SOURCES.md`](DATA-SOURCES.md)                  |
| Felt reports and photos sent by users   | Not a licence question | <https://bumelerze.com/privacy.html>                  |

Copyright 2026 Peshawa L. Hasan, unless stated otherwise.

---

## 1. Application code: Apache License 2.0

This covers the Expo/React Native app at the repository root (`app/`, `src/`,
`store/`, `scripts/`, the build configuration), the `website/` directory, and
the `supabase/` migrations and edge functions.

Apache-2.0 is a permissive licence. In practice it means you may:

- use the code for anything, including commercially;
- copy it, change it, and build something else on top of it;
- ship your version as closed source if you want to;
- do all of that without paying anyone or asking permission.

What you have to do in return:

- keep the copyright notice and a copy of the licence with the code;
- say, in your changed files, that you changed them;
- not use the Bumelerze name or logo to promote your version (see section 5).

Apache-2.0 also includes an explicit patent grant, which is the main reason it
was chosen over MIT. Nobody contributing here can later sue users of this code
over a patent covering their own contribution.

## 2. The SHAKEmap engine: AGPL-3.0-or-later

`shake-service/` is licensed differently, and this is not a stylistic choice.

The engine computes ground-motion fields using the **OpenQuake Engine** from the
GEM Foundation (`openquake.engine==3.26.2`). It imports `openquake.hazardlib`
directly and drives its GSIM classes as a Python library. OpenQuake is
AGPL-3.0-or-later. Code that links against an AGPL library is a derivative work
of it and has to carry the same licence. So `shake-service/` is AGPL, and there
was no option to make it anything else while keeping OpenQuake.

The AGPL is a strong copyleft licence. If you take this engine and modify it,
your modified version has to be AGPL too, and its source has to be available to
the people you give it to.

**The network clause, simply.** Ordinary copyleft licences are triggered by
*distributing* software. The AGPL adds one more trigger: running it as a network
service. If you modify this engine and let other people use the modified version
over a network (a web API, a hosted map service, an app backend), those users
are entitled to the modified source code. Running an unmodified copy as a
service does not add that obligation.

**What the AGPL here does *not* do.** It does not spread to the Bumelerze app.
The app talks to the engine the way it talks to any other server: it downloads
finished SHAKEmap products as JSON over HTTP. That is data exchange, not
linking. If you build your own app that reads the products this engine
publishes, your app can be under whatever licence you like.

More detail, including what to do if the AGPL does not work for you, is in
[`shake-service/README.md`](shake-service/README.md).

## 3. Artwork and brand: all rights reserved

**The illustrations are not open source.** The set in
`assets/Bumelerze-App-Visual-Assets/` (the character cutouts, the 12 IMS
intensity illustrations, the building-damage sequences, the preview sheets, and
every derived file under `05-App-Ready/`) was commissioned specifically for
Bumelerze. So were the app icon and logo (`assets/images/icon.png`,
`assets/images/splash-icon.png`, the notification and adaptive icons, and
`assets/brand/icon.svg` and `assets/brand/mark.svg`).

All of that is **copyright 2026 Peshawa L. Hasan, all rights reserved**. The
Apache-2.0 licence on the code does not reach it. It lives in the public
repository so the app can actually be built and reviewed, not as an offer of
reuse.

Concretely: if you fork this repository, you may keep the code, but you may not
ship the illustrations or the icon in your own product, and you may not reuse
them in an unrelated project. That includes use as training data for image
models.

Requests are welcome, especially for public-safety or educational work in the
region: <hello@bumelerze.com>. See
[`assets/Bumelerze-App-Visual-Assets/LICENSE-ARTWORK.md`](assets/Bumelerze-App-Visual-Assets/LICENSE-ARTWORK.md).

## 4. Data: see DATA-SOURCES.md

Bumelerze displays earthquake data from public seismological agencies, map tiles
from OpenStreetMap-derived services, and a compiled regional catalog built from
five source catalogs. Each of those has its own terms, and several require
attribution that the app already displays.

The compiled Bumelerze regional catalog itself is offered under **CC BY 4.0**.

All of it, source by source, is in [`DATA-SOURCES.md`](DATA-SOURCES.md).

## 5. The name and the logo

"Bumelerze" (Kurdish *bûmelerze*, earthquake) and the Bumelerze logo and app
icon are reserved, independently of the code licence. Apache-2.0 says this
directly in its section 6, and it is worth spelling out because it surprises
people.

So: **a fork has to be renamed.** Please pick your own name and your own icon
before publishing a build. This is not about restricting the code, which is
deliberately open. It is about a safety app: during an earthquake, someone
looking at their phone needs to know whether the alert in front of them came
from this project or from somewhere else, and two apps sharing a name and an
icon takes that away from them.

Referring to the project by name is of course fine: "based on Bumelerze",
comparisons, research citations, articles, all normal use.

## 6. What users send in

Felt reports, their location, and any photos attached to them are not covered by
any licence in this repository. They are personal data, and how they are
collected, stored, aggregated, and moderated is governed by the privacy policy:
<https://bumelerze.com/privacy.html>.

If you run your own instance of this software, that policy is not yours to
inherit. You are the data controller for your users, and you need your own.

## 7. Third-party code

The app's JavaScript dependencies are overwhelmingly MIT-licensed, with a small
number under Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, and a handful of other
permissive licences. The Python side of `shake-service/` is mostly BSD and
MIT-licensed scientific packages, on top of AGPL-licensed OpenQuake. Each
package keeps its own licence text in its own distribution;
[`DATA-SOURCES.md`](DATA-SOURCES.md) summarises the picture by licence family.

## Questions

If something here is unclear, or you want to do something the licences do not
obviously allow, please just ask: <hello@bumelerze.com>. A short email is
cheaper for everyone than guessing.
