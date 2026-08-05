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
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
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
        backgroundColor: "#0B1220",
        image: "./assets/images/splash-icon.png",
        imageWidth: 96,
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
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
