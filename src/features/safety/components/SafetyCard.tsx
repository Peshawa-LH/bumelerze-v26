import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import {
  safetyCardBodyKeys,
  safetyCardTitleKey,
  type SafetyCard as SafetyCardData,
} from "../content";
import { AccessibilityDisclosure } from "./AccessibilityDisclosure";
import { DoDontPairRow } from "./DoDontPairRow";
import { SafetyImageRow } from "./SafetyImageRow";

interface SafetyCardProps {
  card: SafetyCardData;
}

/**
 * One PREPARE/SURVIVE/RECOVER topic card: title, body paragraph(s), any
 * do/don't pairs, and (today, only on `dropCoverHold`) the collapsible
 * accessibility-variant block. Rendered full-list rather than
 * expand/collapse-per-card (wave brief's UX call) — this content is the
 * thing panic-time users are trying to read, so hiding it behind another
 * tap works against the panic-time priority (PROJECT.md). The one exception
 * is the accessibility block, which stays collapsed by default because it
 * doesn't apply to most readers of a given card.
 */
export function SafetyCard({ card }: SafetyCardProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  const bodyKeys = safetyCardBodyKeys(card);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[4],
          gap: spacing[3],
        },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
      >
        {t(safetyCardTitleKey(card.id))}
      </Text>

      {card.images && card.images.length > 0 ? (
        <SafetyImageRow images={card.images} />
      ) : null}

      <View style={{ gap: spacing[2] }}>
        {bodyKeys.map((bodyKey) => (
          <Text
            key={bodyKey}
            style={{
              color: colors.text.secondary,
              fontSize: typography.bodyDefault.fontSize,
              lineHeight: typography.bodyDefault.lineHeight,
            }}
          >
            {t(bodyKey)}
          </Text>
        ))}
      </View>

      {card.doDontPairs && card.doDontPairs.length > 0 ? (
        <View style={{ gap: spacing[2] }}>
          {card.doDontPairs.map((pair) => (
            <DoDontPairRow key={pair.id} cardId={card.id} pair={pair} />
          ))}
        </View>
      ) : null}

      {card.accessibilityVariants && card.accessibilityVariants.length > 0 ? (
        <AccessibilityDisclosure cardId={card.id} variants={card.accessibilityVariants} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
  },
});
