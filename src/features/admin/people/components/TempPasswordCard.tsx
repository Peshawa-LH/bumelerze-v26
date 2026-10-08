import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { useTheme } from "@/theme";

const COPIED_MS = 2000;

/**
 * The temporary password an admin just set for someone (0051), shown ONCE with
 * a copy button. It lives only in the caller's state: it is not logged, cached
 * or put in a query, and "Done" clears it.
 */
export function TempPasswordCard({
  name,
  password,
  onDone,
}: {
  name: string;
  password: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  async function copy() {
    try {
      await Clipboard.setStringAsync(password);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // Clipboard unavailable: the password is still selectable text.
    }
  }

  return (
    <View
      style={[
        styles.card,
        {
          borderColor: colors.status.success,
          backgroundColor: colors.surface.raised,
          padding: spacing[4],
          gap: spacing[2],
        },
      ]}
      testID="admin-temp-password-card"
    >
      <Text
        style={[typography.bodyDefault, { color: colors.text.primary, fontWeight: "600" }]}
      >
        {t("admin.passwords.resultTitle", { name })}
      </Text>
      <View style={[styles.row, { gap: spacing[2] }]}>
        <Text
          selectable
          testID="admin-temp-password"
          style={[styles.password, { color: colors.text.primary }]}
        >
          {password}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("admin.passwords.copy")}
          onPress={() => void copy()}
          style={styles.copy}
          testID="admin-temp-password-copy"
        >
          <Ionicons name="copy-outline" size={22} color={colors.text.secondary} />
        </Pressable>
        {copied ? (
          <Text
            accessibilityLiveRegion="polite"
            testID="admin-temp-password-copied"
            style={[meta, { color: colors.status.success }]}
          >
            {t("admin.passwords.copied")}
          </Text>
        ) : null}
      </View>
      <Text style={meta}>{t("admin.passwords.resultNote")}</Text>
      <AccountButton
        tone="primary"
        label={t("admin.passwords.done")}
        onPress={onDone}
        testID="admin-temp-password-done"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14 },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  password: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 1,
    writingDirection: "ltr",
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
  },
  copy: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
