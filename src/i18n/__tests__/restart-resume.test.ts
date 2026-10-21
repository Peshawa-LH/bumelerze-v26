/**
 * After a language switch restarts the app inside the same process, iOS came
 * back on Home or on an earthquake page opened from a link long before, not
 * on Settings where the switch was made (parity re-check K1). The switcher
 * notes where to come back to and forgets the opened link; the first address
 * after the restart is the noted screen, once.
 */
import * as Linking from "expo-linking";
import { Platform, Settings } from "react-native";

import {
  forgetOpenedLink,
  rememberRestartResume,
  RESTART_RESUME_MAX_AGE_MS,
  takeRestartResume,
} from "../restart-resume";

// The app's user defaults, behind React Native's own `Settings` (iOS).
jest.mock("react-native/Libraries/Settings/NativeSettingsManager", () => ({
  __esModule: true,
  default: {
    getConstants: () => ({ settings: {} }),
    setValues: jest.fn(),
    deleteValues: jest.fn(),
  },
}));

const KEY = "bumelerze.resumeAfterRestart";
const ORIGINAL_OS = Platform.OS;
const stored = () => Settings.get(KEY) as unknown;

beforeEach(() => {
  Settings.set({ [KEY]: null });
});

afterEach(() => {
  jest.restoreAllMocks();
  Platform.OS = ORIGINAL_OS;
});

describe("the screen to come back to after a restart", () => {
  it("[regression] gives back the noted screen once, right after the restart", () => {
    rememberRestartResume("/settings", 1_000);
    expect(takeRestartResume(1_500)).toBe("/settings");
    // Used: a later start (or restart) opens what it would have opened.
    expect(stored()).toBeNull();
    expect(takeRestartResume(1_600)).toBeNull();
  });

  it("ignores a note from an earlier run", () => {
    rememberRestartResume("/settings", 1_000);
    expect(takeRestartResume(1_000 + RESTART_RESUME_MAX_AGE_MS + 1)).toBeNull();
    expect(stored()).toBeNull();
  });

  it("ignores anything that is not an app path", () => {
    Settings.set({ [KEY]: JSON.stringify({ path: "https://example.com", at: 1_000 }) });
    expect(takeRestartResume(1_100)).toBeNull();
    Settings.set({ [KEY]: "not json" });
    expect(takeRestartResume(1_100)).toBeNull();
    Settings.set({ [KEY]: JSON.stringify({ path: "/settings", at: 2_000 }) });
    expect(takeRestartResume(1_100)).toBeNull();
  });

  it("keeps nothing off iOS", () => {
    Platform.OS = "web";
    rememberRestartResume("/settings", 1_000);
    expect(stored()).toBeNull();
    expect(takeRestartResume(1_100)).toBeNull();
  });
});

describe("forgetOpenedLink", () => {
  it("[regression] clears the link iOS would open again after the restart", () => {
    const clear = jest
      .spyOn(Linking, "clearInitialURL")
      .mockImplementation(() => undefined);
    forgetOpenedLink();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("does nothing on the web", () => {
    Platform.OS = "web";
    const clear = jest
      .spyOn(Linking, "clearInitialURL")
      .mockImplementation(() => undefined);
    forgetOpenedLink();
    expect(clear).not.toHaveBeenCalled();
  });
});
