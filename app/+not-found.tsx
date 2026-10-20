import { Stack, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme, nativeFontFamily, READING_START } from "@/theme";

/**
 * Any address the app has no screen for (a mistyped link, an old path):
 * the app's own "Page not found" in the app's language, theme and type, with
 * one way out, Home. Replaces Expo Router's stock "Unmatched Route" screen
 * (English only, white-on-black, the raw URL and a sitemap link — review
 * B-1). Nothing about the address is shown: a wrong link is not something
 * the person can do anything with here.
 */
export default function NotFoundScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface.base,
          paddingTop: insets.top + spacing[6],
          paddingBottom: insets.bottom + spacing[6],
          paddingStart: spacing[6],
          paddingEnd: spacing[6],
          gap: spacing[3],
        },
      ]}
      testID="not-found-screen"
    >
      <Stack.Screen options={{ headerShown: false }} />
      <Text
        accessibilityRole="header"
        style={[
          styles.centered,
          {
            color: colors.text.primary,
            fontSize: typography.h1.fontSize,
            fontFamily: nativeFontFamily(typography.h1),
            lineHeight: typography.h1.lineHeight,
            fontWeight: typography.h1.fontWeight,
          },
        ]}
      >
        {t("nav.notFoundTitle")}
      </Text>
      <Text
        style={[
          styles.centered,
          {
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            fontFamily: nativeFontFamily(typography.bodyDefault),
            lineHeight: typography.bodyDefault.lineHeight,
          },
        ]}
      >
        {t("nav.notFoundBody")}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.replace("/")}
        style={[
          styles.button,
          {
            backgroundColor: colors.brand.primary,
            marginTop: spacing[3],
            paddingHorizontal: spacing[6],
          },
        ]}
        testID="not-found-home"
      >
        <Text
          style={{
            color: colors.brand.onPrimary,
            fontSize: typography.labelButton.fontSize,
            fontFamily: nativeFontFamily(typography.labelButton),
            ...READING_START,
            fontWeight: typography.labelButton.fontWeight,
          }}
        >
          {t("nav.goHome")}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  centered: { textAlign: "center" },
  button: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
