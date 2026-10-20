import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatMagnitudeValue } from "@/features/events/format";
import { magnitudeTone } from "@/features/events/magnitude-tone";
import { useTheme, nativeFontFamily } from "@/theme";
import { MenuSheet, type MenuItem } from "./MenuSheet";

/**
 * The top line of a post, the same for the Event hub and a profile post:
 * a round mark at the start (the earthquake's magnitude ring, or the
 * author's photo), the title with its rank mark, a small second line (date
 * or time) and the "..." menu at the end.
 */
export function PostHeader({
  leading,
  title,
  mark,
  subtitle,
  menuItems = [],
  menuPreview,
  moreLabel,
  testID = "post-header",
}: {
  leading: ReactNode;
  title: ReactNode;
  /** Next to the title: a rank mark, the official mark. */
  mark?: ReactNode;
  subtitle?: string | null;
  menuItems?: readonly MenuItem[];
  menuPreview?: ReactNode;
  /** Spoken label of the "..." button. */
  moreLabel?: string;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.row, { gap: spacing[3] }]} testID={testID}>
      {leading}
      <View style={styles.text}>
        <View style={[styles.titleRow, { gap: spacing[1] }]}>
          {typeof title === "string" ? (
            <Text
              accessibilityRole="header"
              numberOfLines={2}
              style={[
                styles.title,
                {
                  color: colors.text.primary,
                  fontSize: 16,
                  fontFamily: nativeFontFamily(typography.bodyDefault, "600"),
                  lineHeight: 22,
                },
              ]}
              testID={`${testID}-title`}
            >
              {title}
            </Text>
          ) : (
            title
          )}
          {mark}
        </View>
        {subtitle ? (
          <Text
            style={[typography.bodyMeta, { color: colors.text.secondary }]}
            testID={`${testID}-subtitle`}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {menuItems.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={moreLabel ?? t("social.moreOptions")}
          onPress={() => setOpen(true)}
          hitSlop={4}
          style={styles.more}
          testID={`${testID}-more`}
        >
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.text.secondary} />
        </Pressable>
      ) : null}
      {open ? (
        <MenuSheet
          items={menuItems}
          onClose={() => setOpen(false)}
          preview={menuPreview}
          testID={`${testID}-menu`}
        />
      ) : null}
    </View>
  );
}

/** The earthquake's mark: its magnitude in a ring coloured by the USGS
 * magnitude class (the numeral carries the meaning, the colour repeats it). */
export function EventMark({
  magnitude,
  size = 40,
}: {
  magnitude: number;
  size?: number;
}) {
  const { i18n } = useTranslation();
  const { colors, typography } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.mark,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: colors.magnitudeBand[magnitudeTone(magnitude)],
          backgroundColor: colors.surface.raised,
        },
      ]}
      testID="event-mark"
    >
      <Text
        style={{
          color: colors.text.primary,
          fontWeight: "700",
          fontSize: size * 0.32,
          fontFamily: nativeFontFamily(typography.h1),
        }}
        numberOfLines={1}
      >
        {formatMagnitudeValue(magnitude, i18n.language)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", minHeight: 48 },
  text: { flex: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  title: { fontWeight: "600", flexShrink: 1 },
  more: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  mark: { borderWidth: 3, alignItems: "center", justifyContent: "center" },
});
