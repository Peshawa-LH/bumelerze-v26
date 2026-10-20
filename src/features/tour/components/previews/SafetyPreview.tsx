import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import { SettingsGroup } from "@/features/account/components/SettingsGroup";
import { SettingsRow } from "@/features/account/components/SettingsRow";

import {
  SAFETY_ARTWORK,
  safetyCardTitleKey,
  type SafetyImageId,
  type SafetySectionId,
} from "@/features/safety";
import { useTheme, nativeFontFamily, READING_START } from "@/theme";

/** One guide from before and one from during an earthquake. */
const SAMPLE_GUIDES: readonly {
  section: SafetySectionId;
  cardId: string;
  image: SafetyImageId;
}[] = [
  { section: "prepare", cardId: "emergencyKit", image: "emergencyKit" },
  { section: "survive", cardId: "dropCoverHold", image: "dropCoverHold" },
];

/** Be ready: two Safety guide rows with their artwork, then the "Tag my
 * building" row as it appears on the Profile page. */
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
            // Decorative (review E-9): the guide's section and title sit
            // right next to it.
            testID="tour-preview-graphic"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.labelCaption.fontSize,
                fontFamily: nativeFontFamily(typography.labelCaption),
                ...READING_START,
                fontWeight: typography.labelCaption.fontWeight,
              }}
            >
              {t(`safety.tabs.${section}`)}
            </Text>
            <Text
              style={{
                color: colors.text.primary,
                fontSize: typography.bodyDefault.fontSize,
                fontFamily: nativeFontFamily(typography.bodyDefault, "600"),
                ...READING_START,
                fontWeight: "600",
              }}
            >
              {t(safetyCardTitleKey(cardId))}
            </Text>
          </View>
        </View>
      ))}
      <SettingsGroup>
        <SettingsRow icon="home-outline" label={t("building.title")} />
      </SettingsGroup>
    </View>
  );
}
