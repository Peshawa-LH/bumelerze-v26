import * as Updates from "expo-updates";

/**
 * Reloads the JS runtime so a forceRTL() direction flip actually takes
 * effect (design-language.md §5). `Updates.reloadAsync` can throw in
 * environments without a full Updates runtime (e.g. some Expo Go sessions);
 * callers must already be showing a "restarting…" state and should fall
 * back to asking the user to relaunch manually if this rejects.
 */
export async function restartApp(): Promise<void> {
  await Updates.reloadAsync();
}
