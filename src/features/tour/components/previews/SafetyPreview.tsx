import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import {
  SAFETY_ARTWORK,
  safetyCardTitleKey,
  type SafetyImageId,
  type SafetySectionId,
} from "@/features/safety";
import { useTheme } from "@/theme";

/** One guide from each tab: before, during and after. */
const SAMPLE_GUIDES: readonly {
  section: SafetySectionId;
  cardId: string;
  image: SafetyImageId;
}[] = [
  { section: "prepare", cardId: "emergencyKit", image: "emergencyKit" },
  { section: "survive", cardId: "dropCoverHold", image: "dropCoverHold" },
  { section: "recover", cardId: "aftershocks", image: "aftershocks" },
];

/** Safety: three guide rows with their artwork, as in the Safety guide. */
export function SafetyPreview() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  return (
    <View style={{ gap: spacing[2] }}>
      {SAMPLE_GUIDES.map(({ section, cardId, image }) => (
        <View
          key={cardId}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing[3],
            padding: spacing[2],
            borderWidth: 1,
            borderRadius: 14,
            backgroundColor: colors.surface.raised,
            borderColor: colors.border.default,
          }}
        >
          <Image
            source={SAFETY_ARTWORK[image]}
            contentFit="cover"
            style={{ width: 56, height: 56, borderRadius: 10 }}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.labelCaption.fontSize,
                fontWeight: typography.labelCaption.fontWeight,
              }}
            >
              {t(`safety.tabs.${section}`)}
            </Text>
            <Text
              style={{
                color: colors.text.primary,
                fontSize: typography.bodyDefault.fontSize,
                fontWeight: "600",
              }}
            >
              {t(safetyCardTitleKey(cardId))}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}
