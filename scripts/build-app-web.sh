#!/usr/bin/env bash
# Builds the app's web version for app.bumelerze.com (Cloudflare Pages).
# Hosting layout: the app lives ONLY here; the website bumelerze.com is its
# own Cloudflare Pages project (`bumelerze-website`, publishes website/ as
# committed), which never builds the app and only forwards
# bumelerze.com/app/... and the short links (/e/<id>, /u/<name>, /join?…) to
# this origin (website/_redirects, from scripts/build-website.mjs).
# Cloudflare installs dependencies (npm ci) before running this script.
# Pages settings: build command `bash scripts/build-app-web.sh`,
# output directory `dist-app`. The app sits at the domain root, so no base
# path; unknown deep links fall back to index.html (Pages SPA behaviour,
# which holds only while there is NO top-level 404.html).
#
# Missing files are real 404s (B2.5, replacing the accepted risk D-4 of
# 2026-10-14): on a miss Pages first looks for the nearest 404.html up the
# folder tree and only then falls back to index.html. The end of this script
# puts scripts/web-not-found.html into _expo/, assets/ and data/, so a missing
# script, asset or data file answers 404 (Pages always sends 404s no-store),
# while every app address still opens the app. That makes the year-long
# caching of the content-hashed /_expo/static/* and /assets/* in _headers
# safe: a missing file can no longer be cached as the app page.
# public/_headers (HSTS, Content-Security-Policy, Permissions-Policy, caching, ...),
# public/robots.txt and public/turnstile.html ride along: `expo export` copies
# public/ to the root of dist-app, which the check after the export confirms.
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
# by design (the dormant Netlify mirror in netlify.toml carries the same ones).
export EXPO_PUBLIC_SUPABASE_URL=https://bcgyxepgruwardhozvfq.supabase.co
export EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I
export EXPO_PUBLIC_MAPTILER_KEY=u55zrEViEes3KunGwdnn
export EXPO_PUBLIC_VAPID_PUBLIC_KEY=BMC0pPjw9ICMY-_R7zlWMDlqoB6XhQRsPbFNFrST55eFGtVmR3LoM4nxFN9HHH5mK4yOUdrXbFa3vLiodH_0mrw
# Cloudflare Turnstile SITE key (CAPTCHA for Supabase Auth, security item
# A1.4): public by design, like the keys above; the matching SECRET key goes
# only into Supabase Auth > CAPTCHA protection. Empty = no CAPTCHA, every
# sign-in exactly as before. Widget "Bumelerze app" (Managed mode, hostname
# app.bumelerze.com, created 2026-11-23); same key in eas.json. It shipped
# BEFORE CAPTCHA protection was switched on (src/features/captcha/).
export EXPO_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAAGPB5fykbHRntXGg

rm -rf dist-app
# --clear: a stale Metro cache has silently produced an empty app before.
npx expo export --platform web --output-dir dist-app --clear

# The hosting files must reach the output root (Cloudflare Pages reads
# _headers there) or the deploy would quietly lose its security headers.
# turnstile.html is the security check page the iOS/Android app opens
# (src/features/captcha/TurnstileFrame.tsx); without it their sign-ins would
# get the app's own page instead.
for hosting_file in _headers robots.txt turnstile.html; do
  if ! cmp -s "public/$hosting_file" "dist-app/$hosting_file"; then
    echo "build-app-web: public/$hosting_file was not copied into dist-app" >&2
    exit 1
  fi
done

# iOS universal links and shared passwords: with the Apple Developer Team ID
# in APPLE_TEAM_ID (the same value as EXPO_APPLE_TEAM_ID for the iOS build),
# write .well-known/apple-app-site-association and add its JSON content type
# to _headers, so links to the app's shareable pages open the installed
# iPhone app and passwords saved for this site are offered in its sign-in.
# Unset (until the Apple account exists), nothing is written and the output
# is exactly what it was without this step.
if [ -n "${APPLE_TEAM_ID:-}" ]; then
  node scripts/write-apple-app-site-association.mjs dist-app "$APPLE_TEAM_ID"
fi

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
# Real 404s for missing files (see the top): one not-found page in each file
# folder, never one at the top (that would end the app's own addresses).
for not_found_dir in _expo assets data; do
  if [ ! -d "dist-app/$not_found_dir" ]; then
    echo "build-app-web: dist-app/$not_found_dir is missing" >&2
    exit 1
  fi
  cp scripts/web-not-found.html "dist-app/$not_found_dir/404.html"
done
if [ -e dist-app/404.html ]; then
  echo "build-app-web: dist-app/404.html would turn off the app's own addresses" >&2
  exit 1
fi
