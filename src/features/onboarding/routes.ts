import type { Href } from "expo-router";

import type { OnboardingStepId } from "./store";

/** Route for each onboarding step — the single source of truth so the
 * resume-after-restart redirect (app/onboarding/index.tsx) and any future
 * caller never hand-write an onboarding path string. */
const ONBOARDING_ROUTES = {
  mission: "/onboarding",
  language: "/onboarding/language",
  location: "/onboarding/location",
  notifications: "/onboarding/notifications",
  homeBase: "/onboarding/home-base",
  done: "/onboarding/done",
} as const satisfies Record<OnboardingStepId, Href>;

export function onboardingRouteForStep(step: OnboardingStepId): Href {
  return ONBOARDING_ROUTES[step];
}
