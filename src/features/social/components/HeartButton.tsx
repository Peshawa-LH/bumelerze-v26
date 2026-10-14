import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { isolateNumeric } from "@/features/events/format";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

export interface HeartButtonProps {
  count: number;
  liked: boolean;
  /** Left out: the heart is shown read-only (a guest, my own comment). */
  onToggle?: (() => void) | undefined;
  disabled?: boolean;
  /** "small" under a comment, "large" in a post's action row. */
  size?: "small" | "large";
  testID?: string;
}

/**
 * The heart: an outline that fills red once I gave one, and the count beside
 * it (the number always carries the meaning, the colour only repeats it).
 * Read-only with a count of zero it draws nothing. At least 44 dp to tap.
 */
export function HeartButton({
  count,
  liked,
  onToggle,
  disabled = false,
  size = "small",
  testID,
}: HeartButtonProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const countText = isolateNumeric(localizeDigits(String(count), i18n.language));
  const iconSize = size === "large" ? 26 : 18;
  const textStyle = size === "large" ? typography.labelButton : typography.bodyMeta;

  if (!onToggle && count === 0) {
    return null;
  }
  const content = (
    <>
      <Ionicons
        name={liked ? "heart" : "heart-outline"}
        size={iconSize}
        color={liked ? colors.action.felt : colors.text.secondary}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      {count > 0 ? (
        <Text
          style={[
            styles.count,
            {
              color: colors.text.secondary,
              fontSize: textStyle.fontSize,
              fontWeight: size === "large" ? "600" : "400",
            },
          ]}
        >
          {countText}
        </Text>
      ) : null}
    </>
  );
  const label = t("social.heart.label", { number: countText });
  if (!onToggle) {
    return (
      <View
        accessible
        accessibilityLabel={label}
        style={[styles.button, styles.static]}
        testID={testID}
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: liked, disabled }}
      accessibilityHint={
        liked ? t("social.heart.unlikeHint") : t("social.heart.likeHint")
      }
      disabled={disabled}
      onPress={onToggle}
      hitSlop={4}
      testID={testID}
      style={styles.button}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    minWidth: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 6,
  },
  static: { opacity: 0.9 },
  count: { fontVariant: ["tabular-nums"] },
});
