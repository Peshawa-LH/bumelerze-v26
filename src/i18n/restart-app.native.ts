import * as Updates from "expo-updates";
import { DevSettings } from "react-native";

/**
 * iOS/Android: reloads the JS runtime so a language change that flips the
 * reading direction takes effect (React Native reads its RTL flag once,
 * when the app's JS starts). The web keeps `restart-app.ts`.
 *
 * `Updates.reloadAsync` restarts release builds (with or without EAS
 * Update configured: expo-updates' disabled controller still recreates the
 * React context). In a development build it is refused by the JS side of
 * expo-updates in some set-ups (`ERR_UPDATES_DISABLED`), so a debug build
 * falls back to React Native's own developer reload, which reloads the
 * bundle from Metro. A release build has no such fallback: the rejection
 * reaches the caller, which tells the user to reopen the app.
 */
export async function restartApp(): Promise<void> {
  try {
    await Updates.reloadAsync();
  } catch (error) {
    if (__DEV__) {
      DevSettings.reload();
      return;
    }
    throw error;
  }
}
