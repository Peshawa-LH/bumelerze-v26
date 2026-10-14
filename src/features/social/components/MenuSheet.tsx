import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/theme";

export interface MenuItem {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** One line under the label: what the action does (a consequence). */
  detail?: string | undefined;
  /** A small tag at the end, e.g. "Moderators only". */
  badge?: string | undefined;
  /** Destructive: red, and placed last by the caller. */
  danger?: boolean | undefined;
  disabled?: boolean | undefined;
  onPress: () => void;
  testID?: string | undefined;
}

interface MenuSheetProps {
  items: readonly MenuItem[];
  onClose: () => void;
  /** What the menu is about, shown on top (e.g. the comment's first line). */
  preview?: ReactNode;
  testID?: string;
}

/**
 * The "..." menu: a bottom sheet within reach of a thumb, one 56 dp row per
 * action (icon, label, a one-line consequence, an optional tag), and Cancel.
 * Choosing a row closes the sheet first, then runs the action, so an action
 * that opens its own sheet (Report) never stacks two.
 */
export function MenuSheet({
  items,
  onClose,
  preview,
  testID = "menu-sheet",
}: MenuSheetProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      testID={`${testID}-modal`}
    >
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("eventHub.thread.cancel")}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface.overlay }]}
          testID={`${testID}-scrim`}
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          style={[
            styles.panel,
            {
              backgroundColor: colors.surface.raised,
              borderColor: colors.border.default,
              paddingBottom: insets.bottom + spacing[3],
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.border.default }]} />
          <ScrollView contentContainerStyle={{ paddingHorizontal: spacing[4] }}>
            {preview ? (
              <View
                style={[
                  styles.preview,
                  {
                    borderBottomColor: colors.border.subtle,
                    paddingVertical: spacing[3],
                  },
                ]}
              >
                {preview}
              </View>
            ) : null}
            {items.map((item, index) => (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityLabel={
                  item.detail ? `${item.label}. ${item.detail}` : item.label
                }
                accessibilityState={{ disabled: item.disabled === true }}
                disabled={item.disabled === true}
                onPress={() => {
                  onClose();
                  item.onPress();
                }}
                testID={item.testID}
                style={({ pressed }) => [
                  styles.row,
                  {
                    gap: spacing[3],
                    paddingVertical: spacing[2],
                    borderTopWidth: index > 0 ? StyleSheet.hairlineWidth : 0,
                    borderTopColor: colors.border.subtle,
                    backgroundColor: pressed ? colors.surface.sunken : "transparent",
                    opacity: item.disabled ? 0.5 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={item.icon}
                  size={24}
                  color={item.danger ? colors.status.danger : colors.text.secondary}
                />
                <View style={styles.text}>
                  <Text
                    style={[
                      typography.bodyDefault,
                      { color: item.danger ? colors.status.danger : colors.text.primary },
                    ]}
                  >
                    {item.label}
                  </Text>
                  {item.detail ? (
                    <Text style={[typography.bodyMeta, { color: colors.text.secondary }]}>
                      {item.detail}
                    </Text>
                  ) : null}
                </View>
                {item.badge ? (
                  <View
                    style={[
                      styles.badge,
                      {
                        borderColor: colors.border.default,
                        paddingHorizontal: spacing[2],
                      },
                    ]}
                  >
                    <Text
                      style={[typography.labelCaption, { color: colors.text.secondary }]}
                    >
                      {item.badge}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            testID={`${testID}-cancel`}
            style={({ pressed }) => [
              styles.cancel,
              {
                marginHorizontal: spacing[4],
                marginTop: spacing[2],
                backgroundColor: pressed ? colors.surface.base : colors.surface.sunken,
              },
            ]}
          >
            <Text style={[typography.labelButton, { color: colors.text.primary }]}>
              {t("eventHub.thread.cancel")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  panel: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "85%",
    borderTopStartRadius: 16,
    borderTopEndRadius: 16,
    borderWidth: 1,
    paddingTop: 8,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 4,
  },
  preview: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center" },
  text: { flex: 1 },
  badge: { borderWidth: 1, borderRadius: 999, paddingVertical: 4 },
  cancel: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
});
