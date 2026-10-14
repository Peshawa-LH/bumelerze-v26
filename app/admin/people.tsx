import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { lazyScreenContent } from "@/components/LazyScreenContent";
import { loadAdminArea } from "@/features/admin/area-loader";
import { useTheme } from "@/theme";

// On the web, downloaded on first use (src/features/admin/area.ts).
const PeopleContent = lazyScreenContent(loadAdminArea, (area) => area.PeopleContent);

/** Admin > People: the directory of accounts and app installs. Gated by
 * `people.view` inside the content; a stray link shows nothing. */
export default function AdminPeopleScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      <Stack.Screen
        options={{
          title: t("admin.people.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <PeopleContent />
    </View>
  );
}
