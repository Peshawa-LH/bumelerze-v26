import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Text, View, type LayoutChangeEvent } from "react-native";

import { formatMagnitudeValue } from "@/features/events";
import { isRTLLocale } from "@/i18n";
import { useTheme } from "@/theme";
import { lightColors } from "@/theme/semantic";

import { MiniShakingMap } from "../MiniShakingMap";

const FALLBACK_WIDTH = 260;
const CARD_MAX_WIDTH = 220;
const SAMPLE_MAGNITUDE = 4.1;

/** Share: a small copy of the share card (always light, like the real image)
 * with the two ways to send it. Drawn with views, not the real card, which
 * carries its fonts and QR code: far more than a picture on a tour needs. */
export function SharePreview() {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const rtl = isRTLLocale(i18n.language);

  function onLayout(event: LayoutChangeEvent) {
    const measured = Math.floor(event.nativeEvent.layout.width);
    if (measured > 0) setWidth(measured);
  }

  const cardWidth = Math.min(width, CARD_MAX_WIDTH);
  const options = [
    { icon: "link-outline", label: t("share.link") },
    { icon: "image-outline", label: t("share.imageSquare") },
  ] as const;

  return (
    <View onLayout={onLayout} style={{ gap: spacing[3] }}>
      <View
        style={{
          alignSelf: "center",
          width: cardWidth,
          borderRadius: 14,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: lightColors.border.default,
          backgroundColor: lightColors.surface.raised,
          // The card is an image: it does not mirror.
          direction: "ltr",
        }}
      >
        <MiniShakingMap width={cardWidth - 2} detail={false} />
        <View style={{ padding: spacing[3], gap: 2 }}>
          <Text
            style={{
              color: lightColors.text.primary,
              fontSize: typography.h2.fontSize,
              fontWeight: "800",
              fontVariant: ["tabular-nums"],
              writingDirection: rtl ? "rtl" : "ltr",
            }}
          >
            {t("events.magnitudeDisplay", {
              value: formatMagnitudeValue(SAMPLE_MAGNITUDE, i18n.language),
            })}
          </Text>
          <View
            style={{
              height: 8,
              width: "70%",
              borderRadius: 4,
              backgroundColor: lightColors.border.default,
            }}
          />
        </View>
      </View>
      {options.map(({ icon, label }) => (
        <View
          key={icon}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing[3],
            minHeight: 44,
            paddingHorizontal: spacing[3],
            borderWidth: 1,
            borderRadius: 12,
            backgroundColor: colors.surface.raised,
            borderColor: colors.border.default,
          }}
        >
          <Ionicons name={icon} size={20} color={colors.brand.primary} />
          <Text
            style={{
              flex: 1,
              color: colors.text.primary,
              fontSize: typography.bodyDefault.fontSize,
            }}
          >
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}
