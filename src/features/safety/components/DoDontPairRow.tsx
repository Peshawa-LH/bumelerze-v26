import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { safetyDoDontKeys, type SafetyDoDontPair } from "../content";

interface DoDontPairRowProps {
  cardId: string;
  pair: SafetyDoDontPair;
}

/**
 * One do/don't pair — LastQuake's cartoon do/don't pattern (teardown-
 * lastquake.md §3: "green ✓ / red ✗ framed") without the cartoon art, which
 * is a future `visual-asset-generator` wave (see `iconPlaceholder` on
 * `SafetyDoDontPair`). The "do" and "dont" rows are each their own
 * accessible element with a localized "Do:"/"Don't:" prefix baked into the
 * accessibility label, so they read as distinct items to a screen reader
 * (not just distinct colors) — the wave brief's "distinct roles"
 * requirement.
 */
export function DoDontPairRow({ cardId, pair }: DoDontPairRowProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { doKey, dontKey } = safetyDoDontKeys(cardId, pair.id);

  const doLabel = t("safety.doLabel");
  const dontLabel = t("safety.dontLabel");
  const doText = t(doKey);
  const dontText = t(dontKey);

  return (
    <View style={{ gap: spacing[2] }}>
      <View
        accessible
        accessibilityLabel={`${doLabel}: ${doText}`}
        style={[
          styles.row,
          {
            backgroundColor: colors.status.success + "1A",
            borderColor: colors.status.success,
            padding: spacing[3],
            gap: spacing[2],
          },
        ]}
      >
        <Ionicons name="checkmark-circle" size={20} color={colors.status.success} />
        <Text
          style={{
            flex: 1,
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {doText}
        </Text>
      </View>
      <View
        accessible
        accessibilityLabel={`${dontLabel}: ${dontText}`}
        style={[
          styles.row,
          {
            backgroundColor: colors.status.danger + "1A",
            borderColor: colors.status.danger,
            padding: spacing[3],
            gap: spacing[2],
          },
        ]}
      >
        <Ionicons name="close-circle" size={20} color={colors.status.danger} />
        <Text
          style={{
            flex: 1,
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {dontText}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: 10,
  },
});
