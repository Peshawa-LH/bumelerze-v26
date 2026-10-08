import { Stack, useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { ProfileByUsername } from "@/features/profile";
import { useTheme } from "@/theme";
import { useTabBarScroll } from "@/features/tab-bar";

/**
 * Profile page `/u/[username]`, opened from a name or photo in the Event hub
 * or a shared link. Someone else's profile is the public view only; when the
 * username is the viewer's own, the same merged own page as the Profile tab
 * renders here (inside this stack screen, so Back returns to where the link
 * was tapped from). Every state has a friendly message: profiles not
 * available yet (no server, or the community migration is not applied), no
 * such account, and a failed load with Retry.
 */
export default function PublicProfileScreen() {
  const tabBarScroll = useTabBarScroll();
  const { username } = useLocalSearchParams<{ username: string }>();
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.flex, { backgroundColor: colors.surface.base }]}>
      <Stack.Screen
        options={{
          title: t("community.profile.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <ScrollView
        {...tabBarScroll}
        contentContainerStyle={[
          styles.content,
          {
            padding: spacing[4],
            paddingBottom: insets.bottom + spacing[6],
          },
        ]}
      >
        <ProfileByUsername username={username} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
});
