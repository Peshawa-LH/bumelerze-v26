import { Stack } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { useMySummary } from "@/features/account/use-my-summary";
import { BadgesSection } from "@/features/badges";
import { useTheme } from "@/theme";

/**
 * "All badges": the owner's full collection (earned, locked, and the ranks
 * that can be requested), opened from "See all (N)" on the Profile tab. The
 * public profile only ever shows earned badges; this page is the one place
 * the locked ones and "Request this badge" live. It reads only the person's
 * own numbers, so it has nothing to show or ask about anyone else.
 */
export default function BadgesScreen() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const summary = useMySummary();

  return (
    <View style={[styles.flex, { backgroundColor: colors.surface.base }]}>
      <Stack.Screen
        options={{
          title: t("myData.badges.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            padding: spacing[4],
            paddingBottom: insets.bottom + spacing[6],
          },
        ]}
      >
        <BadgesSection
          entries={summary.badges}
          earned={summary.badgesEarned}
          total={summary.badgesTotal}
          defaultExpanded
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
});
