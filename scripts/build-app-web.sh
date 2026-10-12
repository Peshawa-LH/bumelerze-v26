#!/usr/bin/env bash
# Builds the app's web version for app.bumelerze.com (Cloudflare Pages).
# Cloudflare installs dependencies (npm ci) before running this script.
# Pages settings: build command `bash scripts/build-app-web.sh`,
# output directory `dist-app`. The app sits at the domain root, so no base
# path; unknown deep links fall back to index.html (Pages SPA behaviour).
set -euo pipefail

export BUMELERZE_WEB_OUTPUT=single
# Stamps the map worker and RTL plugin URLs so a deploy is never served
# with a browser's stale copy (map/config.ts).
export EXPO_PUBLIC_BUILD_ID="${CF_PAGES_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo local)}"
# Publishable client values: EXPO_PUBLIC_* ship inside every client bundle
# by design (same values as .github/workflows/deploy-pages.yml).
export EXPO_PUBLIC_SUPABASE_URL=https://bcgyxepgruwardhozvfq.supabase.co
export EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I
export EXPO_PUBLIC_MAPTILER_KEY=u55zrEViEes3KunGwdnn
export EXPO_PUBLIC_VAPID_PUBLIC_KEY=BMC0pPjw9ICMY-_R7zlWMDlqoB6XhQRsPbFNFrST55eFGtVmR3LoM4nxFN9HHH5mK4yOUdrXbFa3vLiodH_0mrw

rm -rf dist-app
npx expo export --platform web --output-dir dist-app
