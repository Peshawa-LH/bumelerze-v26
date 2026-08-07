import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { formatAbsoluteDual, isolateNumeric } from "../format";

interface OfflineBannerProps {
  dataUpdatedAt: number;
}

/**
 * Shown above the feed when the latest background fetch failed but cached
 * data still renders (spec-v1.md §4.1 offline state: "cached feed shown
 * with a clear 'last updated' timestamp and offline indicator"). Uses a
 * neutral surface + accent border rather than a full status-color fill —
 * design-language.md §1.7 ("calm, not clinical... no red/loud chrome on
 * neutral screens") and status colors aren't theme-split (§3), so a solid
 * fill can't be guaranteed AA-contrast text in both themes the way the
 * theme's own surface/text tokens are.
 */
export function OfflineBanner({ dataUpdatedAt }: OfflineBannerProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  const { local } = formatAbsoluteDual(dataUpdatedAt, i18n.language, t);

  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: colors.surface.sunken,
          borderBottomColor: colors.status.warning,
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[2],
          gap: spacing[2],
        },
      ]}
      accessibilityRole="text"
      // Announces itself when it mounts/updates on Android TalkBack (the
      // offline/stale-data state is a material change users need to know
      // about without hunting for it — accessibility-tester Phase 5 audit,
      // PROJECT.md "works on weak networks"). iOS VoiceOver ignores this prop
      // entirely, so `EventListScreen` separately calls
      // `AccessibilityInfo.announceForAccessibility` on the same
      // false->true transition to cover VoiceOver too.
      accessibilityLiveRegion="polite"
    >
      <Ionicons name="cloud-offline-outline" size={16} color={colors.text.secondary} />
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
          flexShrink: 1,
        }}
      >
        {t("events.offlineBanner", { time: isolateNumeric(local) })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 2,
  },
});
