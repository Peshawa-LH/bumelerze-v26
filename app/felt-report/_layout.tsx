import { Stack } from "expo-router";

/**
 * Felt-Report Flow (spec-v1.md §4.6) — presented as a modal from
 * app/_layout.tsx. Every screen renders its own chrome (tier 1: minimal,
 * big-type panic-time layout; tier 2: `Tier2ScreenShell`), so the native
 * header stays hidden here, same pattern as app/onboarding/_layout.tsx.
 */
export default function FeltReportLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="step/[step]" />
      <Stack.Screen name="comment" />
    </Stack>
  );
}
