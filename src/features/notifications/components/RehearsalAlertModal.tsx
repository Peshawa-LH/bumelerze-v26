import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/theme";

interface RehearsalAlertModalProps {
  visible: boolean;
  onClose: () => void;
  titleText: string;
  bodyText: string;
}

/**
 * "See the alert" (spec-v1.md §4.10/B8) — a faithful, pure-UI mock of the
 * future push notification banner (app icon placeholder + title/body +
 * "now" timestamp, big type). No expo-notifications call here at all: this
 * never fires a real notification, so it needs no permission and works
 * even if the user has denied notifications entirely — the whole point is
 * letting a curious or skeptical user preview the alert without any
 * system prompt in the way.
 *
 * ACCESSIBILITY FIX (Phase 5 audit): the previous structure wrapped the
 * ENTIRE overlay — backdrop AND the card's title/body content — in one
 * `Pressable` carrying `accessibilityRole="button"` +
 * `accessibilityLabel="Close"`. A `Pressable` with a label is a single
 * accessible element by default, so TalkBack/VoiceOver announced only
 * "Close, button" and never exposed the example alert's title/body text —
 * defeating the entire purpose of a sighted-AND-blind alert preview. Fixed
 * by separating concerns: a decorative, `accessibilityElementsHidden`
 * backdrop behind the card (tap-outside-to-dismiss, invisible to screen
 * readers — same as how the Modal's hardware-back/swipe-down already closes
 * it), the card's title/body as normal (individually readable) `Text`, and
 * one explicit, visible "Close" button a screen-reader user can actually
 * find and activate.
 */
export function RehearsalAlertModal({
  visible,
  onClose,
  titleText,
  bodyText,
}: RehearsalAlertModalProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface.overlay }]}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.card,
            {
              top: insets.top + spacing[4],
              backgroundColor: colors.surface.raised,
              borderColor: colors.border.default,
              padding: spacing[4],
              gap: spacing[2],
            },
          ]}
        >
          <View style={styles.topRow}>
            <View
              style={[styles.iconPlaceholder, { backgroundColor: colors.brand.primary }]}
            >
              <Text style={{ color: colors.brand.onPrimary, fontWeight: "800" }}>B</Text>
            </View>
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.labelCaption.fontSize,
                flex: 1,
              }}
            >
              {t("notificationSettings.rehearsal.appName")}
            </Text>
            <Text
              style={{
                color: colors.text.tertiary,
                fontSize: typography.labelCaption.fontSize,
              }}
            >
              {t("events.relativeTime.justNow")}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("notificationSettings.rehearsal.close")}
              onPress={onClose}
              hitSlop={12}
              style={styles.closeButton}
            >
              <Text
                style={{
                  color: colors.text.link,
                  fontSize: typography.labelButton.fontSize,
                  fontWeight: typography.labelButton.fontWeight,
                }}
              >
                {t("notificationSettings.rehearsal.close")}
              </Text>
            </Pressable>
          </View>

          <Text
            allowFontScaling
            style={{
              color: colors.text.primary,
              fontSize: typography.h3.fontSize,
              lineHeight: typography.h3.lineHeight,
              fontWeight: "700",
            }}
          >
            {titleText}
          </Text>
          <Text
            allowFontScaling
            style={{
              color: colors.text.primary,
              fontSize: typography.bodyDefault.fontSize,
              lineHeight: typography.bodyDefault.lineHeight,
            }}
          >
            {bodyText}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  card: {
    position: "absolute",
    start: 16,
    end: 16,
    borderWidth: 1,
    borderRadius: 16,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  closeButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
