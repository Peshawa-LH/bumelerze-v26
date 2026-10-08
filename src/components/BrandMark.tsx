import { Image } from "expo-image";
import { StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";

/**
 * The app's horizontal logo (the owner's own package, `assets/brand/README.md`):
 * the primary mark on light, the reversed mark on dark. Rendered by
 * `expo-image`; there is no SVG-as-component transformer in this app and none
 * is needed for a static image. Shown in the Settings footer and on About.
 */
export function BrandMark() {
  const { t } = useTranslation();
  const { scheme } = useTheme();
  const source =
    scheme === "dark"
      ? require("../../assets/brand/logo/bumelerze-primary-horizontal-reversed.svg")
      : require("../../assets/brand/logo/bumelerze-primary-horizontal.svg");

  return (
    <Image
      source={source}
      contentFit="contain"
      accessibilityLabel={t("settings.footerLogoA11yLabel")}
      style={styles.logo}
    />
  );
}

const styles = StyleSheet.create({
  // The horizontal mark's own 5:1 box (`viewBox="0 0 1800 360"`), at a width
  // that reads as a signature rather than a banner. `alignSelf` keeps it at
  // the reading start under RTL.
  logo: { width: 180, height: 36, alignSelf: "flex-start" },
});
