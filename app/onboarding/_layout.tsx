import { Stack } from "expo-router";

/**
 * First-launch-only stack (spec-v1.md §4.11), mounted outside the tab bar —
 * see app/_layout.tsx for the onboarding-vs-tabs switch. Every screen
 * renders its own chrome via OnboardingScreenShell, so the native header is
 * always hidden here.
 */
export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="language" />
      <Stack.Screen name="location" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="home-base" />
      <Stack.Screen name="done" />
    </Stack>
  );
}
