import { Linking } from "react-native";

import { isAllowedLink } from "./link-scheme";

/**
 * Browser twin of `open-link.ts`: a new tab, and the app stays where it was
 * (react-native-web's `Linking.openURL` opens `_blank`). Kept apart so the
 * phone's in-app browser module never reaches the web bundle. The same links
 * are refused as on the phone (`link-scheme.ts`).
 */
export async function openLink(url: string): Promise<void> {
  if (!isAllowedLink(url)) {
    throw new Error("openLink: link not allowed");
  }
  await Linking.openURL(url);
}
