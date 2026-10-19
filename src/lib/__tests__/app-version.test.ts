import { appBuildId, appVersion, appVersionStamp, shortBuildId } from "../app-version";

/**
 * The version and web build id stamp (D90). `expo-constants` is mocked so the
 * version is the mock's, not whatever app.config.ts says today; the build id
 * is read from `process.env.EXPO_PUBLIC_BUILD_ID` at call time.
 */

const mockConstants: { expoConfig: { version?: string } | null } = {
  expoConfig: { version: "26.3.0" },
};
jest.mock("expo-constants", () => ({
  __esModule: true,
  get default() {
    return mockConstants;
  },
}));

const SHA = "0123abcdef4567890123abcdef4567890123abcd";
// The live check in touch_presence (migration 0055).
const PRESENCE_VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/;

describe("app version and build id", () => {
  const originalBuildId = process.env.EXPO_PUBLIC_BUILD_ID;

  afterEach(() => {
    mockConstants.expoConfig = { version: "26.3.0" };
    if (originalBuildId === undefined) {
      delete process.env.EXPO_PUBLIC_BUILD_ID;
    } else {
      process.env.EXPO_PUBLIC_BUILD_ID = originalBuildId;
    }
  });

  it("shortens a commit SHA to 7 characters", () => {
    expect(shortBuildId(SHA)).toBe("0123abc");
    expect(shortBuildId("abcdef1")).toBe("abcdef1");
  });

  it("gives no build id for development, local, native or odd values", () => {
    for (const raw of [
      undefined,
      null,
      "",
      "dev",
      "local",
      "abc123",
      "ABCDEF1234",
      `${SHA}0`,
      "abcdefg",
    ]) {
      expect(shortBuildId(raw)).toBeNull();
    }
  });

  it("stamps version+build on a hosted web build", () => {
    process.env.EXPO_PUBLIC_BUILD_ID = SHA;
    expect(appVersion()).toBe("26.3.0");
    expect(appBuildId()).toBe("0123abc");
    expect(appVersionStamp()).toBe("26.3.0+0123abc");
    expect(appVersionStamp()).toMatch(PRESENCE_VERSION);
  });

  it("stamps the bare version without a build id", () => {
    delete process.env.EXPO_PUBLIC_BUILD_ID;
    expect(appBuildId()).toBeNull();
    expect(appVersionStamp()).toBe("26.3.0");

    process.env.EXPO_PUBLIC_BUILD_ID = "local";
    expect(appVersionStamp()).toBe("26.3.0");
  });

  it("has no version or stamp when the config has none", () => {
    process.env.EXPO_PUBLIC_BUILD_ID = SHA;
    mockConstants.expoConfig = null;
    expect(appVersion()).toBeNull();
    expect(appVersionStamp()).toBeNull();
    mockConstants.expoConfig = { version: "" };
    expect(appVersionStamp()).toBeNull();
  });
});
