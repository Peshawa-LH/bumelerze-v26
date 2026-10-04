import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";

import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

/** At or above this system font scale the strip becomes a 2 x 2 grid. */
export const LARGE_TEXT_FONT_SCALE = 1.5;

export interface StatsStripProps {
  reports: number;
  /** Server-only figures; null = not known. Shown only when `signedIn`. */
  comments: number | null;
  helpful: number | null;
  badgesEarned: number;
  badgesTotal: number;
  signedIn: boolean;
  /** Server figures still loading: a small skeleton pill instead of a number. */
  loading: boolean;
}

interface Cell {
  key: "reports" | "comments" | "helpful" | "badges";
  icon: keyof typeof Ionicons.glyphMap;
  tone: "info" | "success" | "brand";
  /** i18n key suffix under `myData.stats`. */
  label: string;
  /** Text shown; null while loading. */
  text: string | null;
}

/** Reports, (Comments, Helpful,) Badges in one card, hairline dividers, a
 * 2 x 2 grid at large system font scales. Numbers are tabular and localized. */
export function StatsStrip({
  reports,
  comments,
  helpful,
  badgesEarned,
  badgesTotal,
  signedIn,
  loading,
}: StatsStripProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { fontScale } = useWindowDimensions();
  const locale = i18n.language;
  const num = (value: number) => localizeDigits(String(value), locale);
  const serverText = (value: number | null) =>
    loading && value === null ? null : value === null ? "–" : num(value);

  const cells: Cell[] = [
    { key: "reports", icon: "pulse", tone: "info", label: "reports", text: num(reports) },
    ...(signedIn
      ? ([
          {
            key: "comments",
            icon: "chatbubble-ellipses",
            tone: "success",
            label: "comments",
            text: serverText(comments),
          },
          {
            key: "helpful",
            icon: "thumbs-up",
            tone: "success",
            label: "helpful",
            text: serverText(helpful),
          },
        ] as Cell[])
      : []),
    {
      key: "badges",
      icon: "trophy",
      tone: "brand",
      label: "badges",
      text: `${num(badgesEarned)}/${num(badgesTotal)}`,
    },
  ];
  const grid = fontScale >= LARGE_TEXT_FONT_SCALE && cells.length > 2;
  const perRow = grid ? 2 : cells.length;
  const toneColor = {
    info: colors.status.info,
    success: colors.status.success,
    brand: colors.brand.primary,
  } as const;

  return (
    <View
      testID="stats-strip"
      style={[
        styles.card,
        { backgroundColor: colors.surface.raised, borderColor: colors.border.default },
      ]}
    >
      {cells.map((cell, index) => {
        const column = index % perRow;
        const row = Math.floor(index / perRow);
        const lastRow = Math.floor((cells.length - 1) / perRow);
        const label = t(`myData.stats.${cell.label}`);
        return (
          <View
            key={cell.key}
            testID={`stat-${cell.key}`}
            accessible
            accessibilityLabel={
              cell.text === null
                ? label
                : t("myData.stats.a11y", { label, count: cell.text })
            }
            style={[
              styles.cell,
              {
                width: `${100 / perRow}%`,
                paddingVertical: spacing[3],
                paddingHorizontal: spacing[1],
                borderEndWidth: column < perRow - 1 ? 1 : 0,
                borderBottomWidth: row < lastRow ? 1 : 0,
                borderColor: colors.border.subtle,
              },
            ]}
          >
            <Ionicons name={cell.icon} size={20} color={toneColor[cell.tone]} />
            {cell.text === null ? (
              <View
                testID={`stat-${cell.key}-skeleton`}
                style={[styles.skeleton, { backgroundColor: colors.surface.sunken }]}
              />
            ) : (
              <Text
                style={[
                  typography.h2,
                  styles.number,
                  { color: colors.text.primary, writingDirection: "ltr" },
                ]}
              >
                {cell.text}
              </Text>
            )}
            <Text
              numberOfLines={2}
              style={[
                typography.bodyMeta,
                styles.label,
                { color: colors.text.secondary },
              ]}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 1,
    borderRadius: 14,
    overflow: "hidden",
  },
  cell: { minHeight: 76, alignItems: "center", justifyContent: "center", gap: 2 },
  number: { fontVariant: ["tabular-nums"], textAlign: "center" },
  label: { textAlign: "center" },
  skeleton: { width: 24, height: 16, borderRadius: 8, marginVertical: 4 },
});
