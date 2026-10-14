import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { isolateNumeric } from "@/features/events/format";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

/** Indent of a reply under its comment (avatar 36 + gap 12). */
export const REPLY_INDENT = 48;

/**
 * A reply's indent, as an empty column at the start of a row. A row mirrors
 * by itself in Sorani and Arabic on every platform (the web build resolves
 * `marginStart` to the left edge whatever the language), so the indent is
 * always on the side the conversation starts from.
 */
export function Indented({
  on,
  children,
  testID,
}: {
  on: boolean;
  children: ReactNode;
  testID?: string;
}) {
  if (!on) {
    return <>{children}</>;
  }
  return (
    <View style={styles.indentRow}>
      <View style={{ width: REPLY_INDENT }} testID={testID} />
      <View style={styles.indented}>{children}</View>
    </View>
  );
}

/**
 * "View 2 replies" / "Hide replies" under a comment: a short line and the
 * words, indented like the replies it opens.
 */
export function ReplyToggle({
  count,
  open,
  onToggle,
  testID,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
  testID?: string;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const number = isolateNumeric(localizeDigits(String(count), i18n.language));
  const label = open
    ? t("social.replies.hide")
    : count === 1
      ? t("social.replies.viewOne")
      : t("social.replies.view", { number });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      hitSlop={4}
      testID={testID}
      style={[styles.row, { gap: spacing[3] }]}
    >
      {/* The indent, then the line: replies start where this starts. */}
      <View style={{ width: REPLY_INDENT - spacing[3] }} />
      <View style={[styles.line, { backgroundColor: colors.border.default }]} />
      <Text
        style={[typography.bodyMeta, { color: colors.text.secondary, fontWeight: "600" }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
  },
  line: { width: 24, height: 1 },
  indentRow: { flexDirection: "row" },
  indented: { flex: 1, minWidth: 0 },
});
