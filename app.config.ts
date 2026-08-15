import type { ExpoConfig } from "expo/config";

// Environment config lives here (not app.json) so Phase-2+ work can branch on
// EAS build profiles / env vars without touching this file's structure.
// Phase 1 scope: static skeleton config only, no env branching yet.
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
      // Zagros Blue (brand.primaryLight, src/theme/palette.ts) — still
      // flagged owner-review there; regenerate via
      // `node scripts/generate-assets.js` after that hue is finalized.
      backgroundColor: "#1F4E5F",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    package: "org.bumelerze.app",
  },
  web: {
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        // Brand background both modes (src/theme/palette.ts `brand`, still
        // owner-review — design-language.md §3): primaryLight for the light
        // splash, primaryDark for the dark splash. The mark itself (white
        // rings, transparent field) is the same asset in both — it was
        // designed to read clearly against either brand value.
        backgroundColor: "#1F4E5F",
        image: "./assets/images/splash-icon.png",
        imageWidth: 96,
        dark: {
          backgroundColor: "#3E7C93",
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
        // notification accent tint; brand.primaryLight (palette.ts).
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
  },
};

export default config;
