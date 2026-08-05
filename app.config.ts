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
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
