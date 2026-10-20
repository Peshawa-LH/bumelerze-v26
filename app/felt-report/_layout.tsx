import { Stack, useNavigation, useSegments } from "expo-router";
import { useLayoutEffect } from "react";
import { Platform } from "react-native";

/** The flow's screens after the first tap: the tier-1 report is already
 * queued and the person is adding to it (`useTier2DraftStore`). */
const MID_REPORT_SCREENS: ReadonlySet<string> = new Set(["damage", "details", "step"]);

/**
 * Felt-Report Flow — presented as a modal from app/_layout.tsx.
 * 2026-08-15 flow restructure (owner directive): three baseline windows
 * (index -> damage -> details), an optional deeper questionnaire behind
 * "Add more detail" (step/[step]), and a shared completion screen (done).
 * Every screen renders its own chrome, so the native header stays hidden
 * here, same pattern as app/onboarding/_layout.tsx.
 *
 * iOS/Android: mid-report (damage, details, the questionnaire) the
 * screen's dismiss gesture is off, so answers, a comment or a photo are
 * never lost to a stray swipe; the flow's own Close button leaves it, as on
 * the web, which has no such gesture. On the first window (nothing chosen
 * yet) and on "Thank you" it stays. The root stack presents the flow full
 * screen on iOS (no swipe-down there); the guard keeps the draft safe should
 * the flow be shown as a sheet, which iOS closes with a downward swipe.
 */
export default function FeltReportLayout() {
  const navigation = useNavigation();
  const segments = useSegments() as string[];
  const midReport = MID_REPORT_SCREENS.has(segments[1] ?? "");

  useLayoutEffect(() => {
    if (Platform.OS === "web") {
      return;
    }
    navigation.setOptions({ gestureEnabled: !midReport });
  }, [navigation, midReport]);

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
