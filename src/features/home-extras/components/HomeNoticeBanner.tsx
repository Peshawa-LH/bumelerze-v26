import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { isRTLLocale } from "@/i18n";
import { useTheme } from "@/theme";
import { pickNoticeText } from "../select";
import type { HomeNotice } from "../transport";

/**
 * The message from Bumelerze at the very top of Home (owner choice 4: above
 * "Are you safe?" and "Be ready"). "Important" is drawn in amber,
 * "Information" plainly. Plain text: links are not made clickable. The
 * close button hides this message on this phone until a new one is posted
 * (owner choice 2).
 */
export function HomeNoticeBanner({
  notice,
  onHide,
}: {
  notice: HomeNotice;
  onHide: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const picked = pickNoticeText(notice.texts, i18n.language);
  if (!picked) {
    return null;
  }
  const important = notice.kind === "important";
  const accent = important ? colors.status.warning : colors.brand.primary;
  const title = t(important ? "home.notice.titleImportant" : "home.notice.title");
  return (
    <View style={{ paddingHorizontal: spacing[4], paddingBottom: spacing[3] }}>
      <View
        testID="home-notice"
        accessibilityLiveRegion={important ? "polite" : "none"}
        style={[
          styles.card,
          {
            backgroundColor: colors.surface.raised,
            borderColor: important ? colors.status.warning : colors.border.default,
            borderWidth: important ? 2 : 1,
            borderStartColor: accent,
            paddingVertical: spacing[3],
            paddingStart: spacing[3],
            gap: spacing[3],
          },
        ]}
      >
        <Ionicons
          name={important ? "warning-outline" : "information-circle-outline"}
          size={26}
          color={accent}
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={styles.icon}
        />
        <View style={[styles.text, { gap: spacing[1] }]}>
          <Text
            testID="home-notice-title"
            accessibilityRole="header"
            style={[typography.labelButton, { color: colors.text.primary }]}
          >
            {title}
          </Text>
          <Text
            testID="home-notice-text"
            selectable
            style={[
              typography.bodyDefault,
              {
                color: colors.text.primary,
                writingDirection: isRTLLocale(picked.language) ? "rtl" : "ltr",
              },
            ]}
          >
            {picked.text}
          </Text>
        </View>
        <Pressable
          testID="home-notice-hide"
          accessibilityRole="button"
          accessibilityLabel={t("home.notice.hide")}
          onPress={onHide}
          style={styles.close}
        >
          <Ionicons name="close" size={20} color={colors.text.tertiary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: 14,
    borderStartWidth: 5,
  },
  icon: { marginTop: 2 },
  text: { flex: 1, paddingTop: 2 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
