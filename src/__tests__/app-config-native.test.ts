import fs from "node:fs";
import path from "node:path";

import config, { appleTeamConfig, expoAccountConfig } from "../../app.config";
import { APP_ORIGIN } from "../config/urls";

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
