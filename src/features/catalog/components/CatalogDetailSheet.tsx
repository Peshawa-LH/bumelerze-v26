import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/theme";
import {
  formatCatalogCoordinates,
  formatCatalogDateTimeUtc,
  formatCatalogDepth,
  formatCatalogMagnitude,
} from "../format";
import type { CatalogRow } from "../types";

interface CatalogDetailSheetProps {
  row: CatalogRow | null;
  onClose: () => void;
}

/** Full-detail modal for a tapped catalog row: date/time (UTC), coordinates,
 * depth, magnitude+type, source catalog + source id (wave brief's exact
 * field list). Same `Modal` + backdrop + explicit "Close" pattern as
 * `RehearsalAlertModal` (screen-reader-accessible tap-outside-to-dismiss
 * without swallowing the content into one unreadable Pressable — see that
 * component's accessibility-fix doc comment). These are archival events —
 * no live refetch, no felt-report/ShakeMap affordance here. */
export function CatalogDetailSheet({ row, onClose }: CatalogDetailSheetProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={row !== null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface.overlay }]}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.card,
            {
              backgroundColor: colors.surface.raised,
              borderColor: colors.border.default,
              paddingBottom: insets.bottom + spacing[4],
            },
          ]}
        >
          <ScrollView contentContainerStyle={{ padding: spacing[4], gap: spacing[3] }}>
            <View style={styles.headerRow}>
              <Text
                accessibilityRole="header"
                style={{
                  color: colors.text.primary,
                  fontSize: typography.h3.fontSize,
                  lineHeight: typography.h3.lineHeight,
                  fontWeight: typography.h3.fontWeight,
                }}
              >
                {t("catalog.detail.title")}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("catalog.detail.close")}
                onPress={onClose}
                hitSlop={12}
                style={styles.closeButton}
              >
                <Text
                  style={{
                    color: colors.text.link,
                    fontSize: typography.labelButton.fontSize,
                    fontWeight: typography.labelButton.fontWeight,
                  }}
                >
                  {t("catalog.detail.close")}
                </Text>
              </Pressable>
            </View>

            {row ? (
              <>
                <DetailField
                  label={t("catalog.detail.dateLabel")}
                  value={formatCatalogDateTimeUtc(row.time, locale)}
                  colors={colors}
                  typography={typography}
                />
                <DetailField
                  label={t("catalog.detail.coordinatesLabel")}
                  value={formatCatalogCoordinates(row, locale)}
                  colors={colors}
                  typography={typography}
                />
                <DetailField
                  label={t("catalog.detail.depthLabel")}
                  value={formatCatalogDepth(row, locale, t) ?? t("catalog.detail.unknown")}
                  colors={colors}
                  typography={typography}
                />
                <DetailField
                  label={t("catalog.detail.magnitudeLabel")}
                  value={`${formatCatalogMagnitude(row, locale, t)} (${row.magType})`}
                  colors={colors}
                  typography={typography}
                />
                <DetailField
                  label={t("catalog.detail.sourceLabel")}
                  value={t(`catalog.sources.${row.sourceCatalog}`)}
                  colors={colors}
                  typography={typography}
                />
                <DetailField
                  label={t("catalog.detail.sourceIdLabel")}
                  value={row.sourceId ?? t("catalog.detail.unknown")}
                  colors={colors}
                  typography={typography}
                />
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

interface DetailFieldProps {
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>["colors"];
  typography: ReturnType<typeof useTheme>["typography"];
}

function DetailField({ label, value, colors, typography }: DetailFieldProps) {
  return (
    <View style={styles.field}>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.labelCaption.fontSize,
          lineHeight: typography.labelCaption.lineHeight,
        }}
      >
        {label}
      </Text>
      <Text
        allowFontScaling
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  card: {
    maxHeight: "80%",
    borderTopWidth: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  closeButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  field: {
    gap: 2,
  },
});
