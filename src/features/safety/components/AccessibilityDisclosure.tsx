import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { SAFETY_ARTWORK } from "../artwork";
import { safetyAccessibilityKeys, type SafetyAccessibilityVariant } from "../content";

interface AccessibilityDisclosureProps {
  cardId: string;
  variants: readonly SafetyAccessibilityVariant[];
}

/**
 * Collapsible accessibility-variant block (spec-v1.md §4.9 / wave brief:
 * "accessibility-variant block collapsible under its parent card with a
 * clear label"). One shared toggle reveals all of a card's variants
 * together (today only `dropCoverHold` has any) rather than a separate
 * disclosure per variant — the MyShake/LastQuake benchmark presents them as
 * one grouped "if this applies to you" section, not N independent toggles.
 * Collapsed by default so it never adds scroll length to the panic-time
 * reading path for users who don't need it.
 *
 * Each variant's `image` (owner-artwork wave, 2026-08-17), when present,
 * renders beside its label/body as a small decorative thumbnail — hidden
 * from screen readers exactly like `SafetyImageRow`, since the label and
 * body text already carry the full instruction.
 */
export function AccessibilityDisclosure({
  cardId,
  variants,
}: AccessibilityDisclosureProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [expanded, setExpanded] = useState(false);

  return (
    <View
      style={[
        styles.container,
        { borderColor: colors.border.default, marginTop: spacing[1] },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t("safety.accessibilityToggleLabel")}
        onPress={() => setExpanded((current) => !current)}
        style={[styles.toggle, { padding: spacing[3] }]}
      >
        <Ionicons name="accessibility" size={18} color={colors.text.link} />
        <Text
          style={{
            flex: 1,
            color: colors.text.link,
            fontSize: typography.labelButton.fontSize,
            fontWeight: typography.labelButton.fontWeight,
          }}
        >
          {t("safety.accessibilityToggleLabel")}
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.text.link}
        />
      </Pressable>

      {expanded ? (
        <View style={{ gap: spacing[3], padding: spacing[3], paddingTop: 0 }}>
          {variants.map((variant) => {
            const { labelKey, bodyKey } = safetyAccessibilityKeys(cardId, variant.id);
            return (
              <View
                key={variant.id}
                style={[styles.variantRow, { gap: spacing[3] }]}
              >
                {variant.image ? (
                  <Image
                    testID="accessibility-variant-artwork"
                    source={SAFETY_ARTWORK[variant.image]}
                    contentFit="contain"
                    style={styles.variantImage}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  />
                ) : null}
                <View style={{ flex: 1, gap: spacing[1] }}>
                  <Text
                    style={{
                      color: colors.text.primary,
                      fontSize: typography.bodyMeta.fontSize,
                      lineHeight: typography.bodyMeta.lineHeight,
                      fontWeight: "600",
                    }}
                  >
                    {t(labelKey)}
                  </Text>
                  <Text
                    style={{
                      color: colors.text.secondary,
                      fontSize: typography.bodyMeta.fontSize,
                      lineHeight: typography.bodyMeta.lineHeight,
                    }}
                  >
                    {t(bodyKey)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  variantRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  variantImage: {
    width: 64,
    height: 64,
    flexShrink: 0,
  },
});
