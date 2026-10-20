import { Linking } from "react-native";

/**
 * Browser twin of `open-link.ts`: a new tab, and the app stays where it was
 * (react-native-web's `Linking.openURL` opens `_blank`). Kept apart so the
 * phone's in-app browser module never reaches the web bundle.
 */
export async function openLink(url: string): Promise<void> {
  await Linking.openURL(url);
}
