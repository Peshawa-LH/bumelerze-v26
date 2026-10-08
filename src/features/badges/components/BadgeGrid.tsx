import { useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

import type { HubRoleKind } from "@/features/eventhub/types";

import { ROLE_BADGES } from "../catalog";
import type { BadgeEntry } from "../evaluate";
import { badgeLabels } from "../labels";
import { BadgeIcon } from "./BadgeIcon";
import { entryVisual } from "../visual";
import { BadgeSheet } from "./BadgeSheet";

/** Badge circle size on the page. */
export const BADGE_SIZE = 52;
const COLUMNS = 5;
/** Rows shown before "Show all" (owner, 2026-10-08: "only show two rows"). */
export const COLLAPSED_ROWS = 2;

/** The collection: five columns of badges in one grid, earned first (held
 * ranks, then earned milestones), then the locked ones (milestones, then the
 * ranks the person can ask for). Only two rows show until "Show all" opens
 * the rest in place (owner, 2026-10-08). Each badge opens the detail sheet.
 * Cells mirror in RTL with the row direction. */
export function BadgeGrid({
  entries,
  defaultExpanded = false,
}: {
  entries: readonly BadgeEntry[];
  /** Start with every badge showing (the full collection page). */
  defaultExpanded?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const selected = entries.find((entry) => entry.key === selectedKey) ?? null;
  // Earned first, keeping the catalogue order inside each half (a stable
  // partition, so held ranks stay at the very front).
  const ordered = [
    ...entries.filter((entry) => entry.earned),
    ...entries.filter((entry) => !entry.earned),
  ];
  const limit = COLUMNS * COLLAPSED_ROWS;
  const collapsible = ordered.length > limit;
  const visible = collapsible && !expanded ? ordered.slice(0, limit) : ordered;

  function requestRank(role: HubRoleKind) {
    setSelectedKey(null);
    router.push({
      pathname: "/feedback",
      params: { badgeRequest: "1", rank: role },
    });
  }

  function renderCell(entry: BadgeEntry) {
    const { name } = badgeLabels(entry, t, i18n.language);
    const visual = entryVisual(entry);
    let label: string;
    if (entry.earned) {
      label = t("myData.badges.a11yEarned", { name });
    } else if (entry.kind === "role") {
      label = t("myData.badges.a11yLockedRank", { name });
    } else {
      label = t("myData.badges.a11yLocked", {
        name,
        current: localizeDigits(String(entry.current), i18n.language),
        target: localizeDigits(String(entry.target), i18n.language),
      });
    }
    return (
      <View key={entry.key} style={styles.cell}>
        <Pressable
          testID={`badge-${entry.key}`}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled: false }}
          hitSlop={4}
          onPress={() => setSelectedKey(entry.key)}
          style={({ pressed }) => [
            styles.press,
            { backgroundColor: pressed ? colors.surface.sunken : "transparent" },
          ]}
        >
          <BadgeIcon
            glyph={visual.glyph}
            mark={entry.kind === "role" && ROLE_BADGES[entry.role].mark}
            tone={visual.tone}
            earned={entry.earned}
            size={BADGE_SIZE}
          />
        </Pressable>
      </View>
    );
  }

  return (
    <View
      testID="badge-grid"
      style={[
        styles.grid,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[3],
        },
      ]}
    >
      {visible.map(renderCell)}
      {collapsible ? (
        <Pressable
          testID="badges-toggle"
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((open) => !open)}
          hitSlop={8}
          style={[styles.toggle, { paddingTop: spacing[2] }]}
        >
          <Text style={[typography.labelButton, { color: colors.text.link }]}>
            {expanded
              ? t("myData.badges.showLess")
              : t("myData.badges.showAll", {
                  count: localizeDigits(String(ordered.length), i18n.language),
                })}
          </Text>
        </Pressable>
      ) : null}
      <BadgeSheet
        entry={selected}
        onClose={() => setSelectedKey(null)}
        onRequestRank={requestRank}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 1,
    borderRadius: 14,
  },
  cell: {
    width: `${100 / COLUMNS}%`,
    alignItems: "center",
    paddingVertical: 6,
  },
  toggle: {
    width: "100%",
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  press: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: BADGE_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
