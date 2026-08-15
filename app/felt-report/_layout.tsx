import { Stack } from "expo-router";

/**
 * Felt-Report Flow — presented as a modal from app/_layout.tsx.
 * 2026-08-15 flow restructure (owner directive): three baseline windows
 * (index -> damage -> details), an optional deeper questionnaire behind
 * "Add more detail" (step/[step]), and a shared completion screen (done).
 * Every screen renders its own chrome, so the native header stays hidden
 * here, same pattern as app/onboarding/_layout.tsx.
 */
export default function FeltReportLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="damage" />
      <Stack.Screen name="details" />
      <Stack.Screen name="step/[step]" />
      <Stack.Screen name="done" />
    </Stack>
  );
}
