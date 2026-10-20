import config, { expoAccountConfig } from "../../app.config";

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
    build: Record<string, { channel?: string }>;
  };

  it("gives every build profile its own EAS Update channel", () => {
    expect(eas.build.development?.channel).toBe("development");
    expect(eas.build.preview?.channel).toBe("preview");
    expect(eas.build.production?.channel).toBe("production");
  });
});
