import { Stack, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { lazyScreenContent } from "@/components/LazyScreenContent";
import { loadAdminArea } from "@/features/admin/area-loader";
import { useTheme } from "@/theme";

// On the web, downloaded on first use (src/features/admin/area.ts).
const PersonContent = lazyScreenContent(loadAdminArea, (area) => area.PersonContent);

/** Admin > People > one person: identity, devices, activity, limits, history
 * and notes, plus the actions. Opening it is logged on the server. */
export default function AdminPersonScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      <Stack.Screen
        options={{
          title: t("admin.person.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <PersonContent userId={typeof id === "string" ? id : ""} />
    </View>
  );
}
