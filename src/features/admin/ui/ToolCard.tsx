import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/theme";
import { useTextDir } from "./text-dir";

/** A raised card with an optional title and one-line subtitle: the one card
 * shape of the admin tools (statistics, hubs, officials, person page). */
export function ToolCard({
  title,
  subtitle,
  children,
  testID,
}: {
  title?: string | undefined;
  subtitle?: string | undefined;
  children?: ReactNode;
  testID?: string;
}) {
  const { colors, typography, spacing } = useTheme();
  const dir = useTextDir();
  return (
    <View
      testID={testID}
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
      {title || subtitle ? (
        <View style={styles.head}>
          {title ? (
            <Text
              accessibilityRole="header"
              style={[typography.labelButton, dir, { color: colors.text.primary }]}
            >
              {title}
            </Text>
          ) : null}
          {subtitle ? (
            <Text
              style={[typography.labelCaption, dir, { color: colors.text.secondary }]}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** A small heading between cards ("Badges", "Activity"). */
export function ToolSectionTitle({ title, testID }: { title: string; testID?: string }) {
  const { colors, typography } = useTheme();
  const dir = useTextDir();
  return (
    <Text
      accessibilityRole="header"
      testID={testID}
      style={[typography.labelButton, dir, { color: colors.text.secondary }]}
    >
      {title}
    </Text>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14 },
  head: { gap: 2 },
});
