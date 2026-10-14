import * as Font from "expo-font";

/**
 * Registers a cut-down Ionicons font (only the icons this app uses,
 * `scripts/build-web-icon-font.py`) under the family name the icon component
 * asks for, before any icon renders. expo-font loads each family once, so
 * the full 390 KB font is then never downloaded on the web.
 *
 * Imported for its side effect at the top of `app/_layout.tsx`.
 */
Font.loadAsync({
  ionicons: require("../../assets/fonts/web/Ionicons-subset.ttf"),
}).catch(() => {
  // Offline on a first visit: icons appear once the font can be fetched.
});
