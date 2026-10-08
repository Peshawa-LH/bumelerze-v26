import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { usePrefsStore } from "@/features/onboarding/store";
import { useTheme } from "@/theme";

/**
 * The Home "Be ready" card (D79, 2026-10-08). The Safety guide left the tab
 * bar for Settings, so new readers get one calm pointer to it on Home: a
 * small card, no alarm colours, no urgency wording. It goes away for good once
 * the reader opens the Safety guide (the guide screen marks it) or taps the
 * close button; both write `beReadyHidden` in the persisted prefs.
 */
export function BeReadyCard() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const hidden = usePrefsStore((state) => state.beReadyHidden);
  const hideBeReady = usePrefsStore((state) => state.hideBeReady);
  if (hidden) {
    return null;
  }
  return (
    <View style={{ paddingHorizontal: spacing[4], paddingBottom: spacing[3] }}>
      <View
        testID="be-ready-card"
        style={[
          styles.card,
          {
            backgroundColor: colors.surface.raised,
            borderColor: colors.border.default,
          },
        ]}
      >
        <Pressable
          testID="be-ready-open"
          accessibilityRole="button"
          accessibilityLabel={`${t("home.beReady.title")}. ${t("home.beReady.body")}`}
          onPress={() => router.push("/safety")}
          style={({ pressed }) => [
            styles.main,
            {
              gap: spacing[3],
              padding: spacing[3],
              backgroundColor: pressed ? colors.surface.sunken : "transparent",
            },
          ]}
        >
          <Ionicons
            name="shield-checkmark-outline"
            size={28}
            color={colors.brand.primary}
          />
          <View style={styles.text}>
            <Text style={[typography.labelButton, { color: colors.text.primary }]}>
              {t("home.beReady.title")}
            </Text>
            <Text style={[typography.bodyMeta, { color: colors.text.secondary }]}>
              {t("home.beReady.body")}
            </Text>
          </View>
        </Pressable>
        <Pressable
          testID="be-ready-dismiss"
          accessibilityRole="button"
          accessibilityLabel={t("home.beReady.dismiss")}
          hitSlop={4}
          onPress={hideBeReady}
          style={styles.dismiss}
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
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    overflow: "hidden",
  },
  main: { flex: 1, flexDirection: "row", alignItems: "center", minHeight: 64 },
  text: { flex: 1, gap: 2 },
  dismiss: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
