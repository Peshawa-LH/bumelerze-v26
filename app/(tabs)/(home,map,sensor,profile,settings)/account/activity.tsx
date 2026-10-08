import { Stack } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { ActivityContent } from "@/features/activity";
import { useTabBarScroll } from "@/features/tab-bar";
import { useTheme } from "@/theme";

/** Activity (migration 0061): opened from the bell on the Profile tab. */
export default function ActivityScreen() {
  const tabBarScroll = useTabBarScroll();
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.flex, { backgroundColor: colors.surface.base }]}>
      <Stack.Screen
        options={{
          title: t("activity.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <ScrollView
        {...tabBarScroll}
        contentContainerStyle={[
          styles.content,
          { padding: spacing[4], paddingBottom: insets.bottom + spacing[6] },
        ]}
      >
        <ActivityContent />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
});
