import { Stack } from "expo-router";
import { FlatList, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { ContributionRow, ReportsEmpty, useMyReports } from "@/features/mydata";
import { useTheme } from "@/theme";

/**
 * Every report this phone sent, newest first. The My account page previews
 * only the latest three so its scroll stays short; this screen holds the
 * long list (a virtualised FlatList, never inside the page's ScrollView).
 */
export default function MyReportsScreen() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const { hasHydrated, rows } = useMyReports();

  return (
    <View style={[styles.flex, { backgroundColor: colors.surface.base }]}>
      <Stack.Screen
        options={{
          title: t("myData.reports.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <FlatList
        data={rows}
        keyExtractor={(row) => row.reportId}
        renderItem={({ item }) => <ContributionRow row={item} />}
        ListEmptyComponent={hasHydrated ? <ReportsEmpty /> : null}
        contentContainerStyle={[
          styles.content,
          {
            gap: spacing[3],
            paddingHorizontal: spacing[4],
            paddingTop: spacing[4],
            paddingBottom: insets.bottom + spacing[6],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, width: "100%", maxWidth: 560, alignSelf: "center" },
});
