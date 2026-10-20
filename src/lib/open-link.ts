import * as WebBrowser from "expo-web-browser";
import { Linking, Platform } from "react-native";

/**
 * Opens an outside web page (the privacy policy, an Atlas PDF report, the
 * MapTiler site) without losing the person's place in the app.
 *
 * Web: a new browser tab, as before (`Linking.openURL` in react-native-web
 * opens `_blank`). Phone: an in-app browser sheet (`SFSafariViewController`
 * on iOS, a Custom Tab on Android) with a Done button back to the same
 * screen, which is the phone's equivalent of that tab. Plain
 * `Linking.openURL` switched the iPhone over to Safari.
 *
 * Anything that is not an http(s) page (mailto:, tel:) goes to the system,
 * and so does a page the in-app browser refuses (another one is already
 * open). Rejects only when nothing could open the link, so callers can show
 * their own "could not open" message.
 */
export async function openLink(url: string): Promise<void> {
  if (Platform.OS === "web" || !/^https?:\/\//i.test(url)) {
    await Linking.openURL(url);
    return;
  }
  try {
    await WebBrowser.openBrowserAsync(url, {
      dismissButtonStyle: "done",
      enableBarCollapsing: true,
    });
  } catch {
    await Linking.openURL(url);
  }
}
