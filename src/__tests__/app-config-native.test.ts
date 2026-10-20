import fs from "node:fs";
import path from "node:path";

import config, {
  appleTeamConfig,
  expoAccountConfig,
  infoPlistPermissionStrings,
  PERMISSION_TEXTS,
} from "../../app.config";
import { APP_ORIGIN } from "../config/urls";
import { arabicScriptFontFor } from "../theme/typography";

const ROOT = path.join(__dirname, "../..");

function pluginOptions(name: string): Record<string, unknown> | undefined {
  const entry = (config.plugins ?? []).find(
    (plugin) => Array.isArray(plugin) && plugin[0] === name,
  );
  return Array.isArray(entry) ? (entry[1] as Record<string, unknown>) : undefined;
}

/** iOS/Android build settings in app.config.ts (the web build ignores them). */
describe("app.config native build identity", () => {
  it("ties EAS Updates to the app version", () => {
    expect(config.runtimeVersion).toEqual({ policy: "appVersion" });
  });

  it("names no Expo owner, project or update address while the environment has none", () => {
    for (const env of [{}, { EXPO_OWNER: "  ", EAS_PROJECT_ID: "" }]) {
      const account = expoAccountConfig(env);
      expect(account.owner).toBeUndefined();
      expect(account.extra).toBeUndefined();
      // No URL: expo-updates stays off, as before the Expo account.
      expect(account.updates?.url).toBeUndefined();
    }
  });

  it("reads the owner and the project id from the environment after `eas init`", () => {
    const account = expoAccountConfig({
      EXPO_OWNER: "bumelerze",
      EAS_PROJECT_ID: " 0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7 ",
    });
    expect(account.owner).toBe("bumelerze");
    expect(account.extra).toEqual({
      eas: { projectId: "0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7" },
    });
    expect(account.updates?.url).toBe(
      "https://u.expo.dev/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7",
    );
  });

  it("never makes a launch wait for the update server (panic-time)", () => {
    expect(expoAccountConfig({}).updates).toMatchObject({
      fallbackToCacheTimeout: 0,
      checkAutomatically: "ON_LOAD",
    });
  });
});

describe("eas.json build profiles", () => {
  const eas = require("../../eas.json") as {
    build: Record<string, { channel?: string; extends?: string }>;
  };

  it("gives every build profile its own EAS Update channel", () => {
    expect(eas.build.development?.channel).toBe("development");
    expect(eas.build.preview?.channel).toBe("preview");
    expect(eas.build.production?.channel).toBe("production");
  });

  it("has a development build for the iOS Simulator (no Apple account needed)", () => {
    expect(eas.build["development-simulator"]).toEqual({
      extends: "development",
      ios: { simulator: true },
    });
  });
});

describe("app.config iOS store and compliance settings", () => {
  it("is an iPhone app in v1 (phone-first layout, no iPad build)", () => {
    expect(config.ios?.supportsTablet).toBe(false);
  });

  it("declares that the app uses only exempt encryption (HTTPS)", () => {
    expect(config.ios?.config?.usesNonExemptEncryption).toBe(false);
  });

  it("declares no tracking in the privacy manifest", () => {
    expect(config.ios?.privacyManifests?.NSPrivacyTracking).toBe(false);
    expect(config.ios?.privacyManifests?.NSPrivacyTrackingDomains).toEqual([]);
  });

  /** Every required-reason API category a native dependency declares in its
   * own PrivacyInfo.xcprivacy (React Native, AsyncStorage, expo-file-system,
   * expo-device...). Their code is compiled into the app, so the app's
   * manifest must name the category too, or App Store Connect warns. */
  function dependencyApiCategories(): Set<string> {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const found = new Set<string>();
    const skip = new Set(["node_modules", "android", "__tests__", ".git"]);
    const walk = (dir: string, depth: number) => {
      if (depth > 9) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!skip.has(entry.name)) walk(full, depth + 1);
        } else if (entry.name === "PrivacyInfo.xcprivacy") {
          const xml = fs.readFileSync(full, "utf8");
          for (const match of xml.matchAll(/NSPrivacyAccessedAPICategory\w+/g)) {
            found.add(match[0]);
          }
        }
      }
    };
    for (const name of Object.keys(pkg.dependencies)) {
      const dir = path.join(ROOT, "node_modules", name);
      if (fs.existsSync(dir)) walk(dir, 0);
    }
    return found;
  }

  it("gives a reason for every required-reason API its native libraries use", () => {
    const declared = new Map(
      (config.ios?.privacyManifests?.NSPrivacyAccessedAPITypes ?? []).map((type) => [
        type.NSPrivacyAccessedAPIType,
        type.NSPrivacyAccessedAPITypeReasons,
      ]),
    );
    const used = dependencyApiCategories();
    // React Native alone uses UserDefaults: a scan finding nothing is broken.
    expect(used.has("NSPrivacyAccessedAPICategoryUserDefaults")).toBe(true);
    const missing = [...used].filter((category) => !declared.get(category)?.length);
    expect(missing).toEqual([]);
  });

  it("asks for no universal links or saved passwords until the Apple team exists", () => {
    expect(appleTeamConfig({})).toEqual({});
    expect(appleTeamConfig({ EXPO_APPLE_TEAM_ID: " " })).toEqual({});
  });

  it("opens app.bumelerze.com links in the app once the Apple team is set", () => {
    const host = new URL(APP_ORIGIN).host;
    expect(appleTeamConfig({ EXPO_APPLE_TEAM_ID: "ABCDE12345" })).toEqual({
      appleTeamId: "ABCDE12345",
      associatedDomains: [`applinks:${host}`, `webcredentials:${host}`],
    });
  });

  it("asks only for foreground location, and never for the microphone", () => {
    expect(pluginOptions("expo-location")).toMatchObject({
      locationAlwaysAndWhenInUsePermission: false,
      locationAlwaysPermission: false,
    });
    expect(pluginOptions("expo-image-picker")).toMatchObject({
      microphonePermission: false,
    });
    expect(pluginOptions("expo-camera")).toMatchObject({ microphonePermission: false });
  });
});

/** The PostScript name in a TrueType file's `name` table (name id 6). */
function postScriptName(file: string): string | null {
  const data = fs.readFileSync(file);
  const numTables = data.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const record = 12 + 16 * i;
    if (data.toString("latin1", record, record + 4) !== "name") continue;
    const table = data.readUInt32BE(record + 8);
    const count = data.readUInt16BE(table + 2);
    const strings = table + data.readUInt16BE(table + 4);
    for (let j = 0; j < count; j++) {
      const entry = table + 6 + 12 * j;
      const platformId = data.readUInt16BE(entry);
      const nameId = data.readUInt16BE(entry + 6);
      if (nameId !== 6) continue;
      const length = data.readUInt16BE(entry + 8);
      const offset = strings + data.readUInt16BE(entry + 10);
      const raw = data.subarray(offset, offset + length);
      return platformId === 1
        ? raw.toString("latin1")
        : Buffer.from(raw).swap16().toString("utf16le");
    }
  }
  return null;
}

describe("app.config built-in fonts (expo-font)", () => {
  const options = pluginOptions("expo-font") as
    { fonts?: string[]; ios?: { fonts?: string[] } } | undefined;

  it("builds the four Vazirmatn faces into the app", () => {
    expect(options?.fonts).toEqual([
      "./assets/fonts/Vazirmatn-Regular.ttf",
      "./assets/fonts/Vazirmatn-Medium.ttf",
      "./assets/fonts/Vazirmatn-SemiBold.ttf",
      "./assets/fonts/Vazirmatn-Bold.ttf",
    ]);
  });

  it("names each face the way the styles ask for it (iOS finds fonts by PostScript name)", () => {
    const asked = new Set(
      (["400", "500", "600", "700"] as const).map((weight) =>
        arabicScriptFontFor(weight),
      ),
    );
    const embedded = new Set(
      (options?.fonts ?? []).map((file) => postScriptName(path.join(ROOT, file))),
    );
    expect(embedded).toEqual(asked);
  });

  it("builds the Ionicons icon font into the iOS app", () => {
    const [ionicons] = options?.ios?.fonts ?? [];
    expect(ionicons).toMatch(/Ionicons\.ttf$/);
    expect(postScriptName(require.resolve(ionicons ?? ""))).toBe("Ionicons");
  });
});

describe("app.config iOS permission texts in the app's languages", () => {
  const locales = (config.locales ?? {}) as Record<
    string,
    { ios?: Record<string, string> }
  >;
  const english = infoPlistPermissionStrings(PERMISSION_TEXTS.en);

  it("gives Sorani, Kurmanji and Arabic every permission text English has", () => {
    const declared = (
      pluginOptions("expo-localization")?.supportedLocales as { ios: string[] }
    ).ios;
    expect(Object.keys(locales).sort()).toEqual(
      declared.filter((l) => l !== "en").sort(),
    );
    for (const lang of ["ckb", "kmr", "ar"]) {
      const strings = locales[lang]?.ios ?? {};
      expect(Object.keys(strings).sort()).toEqual(Object.keys(english).sort());
      for (const [key, value] of Object.entries(strings)) {
        expect([lang, key, value.trim().length > 20]).toEqual([lang, key, true]);
        expect(value).not.toEqual(english[key]);
      }
    }
  });

  it("uses the English texts as the base in Info.plist", () => {
    expect(pluginOptions("expo-image-picker")).toMatchObject({
      photosPermission: PERMISSION_TEXTS.en.photos,
      cameraPermission: PERMISSION_TEXTS.en.camera,
    });
    expect(pluginOptions("expo-camera")).toMatchObject({
      cameraPermission: PERMISSION_TEXTS.en.camera,
    });
    expect(pluginOptions("expo-location")).toMatchObject({
      locationWhenInUsePermission: PERMISSION_TEXTS.en.location,
    });
    expect(pluginOptions("expo-sensors")).toMatchObject({
      motionPermission: PERMISSION_TEXTS.en.motion,
    });
  });

  it("writes texts the .strings files can hold as they are (no quotes, backslashes or line breaks)", () => {
    for (const texts of Object.values(PERMISSION_TEXTS)) {
      for (const value of Object.values(texts)) {
        expect(value).not.toMatch(/["\\\n]/);
      }
    }
  });

  it("follows the app's language rules for the brand and the script", () => {
    for (const value of Object.values(PERMISSION_TEXTS.ckb)) {
      expect(value.startsWith("بوومەلەرزە")).toBe(true);
      // Arabic ي ك ة in Sorani means machine Arabic leaked in.
      expect(value).not.toMatch(/[\u064A\u0643\u0629]/);
    }
    for (const value of Object.values(PERMISSION_TEXTS.ar)) {
      expect(value).toContain("\u2066Bumelerze\u2069");
      expect(value).not.toMatch(/[ێەڵڕۆ]/);
    }
    for (const value of Object.values(PERMISSION_TEXTS.kmr)) {
      expect(value.startsWith("Bumelerze ")).toBe(true);
    }
    for (const texts of Object.values(PERMISSION_TEXTS)) {
      for (const value of Object.values(texts)) {
        expect(value).not.toMatch(/ShakeMap|\bfree\b/i);
      }
    }
  });
});
