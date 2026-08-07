import * as Linking from "expo-linking";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";

/**
 * Settings-link row shown only while notification permission is denied —
 * same pattern as `app/(tabs)/settings.tsx`'s `LocationPermissionSection`
 * (status text + "Open Settings" deep link into the OS settings app,
 * since neither platform lets an app re-prompt after an explicit denial).
 */
export function PermissionDeniedRow() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  return (
    <View
      style={[
        styles.row,
        { borderColor: colors.status.warning, gap: spacing[2], padding: spacing[3] },
      ]}
    >
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
          flex: 1,
        }}
      >
        {t("notificationSettings.permission.deniedStatus")}
      </Text>
      <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()}>
        <Text
          style={{
            color: colors.text.link,
            fontSize: typography.labelButton.fontSize,
            fontWeight: typography.labelButton.fontWeight,
          }}
        >
          {t("notificationSettings.permission.openSettings")}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
  },
});
