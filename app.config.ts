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

// Expo account identity (iOS/Android builds, push tokens, EAS Update). Read
// from the environment, so the config needs no edit when the account
// exists: after `eas init`, put the owner and the project id it prints into
// `.env` (local builds) and into the project's EAS environment variables
// (EAS builds). Unset (today), the app has no owner and no project id, and
// local `npx expo prebuild` builds work as before. See .env.example.
//
// - EXPO_OWNER: the Expo account or organisation that owns the project.
// - EAS_PROJECT_ID: the EAS project id `eas init` prints.
type BuildEnv = Readonly<Record<string, string | undefined>>;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** `owner`, `extra.eas.projectId` and the EAS Update address, when the
 * environment names them. */
export function expoAccountConfig(
  env: BuildEnv,
): Pick<ExpoConfig, "owner" | "extra" | "updates"> {
  const owner = nonEmpty(env.EXPO_OWNER);
  const projectId = nonEmpty(env.EAS_PROJECT_ID);
  return {
    ...(owner ? { owner } : {}),
    ...(projectId ? { extra: { eas: { projectId } } } : {}),
    updates: {
      // A launch never waits for the network (panic-time: the app opens at
      // once on a weak connection). A new update downloads in the
      // background and applies at the next safe moment
      // (src/lib/native-update-on-resume.ts) or at the next launch.
      fallbackToCacheTimeout: 0,
      checkAutomatically: "ON_LOAD",
      // expo-updates is on only with an address, so only once the project
      // id exists. The channel (eas.json, one per build profile) is written
      // into the app by EAS Build.
      ...(projectId ? { url: `https://u.expo.dev/${projectId}` } : {}),
    },
  };
}

// The web app's host (src/config/urls.ts, APP_ORIGIN): shared links and QR
// codes point here.
const APP_HOST = "app.bumelerze.com";

/**
 * Apple team (iOS): EXPO_APPLE_TEAM_ID, the 10-character Team ID of the
 * Apple Developer account. With it, links to app.bumelerze.com open in the
 * app when it is installed (universal links), and passwords saved for the
 * web app are offered in the app's sign-in. Both also need
 * `.well-known/apple-app-site-association` on that host. Without the team
 * (today), neither entitlement is requested, so builds without an Apple
 * account keep working.
 */
export function appleTeamConfig(
  env: BuildEnv,
): Pick<NonNullable<ExpoConfig["ios"]>, "appleTeamId" | "associatedDomains"> {
  const appleTeamId = nonEmpty(env.EXPO_APPLE_TEAM_ID);
  if (!appleTeamId) {
    return {};
  }
  return {
    appleTeamId,
    associatedDomains: [`applinks:${APP_HOST}`, `webcredentials:${APP_HOST}`],
  };
}

/**
 * iOS privacy manifest (PrivacyInfo.xcprivacy): why the app's code uses
 * the APIs Apple asks a reason for. The app's own code calls none of them;
 * the libraries compiled into it do (React Native and its parts, MapLibre,
 * AsyncStorage, expo-file-system, expo-device, expo-system-ui,
 * expo-localization, expo-notifications), each for these standard reasons:
 * - UserDefaults CA92.1: settings the app itself stores (the reading
 *   direction, the screen colour, the notification state).
 * - FileTimestamp C617.1: dates of files inside the app's own storage
 *   (saved data, the bundled catalogue, map tiles).
 * - SystemBootTime 35F9.1: time since the phone started, to measure how
 *   long things take inside the app.
 * - DiskSpace E174.1: checking there is room before writing files.
 * No tracking and no tracking domains. The App Store privacy answers (what
 * data is collected) are given separately in App Store Connect.
 */
const privacyManifests: NonNullable<ExpoConfig["ios"]>["privacyManifests"] = {
  NSPrivacyTracking: false,
  NSPrivacyTrackingDomains: [],
  NSPrivacyAccessedAPITypes: [
    {
      NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
      NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
    },
    {
      NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
      NSPrivacyAccessedAPITypeReasons: ["C617.1"],
    },
    {
      NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime",
      NSPrivacyAccessedAPITypeReasons: ["35F9.1"],
    },
    {
      NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace",
      NSPrivacyAccessedAPITypeReasons: ["E174.1"],
    },
  ],
};

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

// iOS permission texts (Info.plist usage descriptions) in the app's four
// languages. iOS shows the one for the phone's language, or the language set
// for Bumelerze in iOS Settings; not the language picked inside the app.
// English is the base (Info.plist, through the plugins below); ckb, kmr and
// ar go to InfoPlist.strings (`locales`) and are drafts for the native
// review, written like the app's own locale files (Sorani brand
// "بوومەلەرزە"; "Bumelerze" in Latin, isolated in Arabic). One camera
// sentence serves both expo-image-picker (photos) and expo-camera (QR scan).
// No double quotes: Expo writes the .strings files without escaping them.
export interface PermissionTexts {
  camera: string;
  photos: string;
  /** Saving a shared earthquake image from the iOS share sheet ("Save
   * Image"): without this text iOS closes the app at that tap. */
  savePhotos: string;
  location: string;
  motion: string;
}

export const PERMISSION_TEXTS: Record<"en" | "ckb" | "kmr" | "ar", PermissionTexts> = {
  en: {
    camera:
      "Bumelerze uses the camera so you can add photos of earthquake damage or of your building to a report, and scan a family invite QR code.",
    photos:
      "Bumelerze uses your photos so you can add pictures of earthquake damage or of your building to a report.",
    savePhotos:
      "Bumelerze saves an earthquake image to your photos only when you choose to save it while sharing.",
    location:
      "Bumelerze uses your location to show accurate distances to earthquakes and to make the experiences you share useful for mapping real shaking. Only used while the app is open.",
    motion:
      "Bumelerze uses your phone's accelerometer to show you a live seismometer view. No location or personal data is collected.",
  },
  ckb: {
    camera:
      "بوومەلەرزە کامێرا بەکاردەهێنێت بۆ ئەوەی بتوانیت وێنەی زیانی بوومەلەرزە یان وێنەی بیناکەت بخەیتە ناو ڕاپۆرتێکەوە، و کۆدی QRی بانگهێشتی خێزان سکان بکەیت.",
    photos:
      "بوومەلەرزە وێنەکانت بەکاردەهێنێت بۆ ئەوەی بتوانیت وێنەی زیانی بوومەلەرزە یان وێنەی بیناکەت بخەیتە ناو ڕاپۆرتێکەوە.",
    savePhotos:
      "بوومەلەرزە وێنەی بوومەلەرزەیەک تەنها ئەو کاتە لە وێنەکانتدا پاشەکەوت دەکات کە لە کاتی هاوبەشکردندا خۆت پاشەکەوتکردنی هەڵدەبژێریت.",
    location:
      "بوومەلەرزە شوێنەکەت بەکاردەهێنێت بۆ پیشاندانی دووری ڕاست لە نێوان تۆ و بوومەلەرزەکان، و بۆ ئەوەی ئەو ئەزموونانەی هاوبەشیان دەکەیت بەسوود بن بۆ نەخشەکێشانی لەرزینی ڕاستەقینە. تەنها کاتێک بەکاردێت کە ئەپەکە کراوەیە.",
    motion:
      "بوومەلەرزە هەستەوەری جوڵەی مۆبایلەکەت (ئیکسیلیرۆمەتەر) بەکاردەهێنێت بۆ ئەوەی دیمەنێکی ڕاستەوخۆی سەیسمۆمەترت پیشان بدات. هیچ شوێن یان زانیارییەکی کەسی کۆ ناکرێتەوە.",
  },
  kmr: {
    camera:
      "Bumelerze kamerayê bikar tîne da ku tu bikaribî wêneyên zirara erdhejê an yên avahiya xwe li raporekê zêde bikî, û koda QR ya vexwendina malbatê skan bikî.",
    photos:
      "Bumelerze wêneyên te bikar tîne da ku tu bikaribî wêneyên zirara erdhejê an yên avahiya xwe li raporekê zêde bikî.",
    savePhotos:
      "Bumelerze wêneyeke erdhejê tenê gava ku tu di dema parvekirinê de tomarkirina wê hilbijêrî, di wêneyên te de tomar dike.",
    location:
      "Bumelerze cihê te bikar tîne da ku dûrahiya rast a erdhejan ji te nîşan bide û serpêhatiyên ku tu parve dikî ji bo nexşekirina lerizîna rastîn bikêr bike. Tenê dema ku sepan vekirî be tê bikaranîn.",
    motion:
      "Bumelerze sensora tevgerê ya telefona te (akselerometre) bikar tîne da ku dîmeneke rasterast a seysmometreyê nîşanî te bide. Tu cih an daneyên kesane nayên berhevkirin.",
  },
  ar: {
    camera:
      "يستخدم ⁦Bumelerze⁩ الكاميرا لتتمكن من إضافة صور لأضرار الزلزال أو لمبناك إلى تقرير، ومسح رمز QR لدعوة العائلة.",
    photos:
      "يستخدم ⁦Bumelerze⁩ صورك لتتمكن من إضافة صور لأضرار الزلزال أو لمبناك إلى تقرير.",
    savePhotos:
      "يحفظ ⁦Bumelerze⁩ صورة الزلزال في صورك فقط عندما تختار حفظها أثناء المشاركة.",
    location:
      "يستخدم ⁦Bumelerze⁩ موقعك لعرض مسافات دقيقة بينك وبين الزلازل، ولجعل التجارب التي تشاركها مفيدة في رسم خرائط الاهتزاز الحقيقي. لا يُستخدم إلا أثناء فتح التطبيق.",
    motion:
      "يستخدم ⁦Bumelerze⁩ مستشعر الحركة في هاتفك (مقياس التسارع) ليعرض لك جهاز رصد زلازل مباشرًا. لا يُجمع أي موقع أو بيانات شخصية.",
  },
};

/** The Info.plist keys for one language's permission texts. */
export function infoPlistPermissionStrings(
  texts: PermissionTexts,
): Record<string, string> {
  return {
    NSCameraUsageDescription: texts.camera,
    NSPhotoLibraryUsageDescription: texts.photos,
    NSPhotoLibraryAddUsageDescription: texts.savePhotos,
    NSLocationWhenInUseUsageDescription: texts.location,
    NSMotionUsageDescription: texts.motion,
  };
}

const config: ExpoConfig = {
  name: "Bumelerze",
  slug: "bumelerze",
  // The app's own version (D90): year.release.fix, each part counted on its
  // own. 26.1 = the state reviewed screen by screen with the owner
  // (2026-09-27); 26.2 = the October rebuild; 26.3 = the review fix batch
  // (D89) and the clean-up after it. The engine (bumelerze-engine) has its
  // own versions (now 26.2.1), and every shakemap names the engine version
  // that made it. Shown in the Settings footer and stamped on feedback,
  // presence and sensor exports.
  version: "26.3.1",
  // An EAS Update reaches only builds with the same app version: a release
  // that changes native code gets a new version, so older installs never
  // receive JavaScript written for native modules they do not have.
  runtimeVersion: { policy: "appVersion" },
  ...expoAccountConfig(process.env),
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "bumelerze",
  userInterfaceStyle: "automatic",
  // iOS: the permission texts in Sorani, Kurmanji and Arabic
  // (InfoPlist.strings; `PERMISSION_TEXTS`). Nothing for Android, which has
  // no such texts.
  locales: {
    ckb: { ios: infoPlistPermissionStrings(PERMISSION_TEXTS.ckb) },
    kmr: { ios: infoPlistPermissionStrings(PERMISSION_TEXTS.kmr) },
    ar: { ios: infoPlistPermissionStrings(PERMISSION_TEXTS.ar) },
  },
  ios: {
    // iPhone only for v1 (decided 2026-10-20): the layout is phone-first, as
    // on the web. iPads still run it as an iPhone app.
    supportsTablet: false,
    bundleIdentifier: "org.bumelerze.app",
    ...appleTeamConfig(process.env),
    // Export compliance: the app uses only the encryption built into iOS
    // (HTTPS), which is exempt, so App Store Connect asks nothing per build.
    config: { usesNonExemptEncryption: false },
    // Saving a shared earthquake image from the share sheet (no plugin
    // writes this key; `PERMISSION_TEXTS.savePhotos`).
    infoPlist: {
      NSPhotoLibraryAddUsageDescription: PERMISSION_TEXTS.en.savePhotos,
    },
    // Time Sensitive Notifications: alerts from M 5.0 are sent with
    // `interruptionLevel: "time-sensitive"` (supabase/functions/send-alerts),
    // which iOS honours only with this entitlement, so they break through a
    // Focus and the scheduled summary. The App ID needs the matching
    // capability in the Apple Developer account (EAS syncs it on build).
    entitlements: {
      "com.apple.developer.usernotifications.time-sensitive": true,
    },
    privacyManifests,
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
    output:
      webBaseUrl || process.env.BUMELERZE_WEB_OUTPUT === "single" ? "single" : "static",
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
      // Fonts built into the iOS/Android app, so they are on the device
      // before the first frame instead of being registered from the
      // JavaScript bundle at start: the four Vazirmatn faces (Sorani and
      // Arabic text; the PostScript names match the face names
      // `arabicScriptFontFor` uses) and, on iOS, the Ionicons icon font.
      // `app/_layout.tsx` keeps the splash screen up until both are
      // registered under the names the app asks for (the icon component
      // asks for "ionicons"). The web is unchanged: Vazirmatn loads only
      // for Sorani and Arabic, and icons use the cut-down web font
      // (src/lib/web-icon-font.web.ts).
      "expo-font",
      {
        fonts: [
          "./assets/fonts/Vazirmatn-Regular.ttf",
          "./assets/fonts/Vazirmatn-Medium.ttf",
          "./assets/fonts/Vazirmatn-SemiBold.ttf",
          "./assets/fonts/Vazirmatn-Bold.ttf",
        ],
        ios: {
          fonts: [
            "@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf",
          ],
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
        motionPermission: PERMISSION_TEXTS.en.motion,
      },
    ],
    [
      // Foreground-only location (the onboarding location step and the
      // feed/detail "distance from you"). No background/
      // "always" permission is ever requested anywhere in this app —
      // deliberately omitting `isAndroidBackgroundLocationEnabled`, and
      // removing the two iOS "always" usage descriptions the plugin would
      // otherwise add with a generic English text, keeps that off by
      // construction, not just by convention.
      "expo-location",
      {
        locationWhenInUsePermission: PERMISSION_TEXTS.en.location,
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
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
      // NSCameraUsageDescription / NSPhotoLibraryUsageDescription (English;
      // the other languages: `locales`), each covering every use in one
      // sentence.
      "expo-image-picker",
      {
        photosPermission: PERMISSION_TEXTS.en.photos,
        cameraPermission: PERMISSION_TEXTS.en.camera,
        // Photos only, never video: no microphone (the plugin would add a
        // generic English microphone text otherwise).
        microphonePermission: false,
      },
    ],
    [
      // Scanning the family QR code on "Join a home" (Tag my building).
      // Same NSCameraUsageDescription as the picker above, so both plugins
      // carry one shared sentence. No microphone: the camera is used only to
      // read a QR code.
      "expo-camera",
      {
        cameraPermission: PERMISSION_TEXTS.en.camera,
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    // The native map engine for iOS and Android (the Map tab's `map.tsx`).
    // The web keeps maplibre-gl (`map.web.tsx`); this package is only ever
    // imported from native-only files, so it never reaches the web bundle.
    // The plugin adds its CocoaPods post-install step.
    "@maplibre/maplibre-react-native",
    [
      // iOS: declare the app's four languages (CFBundleLocalizations), so
      // iOS treats Sorani and Arabic as languages of this app (right to
      // left from the first frame when the phone is set to one of them) and
      // offers the per-app language setting. Deliberately NOT `supportsRTL`:
      // on iOS that option re-sets React Native's RTL flag from the PHONE
      // language on every launch, which would undo the language picked in
      // the app (Sorani on an English phone, English on a Sorani phone) and
      // restart the app in a loop. The direction follows the app language
      // instead (`pinNativeLayoutDirection` in src/i18n/index.ts).
      "expo-localization",
      { supportedLocales: { ios: ["en", "ckb", "kmr", "ar"] } },
    ],
    // iOS: the UIScene life cycle the iOS 27 SDK requires (Expo SDK 57's
    // template predates it). Remove on Expo SDK 58 or later.
    "./plugins/with-ios-scene-life-cycle",
  ],
  experiments: {
    typedRoutes: true,
    ...(webBaseUrl ? { baseUrl: webBaseUrl } : {}),
  },
};

export default config;
