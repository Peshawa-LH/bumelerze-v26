import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { SAFETY_ARTWORK } from "../artwork";
import { safetyDoDontKeys, type SafetyDoDontPair } from "../content";

interface DoDontPairRowProps {
  cardId: string;
  pair: SafetyDoDontPair;
}

/**
 * One do/don't pair — LastQuake's cartoon do/don't pattern (teardown-
 * lastquake.md §3: "green ✓ / red ✗ framed"). The "do" and "dont" rows are
 * each their own accessible element with a localized "Do:"/"Don't:" prefix
 * baked into the accessibility label, so they read as distinct items to a
 * screen reader (not just distinct colors) — the wave brief's "distinct
 * roles" requirement.
 *
 * `pair.doImage`/`pair.dontImage` (owner-artwork wave, 2026-08-17): a small
 * thumbnail per row when the commission illustrated that specific row (most
 * don't have one — see `content.ts`'s doc comment). Purely decorative, same
 * as `SafetyImageRow`: hidden from screen readers since the row's own
 * `accessibilityLabel` already carries the full "Do: ..."/"Don't: ..."
 * meaning, and never mirrored under RTL.
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
        {pair.doImage ? (
          <Image
            testID="dodont-row-artwork-do"
            source={SAFETY_ARTWORK[pair.doImage]}
            contentFit="contain"
            style={styles.thumbnail}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : null}
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
        {pair.dontImage ? (
          <Image
            testID="dodont-row-artwork-dont"
            source={SAFETY_ARTWORK[pair.dontImage]}
            contentFit="contain"
            style={styles.thumbnail}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : null}
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
  thumbnail: {
    width: 44,
    height: 44,
    flexShrink: 0,
  },
});
