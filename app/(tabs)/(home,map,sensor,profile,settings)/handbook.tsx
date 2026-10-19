import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { lazyScreenContent } from "@/components/LazyScreenContent";
import { loadHandbookArea } from "@/features/handbook/area-loader";

// On the web, downloaded on first use with the hazard maps (src/features/handbook/area.ts).
const HandbookScreen = lazyScreenContent(loadHandbookArea, (area) => area.HandbookScreen);

/**
 * Engineer's Handbook route (spec-v1.md §7, design-brief.md §9) — pushed
 * from Settings only (deliberately not linked from Event Detail
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
