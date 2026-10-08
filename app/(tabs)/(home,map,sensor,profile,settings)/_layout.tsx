import { Stack } from "expo-router";

import { useStackScreenOptions } from "@/components/use-stack-screen-options";

/**
 * Every tab's own navigation stack: this one file becomes five layouts,
 * `(home)/_layout`, `(map)/_layout`, ... (expo-router array groups). The tab's
 * root screen lives in its own folder (`(home)/index.tsx`, `(map)/map.tsx`,
 * ...); every screen in THIS folder is shared, so it exists inside each tab and
 * opens inside whichever tab the user is in, with the tab bar still showing and
 * Back returning within the tab. The URL has no group in it, so `/event/<id>`,
 * `/u/<name>`, `/safety` ... are the same everywhere (deep links, shared
 * links, the web base path).
 *
 * Full-screen flows (felt report, tagging a building, onboarding, sign-in,
 * tour, feedback, admin) are NOT here: they stay in the root Stack and cover
 * the tabs.
 */
export default function TabStackLayout() {
  return <Stack screenOptions={useStackScreenOptions()} />;
}

/**
 * Each tab's own first screen. A tab that has never been opened starts its
 * stack here (without this a tap on the Settings tab opens whichever screen
 * sorts first, e.g. /world). Every group has one, so all five rank equally when a link
 * could open in any of them; the tie goes to the alphabetically first group,
 * `home`, so a link opened cold lands in Home (when the app is already in a tab
 * it opens there). `tab-navigation-structure.test` pins both.
 */
export const unstable_settings = {
  home: { anchor: "index" },
  map: { anchor: "map" },
  sensor: { anchor: "sensor" },
  profile: { anchor: "profile" },
  settings: { anchor: "settings" },
};
