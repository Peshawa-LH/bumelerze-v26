import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { isRTLLocale } from "@/i18n";
import { useTheme } from "@/theme";

/** "Forward" chevron that points toward the reading end: right in LTR,
 * left in Sorani and Arabic. Decorative (the row it sits in carries the
 * label). The direction comes from the locale, the one signal that is
 * trustworthy on both native and web (see `HeaderBackButton`). */
export function DirectionalChevron({
  size = 20,
  color,
}: {
  size?: number;
  color?: string;
}) {
  const { i18n } = useTranslation();
  const { colors } = useTheme();
  return (
    <Ionicons
      testID="directional-chevron"
      name={isRTLLocale(i18n.language) ? "chevron-back" : "chevron-forward"}
      size={size}
      color={color ?? colors.text.tertiary}
    />
  );
}
