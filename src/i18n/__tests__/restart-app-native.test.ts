/**
 * iOS/Android restart after a direction-changing language switch
 * (`restart-app.native.ts`; the web keeps `restart-app.ts`).
 *
 * The bug this would have caught: in a development build `Updates.reloadAsync`
 * rejects (`ERR_UPDATES_DISABLED`), so picking Sorani in Settings showed
 * "restart the app yourself" instead of restarting.
 */
import * as Updates from "expo-updates";
import { DevSettings } from "react-native";

import { restartApp } from "../restart-app";

jest.mock("expo-updates", () => ({ reloadAsync: jest.fn() }));
// The real module builds a NativeEventEmitter on load, which warns under jest.
jest.mock("react-native/Libraries/Utilities/DevSettings", () => ({
  __esModule: true,
  default: { reload: jest.fn(), addMenuItem: jest.fn() },
}));

const reloadAsync = Updates.reloadAsync as jest.MockedFunction<typeof Updates.reloadAsync>;
const globalWithDev = globalThis as typeof globalThis & { __DEV__: boolean };
const ORIGINAL_DEV = globalWithDev.__DEV__;

const devReload = DevSettings.reload as jest.MockedFunction<typeof DevSettings.reload>;

beforeEach(() => {
  reloadAsync.mockReset();
  devReload.mockClear();
});

afterEach(() => {
  globalWithDev.__DEV__ = ORIGINAL_DEV;
});

it("restarts through expo-updates when it can (release builds)", async () => {
  reloadAsync.mockResolvedValue(undefined);

  await restartApp();

  expect(reloadAsync).toHaveBeenCalledTimes(1);
  expect(devReload).not.toHaveBeenCalled();
});

it("[regression] falls back to the developer reload in a development build", async () => {
  globalWithDev.__DEV__ = true;
  reloadAsync.mockRejectedValue(new Error("ERR_UPDATES_DISABLED"));

  await expect(restartApp()).resolves.toBeUndefined();

  expect(devReload).toHaveBeenCalledTimes(1);
});

it("passes the failure on in a release build, so the caller can ask the user to reopen the app", async () => {
  globalWithDev.__DEV__ = false;
  reloadAsync.mockRejectedValue(new Error("no runtime"));

  await expect(restartApp()).rejects.toThrow("no runtime");

  expect(devReload).not.toHaveBeenCalled();
});
