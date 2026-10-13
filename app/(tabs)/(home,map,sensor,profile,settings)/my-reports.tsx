import { Stack } from "expo-router";
import { useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import {
  ContributionRow,
  ReportsEmpty,
  useMyReports,
  WithdrawReportSheet,
  type ContributionRowViewModel,
} from "@/features/mydata";
import { useTheme } from "@/theme";
import { useTabBarScroll } from "@/features/tab-bar";

/**
 * Every report this phone sent, newest first. Opened from the "My reports"
 * row on the Profile page (review note 15.5: the list left the profile so it
 * no longer pushes the rows below it down); a virtualised FlatList, never
 * inside the profile's ScrollView. Each report can be withdrawn (review note
 * 10.1) after a confirm sheet, with the usual Undo snackbar.
 */
export default function MyReportsScreen() {
  const tabBarScroll = useTabBarScroll();
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const { hasHydrated, rows } = useMyReports();
  const [withdrawing, setWithdrawing] = useState<ContributionRowViewModel | null>(null);

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
        {...tabBarScroll}
        data={rows}
        keyExtractor={(row) => row.reportId}
        renderItem={({ item }) => (
          <ContributionRow row={item} onWithdraw={() => setWithdrawing(item)} />
        )}
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
      {withdrawing ? (
        <WithdrawReportSheet row={withdrawing} onClose={() => setWithdrawing(null)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, width: "100%", maxWidth: 560, alignSelf: "center" },
});
