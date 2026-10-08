import { Stack, useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { PeopleList } from "@/features/community/components/PeopleList";
import { useFollowList } from "@/features/community/queries";
import { useTheme } from "@/theme";
import { useTabBarScroll } from "@/features/tab-bar";

/** Followers or following of one account (`?kind=followers|following`).
 * The server returns nothing for a private account the viewer may not see. */
export default function PeopleScreen() {
  const tabBarScroll = useTabBarScroll();
  const { username, kind } = useLocalSearchParams<{ username: string; kind?: string }>();
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const which = kind === "following" ? "following" : "followers";
  const list = useFollowList(username, which);

  return (
    <View style={[styles.flex, { backgroundColor: colors.surface.base }]}>
      <Stack.Screen
        options={{
          title: t(`community.profile.${which}`),
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
        <PeopleList
          people={list.data}
          isLoading={list.isLoading}
          isError={list.isError}
          emptyText={t("community.people.empty")}
          testID="people-list"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
});
