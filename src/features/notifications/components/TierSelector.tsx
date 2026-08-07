import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { NotificationTier } from "@/features/onboarding";
import { NOTIFICATION_TIERS } from "@/features/onboarding";
import { useTheme } from "@/theme";

interface TierSelectorProps {
  value: NotificationTier;
  onChange: (tier: NotificationTier) => void;
  /** HomeBase section passes this true when no HomeBase town is set —
   * spec-v1.md §4.10: "disables tiers when no HomeBase". Rows still render
   * (so the tier the user last set stays visible) but cannot be pressed. */
  disabled?: boolean;
}

/**
 * Preset-tier picker (spec-v1.md §4.10: "not raw numeric sliders" — five
 * fixed rows, off/all/M3+/M4+/M5+). Full-width stacked rows rather than a
 * horizontal 5-way segmented control, deliberately — this app's panic-time
 * typography runs large (Sorani especially), and five cramped horizontal
 * segments would fail the "big touch targets" requirement long before the
 * label text does. Same row visual language as
 * `features/onboarding/components/TownPicker.tsx` and the Settings
 * language rows, so the whole app's "pick one of N" pattern stays visually
 * consistent. RTL-correct by construction: no left/right, no manual
 * row-reverse — `I18nManager.forceRTL` (set at locale-switch time) already
 * mirrors `flexDirection: "row"` and logical start/end padding for ckb/ar.
 */
export function TierSelector({ value, onChange, disabled = false }: TierSelectorProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  return (
    <View style={{ gap: spacing[2] }} accessibilityRole="radiogroup">
      {NOTIFICATION_TIERS.map((tier) => {
        const isActive = value === tier;
        return (
          <Pressable
            key={tier}
            accessibilityRole="radio"
            accessibilityState={{ selected: isActive, disabled, checked: isActive }}
            disabled={disabled}
            onPress={() => onChange(tier)}
            style={[
              styles.row,
              {
                borderColor: isActive ? colors.brand.primary : colors.border.default,
                backgroundColor: isActive ? colors.surface.raised : "transparent",
                paddingVertical: spacing[3],
                paddingStart: spacing[4],
                paddingEnd: spacing[4],
                opacity: disabled ? 0.5 : 1,
              },
            ]}
          >
            <Text
              allowFontScaling
              style={{
                color: colors.text.primary,
                fontSize: typography.bodyDefault.fontSize,
                lineHeight: typography.bodyDefault.lineHeight,
                fontWeight: isActive ? "700" : "400",
              }}
            >
              {t(`notificationSettings.tiers.${tier}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 2,
    borderRadius: 12,
    minHeight: 48,
    justifyContent: "center",
  },
});
