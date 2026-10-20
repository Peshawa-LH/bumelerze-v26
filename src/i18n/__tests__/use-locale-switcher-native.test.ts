/**
 * `useLocaleSwitcher` and the layout direction on iOS/Android.
 *
 * The bug this would have caught: on a Sorani phone whose app started left
 * to right, choosing Sorani (already the app language) in onboarding or
 * Settings did nothing, because the switcher returned early for "same
 * language" without looking at the direction.
 */
import { act, renderHook } from "@testing-library/react-native";
import { I18nManager, Platform } from "react-native";

import i18n from "../index";
import { restartApp } from "../restart-app";
import { useLocaleSwitcher } from "../use-locale-switcher";

jest.mock("../restart-app", () => ({ restartApp: jest.fn(async () => undefined) }));

const mockedRestart = restartApp as jest.MockedFunction<typeof restartApp>;
const ORIGINAL_IS_RTL = I18nManager.isRTL;
const ORIGINAL_OS = Platform.OS;

function setIsRTL(value: boolean): void {
  (I18nManager as { isRTL: boolean }).isRTL = value;
}

beforeEach(() => {
  mockedRestart.mockClear();
});

afterEach(async () => {
  setIsRTL(ORIGINAL_IS_RTL);
  Platform.OS = ORIGINAL_OS;
  await i18n.changeLanguage("en");
});

it("[regression] re-picking Sorani while the layout runs left to right restarts into right to left", async () => {
  await i18n.changeLanguage("ckb");
  setIsRTL(false);
  const { result } = await renderHook(() => useLocaleSwitcher());

  let outcome: Awaited<ReturnType<typeof result.current.selectLocale>> | undefined;
  await act(async () => {
    outcome = await result.current.selectLocale("ckb");
  });

  expect(outcome).toEqual({ requiresRestart: true, restartFailed: false });
  expect(mockedRestart).toHaveBeenCalledTimes(1);
});

it("does nothing when the same language is picked and the direction is already right", async () => {
  await i18n.changeLanguage("ckb");
  setIsRTL(true);
  const { result } = await renderHook(() => useLocaleSwitcher());

  let outcome: Awaited<ReturnType<typeof result.current.selectLocale>> | undefined;
  await act(async () => {
    outcome = await result.current.selectLocale("ckb");
  });

  expect(outcome).toEqual({ requiresRestart: false, restartFailed: false });
  expect(mockedRestart).not.toHaveBeenCalled();
});

it("keeps the web's same-language no-op unchanged", async () => {
  await i18n.changeLanguage("ckb");
  setIsRTL(false);
  Platform.OS = "web";
  const { result } = await renderHook(() => useLocaleSwitcher());

  let outcome: Awaited<ReturnType<typeof result.current.selectLocale>> | undefined;
  await act(async () => {
    outcome = await result.current.selectLocale("ckb");
  });

  expect(outcome).toEqual({ requiresRestart: false, restartFailed: false });
  expect(mockedRestart).not.toHaveBeenCalled();
});
