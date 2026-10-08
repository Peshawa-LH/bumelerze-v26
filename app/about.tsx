import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { AboutScreen } from "@/features/about";

/** About Bumelerze: pushed from Settings (the row and the footer). */
export default function AboutRoute() {
  const { t } = useTranslation();

  return (
    <>
      <Stack.Screen
        options={{
          title: t("about.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <AboutScreen />
    </>
  );
}
