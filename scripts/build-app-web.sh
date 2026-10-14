#!/usr/bin/env bash
# Builds the app's web version for app.bumelerze.com (Cloudflare Pages).
# Hosting layout: the app lives ONLY here; the website is on GitHub Pages at
# bumelerze.com (.github/workflows/deploy-pages.yml), which no longer builds
# the app and only forwards bumelerze.com/app/... and the short links
# (/e/<id>, /u/<name>, /join?…) to this origin (website-src/redirects.js).
# Cloudflare installs dependencies (npm ci) before running this script.
# Pages settings: build command `bash scripts/build-app-web.sh`,
# output directory `dist-app`. The app sits at the domain root, so no base
# path; unknown deep links fall back to index.html (Pages SPA behaviour).
set -euo pipefail

export BUMELERZE_WEB_OUTPUT=single
# Stamps the map worker and RTL plugin URLs so a deploy is never served
# with a browser's stale copy (map/config.ts).
export EXPO_PUBLIC_BUILD_ID="${CF_PAGES_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo local)}"
# The offline copy (public/push-sw.js) is on unless this is set to "off":
# the emergency switch if a deploy's offline copy ever misbehaves. With it
# off the worker deletes its caches and only handles alerts.
OFFLINE_SW_MODE="${BUMELERZE_OFFLINE_SW:-on}"
# Publishable client values: EXPO_PUBLIC_* ship inside every client bundle
# by design (same values as .github/workflows/deploy-pages.yml).
export EXPO_PUBLIC_SUPABASE_URL=https://bcgyxepgruwardhozvfq.supabase.co
export EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I
export EXPO_PUBLIC_MAPTILER_KEY=u55zrEViEes3KunGwdnn
export EXPO_PUBLIC_VAPID_PUBLIC_KEY=BMC0pPjw9ICMY-_R7zlWMDlqoB6XhQRsPbFNFrST55eFGtVmR3LoM4nxFN9HHH5mK4yOUdrXbFa3vLiodH_0mrw

rm -rf dist-app
# --clear: a stale Metro cache has silently produced an empty app before.
npx expo export --platform web --output-dir dist-app --clear

# Cloudflare Pages never uploads directories named node_modules, and its SPA
# fallback then answers those URLs with index.html — which silently broke the
# icon fonts (@expo/vector-icons), expo-router images and the wa-sqlite engine
# behind the offline catalogue. Move them to assets/vendor and rewrite the
# references in the exported bundles.
if [ -d dist-app/assets/node_modules ]; then
  mv dist-app/assets/node_modules dist-app/assets/vendor
  grep -rlF "/assets/node_modules/" dist-app | while IFS= read -r f; do
    perl -pi -e 's#/assets/node_modules/#/assets/vendor/#g' "$f"
  done
fi
if find dist-app -path '*node_modules*' | grep -q . || grep -rqF "node_modules/" dist-app/_expo dist-app/index.html; then
  echo "build-app-web: node_modules paths remain in dist-app (Cloudflare Pages would drop them)" >&2
  exit 1
fi

# Web Workers (the offline catalogue's SQLite) must carry all their modules.
node scripts/check-web-workers.mjs dist-app

# Service worker (alerts + offline copy): stamp this deploy's id, so every
# deploy is a new worker with its own cache, and tag the page with the same
# id, so the worker only ever keeps a page of its own deploy.
case "$OFFLINE_SW_MODE" in on|off) ;; *) echo "build-app-web: BUMELERZE_OFFLINE_SW must be on or off" >&2; exit 1 ;; esac
case "$EXPO_PUBLIC_BUILD_ID" in *[!A-Za-z0-9._-]*|"") echo "build-app-web: unexpected build id" >&2; exit 1 ;; esac
perl -pi -e "s/^var BUILD_ID = \"dev\";\$/var BUILD_ID = \"$EXPO_PUBLIC_BUILD_ID\";/; s/^var OFFLINE_MODE = \"on\";\$/var OFFLINE_MODE = \"$OFFLINE_SW_MODE\";/" dist-app/push-sw.js
perl -pi -e "s#<head>#<head><meta name=\"bumelerze-build\" content=\"$EXPO_PUBLIC_BUILD_ID\">#" dist-app/index.html
if ! grep -qF "var BUILD_ID = \"$EXPO_PUBLIC_BUILD_ID\";" dist-app/push-sw.js \
  || ! grep -qF "var OFFLINE_MODE = \"$OFFLINE_SW_MODE\";" dist-app/push-sw.js \
  || ! grep -qF "<meta name=\"bumelerze-build\" content=\"$EXPO_PUBLIC_BUILD_ID\">" dist-app/index.html; then
  echo "build-app-web: could not stamp the build id into push-sw.js / index.html" >&2
  exit 1
fi
# An empty export (a known Metro cache failure) must never be deployed:
# the page must name its scripts, and each must exist and not be empty.
scripts=$(grep -o 'src="/_expo/static/js/web/[^"]*\.js"' dist-app/index.html | sed 's/^src="\(.*\)"$/\1/')
if [ -z "$scripts" ]; then
  echo "build-app-web: index.html names no app scripts" >&2
  exit 1
fi
for script in $scripts; do
  if [ ! -s "dist-app$script" ]; then
    echo "build-app-web: $script is missing or empty" >&2
    exit 1
  fi
done
