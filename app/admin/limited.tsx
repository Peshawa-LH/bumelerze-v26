import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { lazyScreenContent } from "@/components/LazyScreenContent";
import { loadAdminArea } from "@/features/admin/area-loader";
import { useTheme } from "@/theme";

// On the web, downloaded on first use (src/features/admin/area.ts).
const LimitedAccountsContent = lazyScreenContent(
  loadAdminArea,
  (area) => area.LimitedAccountsContent,
);

/** Admin > Limited accounts: the limits in force and those of the last 30
 * days, with Lift. Gated by `accounts.restrict` inside the content; a stray
 * link shows nothing. */
export default function AdminLimitedScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      <Stack.Screen
        options={{
          title: t("restrictions.list.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <LimitedAccountsContent />
    </View>
  );
}
