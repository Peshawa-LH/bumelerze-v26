import { TourScreen } from "@/features/tour";

/**
 * The guided app tour (owner request, 2026-10-08): a full-screen route like
 * onboarding, with no header or tab bar. Opened from the last onboarding
 * screen and from Settings > App tour; see `features/tour`.
 */
export default function TourRoute() {
  return <TourScreen />;
}
