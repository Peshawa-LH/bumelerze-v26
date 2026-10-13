import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import { SafeButton } from "@/features/safe/components/SafeButton";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

const noop = () => undefined;

/** Two family members already checked in (drawn), one not heard from yet. */
const SAMPLE_MEMBERS: readonly boolean[] = [true, true, false];

/** I'm safe: the real "I'm safe" button and a drawn family status list. */
export function SafePreview() {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const checkedIn = SAMPLE_MEMBERS.filter(Boolean).length;
  return (
    <View style={{ gap: spacing[3] }}>
      <SafeButton label={t("imSafe.button.safe")} onPress={noop} />
      <View
        style={{
          gap: spacing[2],
          padding: spacing[3],
          borderWidth: 1,
          borderRadius: 14,
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
        }}
      >
        <Text
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
            fontWeight: "600",
          }}
        >
          {t("imSafe.family.title")}
        </Text>
        <Text style={{ color: colors.text.secondary, fontSize: typography.bodyMeta.fontSize }}>
          {t("imSafe.family.summary", {
            n: localizeDigits(String(checkedIn), i18n.language),
            total: localizeDigits(String(SAMPLE_MEMBERS.length), i18n.language),
          })}
        </Text>
        {SAMPLE_MEMBERS.map((safe, index) => (
          <View
            key={index}
            style={{ flexDirection: "row", alignItems: "center", gap: spacing[3] }}
          >
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: colors.surface.sunken,
              }}
            />
            <View
              style={{
                flex: 1,
                height: 8,
                borderRadius: 4,
                backgroundColor: colors.border.default,
              }}
            />
            <Ionicons
              name={safe ? "checkmark-circle" : "ellipse-outline"}
              size={20}
              color={safe ? colors.status.success : colors.text.tertiary}
            />
          </View>
        ))}
      </View>
    </View>
  );
}
