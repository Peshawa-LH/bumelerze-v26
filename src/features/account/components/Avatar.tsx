import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/theme";

interface AvatarProps {
  /** Image uri (remote public URL or a freshly picked local file). */
  uri?: string | null;
  /** Used for the initial shown when there is no photo. */
  name?: string | null;
  size?: number;
  /** What to draw when there is neither photo nor initial: nothing (the
   * default) or a grey person silhouette (an install without a name). */
  placeholder?: "person";
  testID?: string;
}

/** Round profile photo with an initial (or a person icon) as fallback. Decorative: the name
 * is always rendered next to it, so it is hidden from screen readers. */
export function Avatar({
  uri,
  name,
  size = 64,
  placeholder,
  testID = "account-avatar",
}: AvatarProps) {
  const { colors, typography } = useTheme();
  const initial = (name ?? "").trim().charAt(0).toUpperCase();
  const shape = { width: size, height: size, borderRadius: size / 2 };

  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.base,
        shape,
        { backgroundColor: colors.surface.sunken, borderColor: colors.border.default },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={shape}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      ) : initial === "" && placeholder === "person" ? (
        <Ionicons
          testID="avatar-person"
          name="person"
          size={Math.round(size * 0.58)}
          color={colors.text.tertiary}
        />
      ) : (
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: size * 0.42,
            fontWeight: typography.h2.fontWeight,
          }}
        >
          {initial}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
});
