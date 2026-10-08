import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import type { PersonStatus } from "../types";

/** Active / Restricted / Suspended as a small text chip (never colour alone). */
export function StatusChip({
  status,
  testID,
}: {
  status: PersonStatus;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const tone =
    status === "active"
      ? colors.text.secondary
      : status === "restricted"
        ? colors.status.warning
        : colors.status.danger;
  return (
    <View
      testID={testID}
      style={[styles.chip, { borderColor: tone, paddingHorizontal: spacing[2] }]}
    >
      <Text
        style={{
          color: tone,
          fontSize: typography.bodyMeta.fontSize,
          fontWeight: "600",
        }}
      >
        {t(`admin.people.status.${status}`)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1, borderRadius: 12, paddingVertical: 1 },
});
