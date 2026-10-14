import { Ionicons } from "@expo/vector-icons";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { withAlpha } from "@/features/badges/tones";
import { useTheme } from "@/theme";
import { useTextDir } from "./text-dir";

/**
 * One tile of the admin launcher (review 15.1, mockup 5a): an icon, the tool's
 * name and a status line ("7 waiting"). Tapping opens the tool; nothing is
 * done on the launcher itself. `dot` marks a status that needs attention: the
 * dot only reinforces the words, it never replaces them.
 */
export function ToolTile({
  icon,
  title,
  status,
  dot,
  onPress,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  status?: string | null | undefined;
  dot?: "attention" | "info" | null | undefined;
  onPress: () => void;
  testID?: string;
}) {
  const { colors, typography, spacing } = useTheme();
  const dir = useTextDir();
  const dotColor = dot === "attention" ? colors.status.warning : colors.status.info;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={status ? `${title}, ${status}` : title}
      onPress={onPress}
      testID={testID}
      style={(state) => [
        styles.tile,
        {
          backgroundColor:
            state.pressed || (state as { hovered?: boolean }).hovered
              ? colors.surface.sunken
              : colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[3],
          gap: spacing[2],
        },
        Platform.OS === "web" ? styles.webCursor : null,
      ]}
    >
      <View
        style={[styles.icon, { backgroundColor: withAlpha(colors.brand.primary, 0.14) }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        <Ionicons name={icon} size={22} color={colors.brand.primary} />
      </View>
      <Text
        style={[
          typography.bodyDefault,
          dir,
          styles.title,
          { color: colors.text.primary },
        ]}
      >
        {title}
      </Text>
      {status ? (
        <View style={[styles.statusRow, { gap: spacing[1] }]}>
          {dot ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
          <Text
            style={[
              typography.bodyMeta,
              dir,
              styles.status,
              {
                color: dot === "attention" ? colors.text.primary : colors.text.secondary,
              },
            ]}
            numberOfLines={2}
          >
            {status}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Two tiles per row; the last one alone keeps its half width. */
export function ToolTileGrid({
  children,
  testID,
}: {
  children: React.ReactNode;
  testID?: string;
}) {
  const { spacing } = useTheme();
  return (
    <View testID={testID} style={[styles.grid, { gap: spacing[3] }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap" },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    maxWidth: "50%",
    minHeight: 120,
    borderWidth: 1,
    borderRadius: 14,
  },
  webCursor: { cursor: "pointer" } as object,
  icon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontWeight: "600" },
  statusRow: { flexDirection: "row", alignItems: "center" },
  status: { flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
