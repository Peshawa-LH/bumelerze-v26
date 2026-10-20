import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme, nativeFontFamily } from "@/theme";

/**
 * The plain one-line note under a sensor view, with its technical detail
 * (gravity removed, ±0.5 g, natural period, 5 % damping ...) behind a small
 * "i" button (review note 8.1, 2026-10-13): most people need only the first
 * sentence; anyone curious opens the rest.
 */
export function SensorNote({
  text,
  detail,
  testID,
}: {
  text: string;
  detail: string;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [open, setOpen] = useState(false);
  const textStyle = {
    color: colors.text.tertiary,
    fontSize: typography.bodyMeta.fontSize,
    fontFamily: nativeFontFamily(typography.bodyMeta),
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;
  return (
    <View testID={testID} style={{ gap: spacing[1] }}>
      <View style={[styles.row, { gap: spacing[2] }]}>
        <Text style={[textStyle, styles.text]}>{text}</Text>
        <Pressable
          testID={testID ? `${testID}-info` : undefined}
          accessibilityRole="button"
          accessibilityLabel={t("sensor.infoToggle")}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          hitSlop={8}
          style={styles.info}
        >
          <Ionicons
            name={open ? "information-circle" : "information-circle-outline"}
            size={20}
            color={colors.text.secondary}
          />
        </Pressable>
      </View>
      {open ? (
        <Text testID={testID ? `${testID}-detail` : undefined} style={textStyle}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  text: { flex: 1 },
  info: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
});
