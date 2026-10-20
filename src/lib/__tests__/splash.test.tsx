/**
 * iOS/Android first frame (`src/lib/splash.ts`): the splash screen stays up
 * until the root layout says the first screen can draw, never longer than
 * SPLASH_MAX_HOLD_MS, and the window behind the screens takes the app's
 * background colour.
 */
import { act, render } from "@testing-library/react-native";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";

import {
  holdSplashScreen,
  resetSplashScreenForTests,
  SPLASH_MAX_HOLD_MS,
  useSplashScreenGate,
  useSystemBackgroundColor,
} from "../splash";

jest.mock("expo-splash-screen", () => ({
  setOptions: jest.fn(),
  preventAutoHideAsync: jest.fn(async () => true),
  hide: jest.fn(),
}));
jest.mock("expo-system-ui", () => ({
  setBackgroundColorAsync: jest.fn(async () => undefined),
}));

function Gate({ ready }: { ready: boolean }) {
  useSplashScreenGate(ready);
  return null;
}

function Background({ color }: { color: string }) {
  useSystemBackgroundColor(color);
  return null;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  resetSplashScreenForTests();
});

afterEach(() => {
  jest.useRealTimers();
});

it("keeps the splash screen up from the moment the root layout loads, and fades it out", () => {
  holdSplashScreen();
  expect(SplashScreen.preventAutoHideAsync).toHaveBeenCalledTimes(1);
  expect(SplashScreen.setOptions).toHaveBeenCalledWith({ duration: 200, fade: true });
});

it("does not hide the splash screen while the first screen cannot draw yet", async () => {
  await render(<Gate ready={false} />);
  await act(async () => {
    jest.advanceTimersByTime(SPLASH_MAX_HOLD_MS - 1);
  });
  expect(SplashScreen.hide).not.toHaveBeenCalled();
});

it("hides the splash screen one frame after the first screen is ready, once", async () => {
  const view = await render(<Gate ready={false} />);
  await view.rerender(<Gate ready />);
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  expect(SplashScreen.hide).toHaveBeenCalledTimes(1);

  await view.rerender(<Gate ready={false} />);
  await view.rerender(<Gate ready />);
  await act(async () => {
    jest.advanceTimersByTime(SPLASH_MAX_HOLD_MS);
  });
  expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
});

it("never holds the splash screen longer than the panic-time limit", async () => {
  await render(<Gate ready={false} />);
  await act(async () => {
    jest.advanceTimersByTime(SPLASH_MAX_HOLD_MS);
  });
  expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
});

it("gives the window behind the screens the app's background, also after a theme change", async () => {
  const view = await render(<Background color="#FFFFFF" />);
  expect(SystemUI.setBackgroundColorAsync).toHaveBeenLastCalledWith("#FFFFFF");
  await view.rerender(<Background color="#000000" />);
  expect(SystemUI.setBackgroundColorAsync).toHaveBeenLastCalledWith("#000000");
});
