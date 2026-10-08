import type { ComponentProps } from "react";
import type { Stack } from "expo-router";

import { useTheme } from "@/theme";

type StackScreenOptions = NonNullable<ComponentProps<typeof Stack>["screenOptions"]>;

/**
 * The look every Stack in the app shares: no header unless a screen asks for
 * one with its own inline `<Stack.Screen options>`, theme colours, and the
 * theme face on header titles (so Sorani/Arabic titles use Vazirmatn on native
 * as well as web). Used by the root Stack and by each tab's own Stack.
 */
export function useStackScreenOptions(): StackScreenOptions {
  const { colors, typography } = useTheme();
  return {
    headerShown: false,
    contentStyle: { backgroundColor: colors.surface.base },
    headerStyle: { backgroundColor: colors.surface.base },
    headerTintColor: colors.text.primary,
    headerTitleStyle: {
      color: colors.text.primary,
      ...(typography.h3.fontFamily ? { fontFamily: typography.h3.fontFamily } : {}),
    },
    headerShadowVisible: false,
  };
}
