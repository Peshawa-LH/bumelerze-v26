import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isolateNumeric } from "@/features/events/format";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

import { ROLE_BADGES } from "../catalog";
import type { BadgeEntry } from "../evaluate";
import { badgeLabels } from "../labels";
import { toneColor } from "../tones";
import { entryVisual } from "../visual";
import { BadgeIcon } from "./BadgeIcon";

const SHEET_BADGE_SIZE = 88;
const WIDE_WEB_MIN_WIDTH = 600;

/** True when the system asks for less motion (the sheet then appears at once). */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduce(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return reduce;
}

/**
 * Detail of one badge: big badge, name, one-line rule, then either "Earned"
 * or the progress so far. RN `Modal` (no extra library): bottom panel on the
 * phone, centred panel (max 400) on the web. Closes with the X, a tap on the
 * scrim, or Android back. A fade only, and none under reduce-motion.
 */
export function BadgeSheet({
  entry,
  onClose,
}: {
  entry: BadgeEntry | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  // A centred dialog only on a wide web window; on a phone (native, or the
  // web app on a phone) the panel sits at the bottom like any sheet.
  const { width } = useWindowDimensions();
  const centered = Platform.OS === "web" && width >= WIDE_WEB_MIN_WIDTH;

  if (!entry) {
    return null;
  }

  const { name, rule } = badgeLabels(entry, t, i18n.language);
  const visual = entryVisual(entry);
  const countable = entry.kind === "milestone" && entry.target > 1;
  const current = entry.kind === "milestone" ? entry.current : 0;
  const target = entry.kind === "milestone" ? entry.target : 0;
  const fraction = target > 0 ? Math.min(1, current / target) : 0;
  const progressText = isolateNumeric(
    `${localizeDigits(String(current), i18n.language)} / ${localizeDigits(String(target), i18n.language)}`,
  );
  const fill = toneColor(visual.tone, colors);

  return (
    <Modal
      testID="badge-sheet-modal"
      visible
      transparent
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.root, centered ? styles.rootWeb : styles.rootNative]}>
        <Pressable
          testID="badge-sheet-scrim"
          accessibilityRole="button"
          accessibilityLabel={t("myData.badges.close")}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface.overlay }]}
        />
        <View
          testID="badge-sheet"
          style={[
            styles.panel,
            centered ? styles.panelWeb : styles.panelNative,
            {
              backgroundColor: colors.surface.raised,
              borderColor: colors.border.default,
              padding: spacing[6],
              paddingBottom: spacing[6] + (centered ? 0 : insets.bottom),
              gap: spacing[3],
            },
          ]}
        >
          <Pressable
            testID="badge-sheet-close"
            accessibilityRole="button"
            accessibilityLabel={t("myData.badges.close")}
            onPress={onClose}
            style={[styles.close, { top: spacing[2] }]}
          >
            <Ionicons name="close" size={24} color={colors.text.primary} />
          </Pressable>

          <View style={styles.center}>
            <BadgeIcon
              glyph={visual.glyph}
              mark={entry.kind === "role" && ROLE_BADGES[entry.role].mark}
              tone={visual.tone}
              earned={entry.earned}
              size={SHEET_BADGE_SIZE}
            />
          </View>
          <Text
            accessibilityRole="header"
            style={[typography.h2, styles.centerText, { color: colors.text.primary }]}
          >
            {name}
          </Text>
          <Text
            style={[
              typography.bodyDefault,
              styles.centerText,
              { color: colors.text.secondary },
            ]}
          >
            {rule}
          </Text>

          {entry.earned ? (
            <View
              style={[styles.statusRow, { gap: spacing[2] }]}
              testID="badge-sheet-earned"
            >
              <Ionicons name="checkmark-circle" size={22} color={colors.status.success} />
              <Text style={[typography.bodyDefault, { color: colors.text.primary }]}>
                {t("myData.badges.earned")}
              </Text>
            </View>
          ) : (
            <View style={{ gap: spacing[2] }} testID="badge-sheet-locked">
              <View style={[styles.statusRow, { gap: spacing[2] }]}>
                <Ionicons name="lock-closed" size={20} color={colors.text.secondary} />
                <Text style={[typography.bodyDefault, { color: colors.text.primary }]}>
                  {t("myData.badges.locked")}
                </Text>
              </View>
              {countable ? (
                <>
                  <View
                    accessible
                    accessibilityRole="progressbar"
                    accessibilityLabel={name}
                    accessibilityValue={{ min: 0, max: target, now: current }}
                    style={[styles.track, { backgroundColor: colors.surface.sunken }]}
                  >
                    <View
                      testID="badge-sheet-progress-fill"
                      style={[
                        styles.fillBar,
                        {
                          backgroundColor: fill,
                          width: `${Math.round(fraction * 100)}%`,
                        },
                      ]}
                    />
                  </View>
                  <Text
                    testID="badge-sheet-progress"
                    style={[
                      typography.bodyMeta,
                      styles.centerText,
                      { color: colors.text.secondary, writingDirection: "ltr" },
                    ]}
                  >
                    {progressText}
                  </Text>
                </>
              ) : null}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rootNative: { justifyContent: "flex-end" },
  rootWeb: { justifyContent: "center", alignItems: "center" },
  panel: { width: "100%", borderWidth: 1 },
  panelNative: { borderTopStartRadius: 20, borderTopEndRadius: 20 },
  panelWeb: { maxWidth: 400, borderRadius: 20 },
  close: {
    position: "absolute",
    end: 8,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  center: { alignItems: "center" },
  centerText: { textAlign: "center" },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  fillBar: { height: 8, borderRadius: 4 },
});
