import { Stack } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { useAccount } from "@/features/account/use-account";
import { useTheme } from "@/theme";
import { useTabBarScroll } from "@/features/tab-bar";
import { lazyScreenContent } from "@/components/LazyScreenContent";
import { loadProfileArea } from "@/features/profile/area-loader";

// On the web, downloaded on first use (src/features/profile/area.ts).
const MyHomeCard = lazyScreenContent(loadProfileArea, (area) => area.MyHomeCard);
const TrashedHomesSection = lazyScreenContent(
  loadProfileArea,
  (area) => area.TrashedHomesSection,
);

/**
 * My home: the tagged homes (their class, the building report and the
 * family), tag another or join one, and the homes deleted in the last 14
 * days. Opened from the "My home" row of the Profile page's "Only you see
 * this" list (review note 5.1), so the profile stays one tidy list.
 */
export default function MyHomeScreen() {
  const tabBarScroll = useTabBarScroll();
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const account = useAccount();

  return (
    <View style={[styles.flex, { backgroundColor: colors.surface.base }]}>
      <Stack.Screen
        options={{
          title: t("building.section.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <ScrollView
        {...tabBarScroll}
        contentContainerStyle={[
          styles.content,
          {
            gap: spacing[5],
            padding: spacing[4],
            paddingBottom: insets.bottom + spacing[6],
          },
        ]}
      >
        <MyHomeCard />
        {account.status === "account" ? <TrashedHomesSection /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { width: "100%", maxWidth: 600, alignSelf: "center" },
});
