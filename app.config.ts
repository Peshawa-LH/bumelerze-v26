import fs from "node:fs";
import path from "node:path";

import type { ExpoConfig } from "expo/config";

// Environment config lives here (not app.json) so Phase-2+ work can branch on
// EAS build profiles / env vars without touching this file's structure.

// Netlify web-preview export (netlify.toml sets this to "/app"): serve the
// exported web app from a subpath of the static site instead of the domain
// root. Uses SPA ("single") output there because the host only has a simple
// wildcard rewrite — the default "static" per-route HTML export needs
// per-dynamic-segment rewrites instead. Unset (local dev, tests, native
// builds) nothing changes.
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
const logoColorsPath = path.join(
  __dirname,
  "assets/Bumelerze-App-Visual-Assets/08-Logo_Package/Design-Tokens/bumelerze-colors.json",
);
const logoColors: LogoColorTokens = JSON.parse(fs.readFileSync(logoColorsPath, "utf8"));
function logoColorHex(key: string): string {
  const token = logoColors.colors[key];
  if (!token) {
    throw new Error(`${logoColorsPath}: missing colors["${key}"] — logo package tokens changed shape.`);
  }
  return token.hex;
}
const signalRed = logoColorHex("signal-red");
const approvedNavy = logoColorHex("approved-navy");

const config: ExpoConfig = {
  name: "Bumelerze",
  slug: "bumelerze",
  version: "0.1.0",
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
    output: webBaseUrl ? "single" : "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
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
      // Sensor screen (spec-v1.md §4.8) uses expo-sensors' Accelerometer.
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
      // Foreground-only location (onboarding §4.11 step 3 + the feed/detail
      // "distance from you" upgrade, wave brief point 3). No background/
      // "always" permission is ever requested anywhere in this app —
      // deliberately omitting `isAndroidBackgroundLocationEnabled` and the
      // iOS "always" usage description keeps that off by construction, not
      // just by convention.
      "expo-location",
      {
        locationWhenInUsePermission:
          'Bumelerze uses your location to show accurate distances to earthquakes and to make your "did you feel it?" reports valid scientific testimony. Only used while the app is open.',
      },
    ],
    [
      // Phase 4 client-side notifications (spec-v1.md §4.10/§4.11 step 4).
      // This wave is entirely local (rehearsal sound only, no push tokens,
      // no server) — the plugin still needs to run so the notification
      // permission strings/icon exist in the native build ahead of Phase 5's
      // real Expo push wiring, per this wave brief's "only expo-notifications
      // may be added" scope note.
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
    // Bundled Catalog browser (regional-catalog wave): `expo-sqlite` opens
    // the read-only `bumelerze-catalog.sqlite` asset copied into the
    // document directory on first launch (features/catalog/db.ts). The
    // plugin is required so the native SQLite build includes the extra
    // features (e.g. bundled-asset support) the CLI flags at install time —
    // no config options needed beyond enabling it.
    "expo-sqlite",
    // Cartoon/damage tile artwork (tile-image-rendering wave): LevelTile and
    // DamageTile render artwork through expo-image's <Image>. No plugin
    // options needed — this just lets the config plugin wire the native
    // module the same way expo-sqlite's entry above does.
    "expo-image",
    [
      // Felt-report flow redesign (2026-08-15 owner directive), window 3:
      // an optional photo attachment on the baseline report. Both the
      // camera and photo-library permission strings are needed since the
      // picker offers both entry points; the photo is queued locally only
      // this wave (no storage upload yet — see supabase-transport.ts).
      "expo-image-picker",
      {
        photosPermission:
          "Bumelerze uses your photos to let you attach a picture of damage to your earthquake report.",
        cameraPermission:
          "Bumelerze uses your camera to let you take a picture of damage for your earthquake report.",
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    ...(webBaseUrl ? { baseUrl: webBaseUrl } : {}),
  },
};

export default config;
