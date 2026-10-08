import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { HandbookScreen } from "@/features/handbook";

/**
 * Engineer's Handbook route (spec-v1.md §7, design-brief.md §9) — pushed
 * from Settings only this wave (deliberately not linked from Event Detail
 * or anywhere else: a professional-audience side tool, not a panic-time
 * surface).
 */
export default function HandbookRoute() {
  const { t } = useTranslation();

  return (
    <>
      <Stack.Screen
        options={{
          title: t("handbook.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <HandbookScreen />
    </>
  );
}
