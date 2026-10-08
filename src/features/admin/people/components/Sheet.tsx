import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/theme";

/** The bottom sheet every People dialog uses: a scrim, a title row with a
 * close button, and a scrolling body. Same look as the Limit account sheet. */
export function Sheet({
  title,
  subtitle,
  onClose,
  testID,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  testID: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      testID={`${testID}-modal`}
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          testID={`${testID}-scrim`}
          accessibilityRole="button"
          accessibilityLabel={t("eventHub.thread.cancel")}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface.overlay }]}
        />
        <View
          testID={testID}
          style={[
            styles.panel,
            {
              backgroundColor: colors.surface.raised,
              borderColor: colors.border.default,
              paddingBottom: insets.bottom,
            },
          ]}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: spacing[5], gap: spacing[3] }}
          >
            <View style={styles.titleRow}>
              <View style={styles.title}>
                <Text
                  accessibilityRole="header"
                  style={[typography.h3, { color: colors.text.primary }]}
                >
                  {title}
                </Text>
                {subtitle ? (
                  <Text
                    style={{
                      color: colors.text.secondary,
                      fontSize: typography.bodyMeta.fontSize,
                    }}
                  >
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("eventHub.thread.cancel")}
                onPress={onClose}
                hitSlop={8}
                style={styles.close}
                testID={`${testID}-close`}
              >
                <Ionicons name="close" size={24} color={colors.text.primary} />
              </Pressable>
            </View>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  panel: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "92%",
    borderTopStartRadius: 16,
    borderTopEndRadius: 16,
    borderWidth: 1,
  },
  titleRow: { flexDirection: "row", alignItems: "flex-start" },
  title: { flex: 1 },
  close: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
});
