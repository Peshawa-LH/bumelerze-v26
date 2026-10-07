import { useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { useTranslation } from "react-i18next";

import { formatIntensity } from "@/features/shakemap";
import { useTheme } from "@/theme";

import { MiniShakingMap } from "../MiniShakingMap";

const LEGEND_LEVELS: readonly number[] = [4, 5, 6, 7];
const FALLBACK_WIDTH = 260;

/** Map: a still shaking-map drawing with fault lines and its intensity legend. */
export function MapPreview() {
  const { i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [width, setWidth] = useState(FALLBACK_WIDTH);

  function onLayout(event: LayoutChangeEvent) {
    const measured = Math.floor(event.nativeEvent.layout.width);
    if (measured > 0) setWidth(measured);
  }

  return (
    <View style={{ gap: spacing[3] }}>
      <View
        onLayout={onLayout}
        style={{
          borderRadius: 12,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: colors.border.default,
          // A map does not mirror in right-to-left languages.
          direction: "ltr",
        }}
      >
        <MiniShakingMap width={Math.max(width - 2, 1)} />
      </View>
      {/* Same rule as the real legend: numerals read left to right. */}
      <View style={{ flexDirection: "row", gap: spacing[2], direction: "ltr" }}>
        {LEGEND_LEVELS.map((level) => (
          <View
            key={level}
            style={{
              flex: 1,
              minHeight: 28,
              borderRadius: 8,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.intensity[level] ?? colors.surface.sunken,
            }}
          >
            <Text
              style={{
                color: colors.intensityOnFill[level] ?? colors.text.primary,
                fontSize: typography.labelCaption.fontSize,
                fontWeight: "700",
              }}
            >
              {formatIntensity(level, i18n.language)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
