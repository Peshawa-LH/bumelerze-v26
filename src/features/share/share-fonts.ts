import * as Font from "expo-font";
import { Platform } from "react-native";

import { SHARE_FONT_BOLD, SHARE_FONT_REGULAR } from "./share-font-names";

let loading: Promise<void> | null = null;

/**
 * Makes sure the two faces the share card draws with are registered.
 *
 * iOS/Android register all Vazirmatn faces at launch (app/_layout.tsx). The
 * web downloads them only while Sorani or Arabic is the language, so in
 * English and Kurmanji the card's `Vazirmatn-Regular`/`-Bold` were unknown to
 * the browser and the on-screen SVG fell back to a serif face (review A-2,
 * B-2). The exported PNG was always right (the fonts are embedded in it).
 * Called when a card first renders: the two files (about 140 KB) are fetched
 * once, only by people who open a share card or the Event hub's first slide,
 * never as part of the first download.
 */
export function ensureShareFontsLoaded(): Promise<void> {
  if (Platform.OS !== "web") {
    return Promise.resolve();
  }
  if (Font.isLoaded(SHARE_FONT_REGULAR) && Font.isLoaded(SHARE_FONT_BOLD)) {
    return Promise.resolve();
  }
  if (!loading) {
    loading = Font.loadAsync({
      [SHARE_FONT_REGULAR]: require("../../../assets/fonts/Vazirmatn-Regular.ttf"),
      [SHARE_FONT_BOLD]: require("../../../assets/fonts/Vazirmatn-Bold.ttf"),
    }).catch(() => {
      // Offline before the files were ever fetched: the card shows in the
      // fallback face; the next card tries again.
      loading = null;
    });
  }
  return loading;
}
