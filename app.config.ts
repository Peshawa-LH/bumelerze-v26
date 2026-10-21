import fs from "node:fs";
import path from "node:path";

import type { ExpoConfig } from "expo/config";

// Environment config lives here (not app.json) so Phase-2+ work can branch on
// EAS build profiles / env vars without touching this file's structure.

// Web hosting (2026-10): the app is served at the ROOT of app.bumelerze.com
// (Cloudflare Pages, scripts/build-app-web.sh, no base path); the website
// stays on GitHub Pages at bumelerze.com, which only forwards the old
// bumelerze.com/app/... links and the short links (/e, /u, /join) to the app
// and no longer hosts an app build. BUMELERZE_WEB_BASE_URL is only for a
// build served under a subpath (the dormant Netlify mirror sets "/app"):
// unset (production, local dev, tests, native builds) nothing changes.
// Hosted builds use SPA ("single") output because the hosts only have a
// simple wildcard fallback — the default "static" per-route HTML export
// needs per-dynamic-segment rewrites instead.
const webBaseUrl = process.env.BUMELERZE_WEB_BASE_URL;

// Brand colors for icon/splash chrome come straight from the logo
// package's own machine-readable tokens (not hand-copied hex) — the same
// file `scripts/generate-assets.js` reads to rasterize icon.png/
// splash-icon.png, so app.config.ts and the generated PNGs can never drift
// out of sync. This is the LOGO's palette (Signal Red / Warm Ivory /
// Endpoint Gold / Approved Navy) — a deliberately different, untouched
// palette from the app's in-product semantic colors in
// src/theme/palette.ts (intensityRamp, actionRed, status.danger), which
// this file does not read. See assets/brand/README.md for why those two
// palettes are kept apart.
interface LogoColorToken {
  hex: string;
}
interface LogoColorTokens {
  colors: Record<string, LogoColorToken>;
}
const logoColorsPath = path.join(__dirname, "assets/brand/tokens/bumelerze-colors.json");
const logoColors: LogoColorTokens = JSON.parse(fs.readFileSync(logoColorsPath, "utf8"));
function logoColorHex(key: string): string {
  const token = logoColors.colors[key];
  if (!token) {
    throw new Error(
      `${logoColorsPath}: missing colors["${key}"] — logo package tokens changed shape.`,
    );
  }
  return token.hex;
}
const signalRed = logoColorHex("signal-red");
const approvedNavy = logoColorHex("approved-navy");

// One sentence for the camera permission, shared by expo-image-picker (photos)
// and expo-camera (QR scan): the OS shows it in English only.
const cameraPermissionText =
  "Bumelerze uses the camera so you can add photos of earthquake damage or of your building to a report, and scan a family invite QR code.";

const config: ExpoConfig = {
  name: "Bumelerze",
  slug: "bumelerze",
  // The app's own version (D90): year.release.fix, each part counted on its
  // own. 26.1 = the state reviewed screen by screen with the owner
  // (2026-09-27); 26.2 = the October rebuild; 26.3 = the review fix batch
  // (D89) and the clean-up after it. The engine (bumelerze-engine) has its
  // own versions (now 26.2.1), and every shakemap names the engine version
  // that made it. Shown in the Settings footer and, with the web build id
  // (src/lib/app-version.ts), stamped on feedback, presence and sensor
  // exports.
  version: "26.3.1",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "bumelerze",
  userInterfaceStyle: "automatic",
  ios: {
    supportsTablet: true,
    bundleIdentifier: "org.bumelerze.app",
  },
  android: {
    adaptiveIcon: {
      // Signal Red (logoColors, the logo package's field color) — matches
      // the round/square app icon so every launcher mask shape reproduces
      // the same look. Regenerate the foreground/monochrome images via
      // `node scripts/generate-assets.js` if the logo package changes.
      backgroundColor: signalRed,
      foregroundImage: "./assets/images/android-icon-foreground.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    package: "org.bumelerze.app",
  },
  web: {
    // "single" (SPA) for hosted web builds: at the subdomain root
    // (app.bumelerze.com, scripts/build-app-web.sh) or under a base path.
    output: webBaseUrl || process.env.BUMELERZE_WEB_OUTPUT === "single" ? "single" : "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    [
      // Async routes are OFF: with them on (2026-10-14) the web tab bar sent
      // Profile, Settings and Sensor to the Home stack's /world route, because
      // the shared (home,map,sensor,profile,settings) group's screens were not
      // known until loaded. The heavy areas still load on demand through their
      // own lazy imports (map, catalogue, admin, handbook, SHAKEmaps, locales).
      // No generated /_sitemap route: it is a development tool that listed
      // every route file (admin, account...) on the live site (review B-1);
      // an unknown address shows app/+not-found.tsx instead.
      "expo-router",
      { asyncRoutes: false, sitemap: false },
    ],
    [
      "expo-splash-screen",
      {
        // Signal Red for the light splash. The logo package's own
        // brand-guidelines.md calls out Approved Navy as the dark
        // background its ivory/gold mark was designed to read against
        // ("Reversed logo: use the ivory version on navy or another
        // sufficiently dark background") — used for the dark splash below.
        // The mark itself (ivory mountain/waveform + gold endpoint,
        // transparent field) is the same asset in both.
        backgroundColor: signalRed,
        image: "./assets/images/splash-icon.png",
        imageWidth: 96,
        dark: {
          backgroundColor: approvedNavy,
          image: "./assets/images/splash-icon.png",
        },
      },
    ],
    [
      // The Sensor screen uses expo-sensors' Accelerometer.
      // Plain accelerometer access needs no runtime permission on either
      // platform, but the module's permission API is shared across all
      // expo-sensors types, and iOS requires NSMotionUsageDescription to be
      // present in Info.plist the moment that shared API is touched at all
      // (calling it with the key missing crashes on-device) — this plugin
      // adds the key defensively so the (currently harmless, likely
      // no-op-on-Accelerometer) permission check in
      // use-accelerometer-stream.ts never hits a missing-Info.plist-key
      // crash on iOS.
      "expo-sensors",
      {
        motionPermission:
          "Bumelerze uses your phone's accelerometer to show you a live seismometer view. No location or personal data is collected.",
      },
    ],
    [
      // Foreground-only location (the onboarding location step and the
      // feed/detail "distance from you"). No background/
      // "always" permission is ever requested anywhere in this app —
      // deliberately omitting `isAndroidBackgroundLocationEnabled` and the
      // iOS "always" usage description keeps that off by construction, not
      // just by convention.
      "expo-location",
      {
        locationWhenInUsePermission:
          "Bumelerze uses your location to show accurate distances to earthquakes and to make the experiences you share useful for mapping real shaking. Only used while the app is open.",
      },
    ],
    [
      // Notifications: the native permission strings and the Android
      // notification icon. Earthquake alerts (migration 0062 and the
      // send-alerts edge function; testers mode for now, D83) go out by web
      // push on the web and through the Expo push API to native devices;
      // this plugin is what lets a native build receive them.
      "expo-notifications",
      {
        // Android status-bar notification icons must be a pure white
        // silhouette on a transparent field (OS renders everything else as
        // solid black) — never the full-color app icon. `color` is the
        // notification accent tint; deliberately still brand.primaryLight
        // ("Zagros Blue", src/theme/palette.ts), NOT the logo's Signal Red —
        // an earthquake-alert notification tinted the same red the app uses
        // for danger/intensity would read as more severe than it is. See
        // assets/brand/README.md for the full brand-red-vs-app-red split.
        icon: "./assets/images/notification-icon.png",
        color: "#1F4E5F",
      },
    ],
    // Bundled Catalog browser: `expo-sqlite` opens
    // the read-only `bumelerze-catalog.sqlite` asset copied into the
    // document directory on first launch (features/catalog/db.ts). The
    // plugin is required so the native SQLite build includes the extra
    // features (e.g. bundled-asset support) the CLI flags at install time —
    // no config options needed beyond enabling it.
    "expo-sqlite",
    // Cartoon/damage tile artwork: LevelTile and
    // DamageTile render artwork through expo-image's <Image>. No plugin
    // options needed — this just lets the config plugin wire the native
    // module the same way expo-sqlite's entry above does.
    "expo-image",
    [
      // Photos on felt reports (damage) and on a tagged building. Both the
      // camera and photo-library permission strings are needed since the
      // picker offers both entry points. These strings are the iOS
      // NSCameraUsageDescription / NSPhotoLibraryUsageDescription; the OS
      // shows them in English only, so they cover every use in one sentence.
      "expo-image-picker",
      {
        photosPermission:
          "Bumelerze uses your photos so you can add pictures of earthquake damage or of your building to a report.",
        cameraPermission: cameraPermissionText,
      },
    ],
    [
      // Scanning the family QR code on "Join a home" (Tag my building).
      // Same NSCameraUsageDescription as the picker above, so both plugins
      // carry one shared sentence. No microphone: the camera is used only to
      // read a QR code.
      "expo-camera",
      {
        cameraPermission: cameraPermissionText,
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    ...(webBaseUrl ? { baseUrl: webBaseUrl } : {}),
  },
};

export default config;
