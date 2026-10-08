/**
 * "Using Bumelerze" content model: a short, secondary teaching section under
 * the earthquake-safety guides (owner feedback 2026-10-04: teach how to report
 * what you felt, use the Event hub, tag your building and use your account).
 *
 * Keys-only, like `content.ts`: all copy lives under `safety.usingApp.*` in the
 * four locale catalogs. Button and screen names inside the steps are NOT
 * retyped per locale: each step receives them as interpolation params
 * resolved from the keys the app already uses for those labels
 * (`usingAppLabelParamKeys`), so a rename there (a pill, a tab, "Profile")
 * updates the guide automatically.
 */

import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

export type UsingAppGuideId = "reportFelt" | "eventHub" | "tagBuilding" | "account";

export type UsingAppActionId = "tagBuilding" | "openAccount" | "seeExample";

export interface UsingAppGuide {
  id: UsingAppGuideId;
  icon: ComponentProps<typeof Ionicons>["name"];
  /** `safety.usingApp.<id>.step1..stepN`. */
  stepCount: number;
  /** Defaults to `safety.usingApp.<id>.title`. */
  titleKey?: string;
  /** Buttons under the steps, in order; the first one is the primary one. */
  actions: readonly UsingAppActionId[];
}

export const USING_APP_GUIDES: readonly UsingAppGuide[] = [
  { id: "reportFelt", icon: "pulse-outline", stepCount: 3, actions: [] },
  { id: "eventHub", icon: "people-outline", stepCount: 4, actions: ["seeExample"] },
  {
    id: "tagBuilding",
    icon: "home-outline",
    stepCount: 4,
    // Same name the My home card and the tagging screens use.
    titleKey: "building.title",
    actions: ["tagBuilding"],
  },
  {
    id: "account",
    icon: "person-circle-outline",
    stepCount: 3,
    actions: ["openAccount"],
  },
];

/** Interpolation name -> existing i18n key whose text it stands for. */
const GUIDE_LABEL_PARAMS: Readonly<
  Record<UsingAppGuideId, Readonly<Record<string, string>>>
> = {
  reportFelt: { label: "felt.pill.label" },
  eventHub: {
    label: "eventHub.pill.label",
    hub: "eventHub.title",
    helpful: "eventHub.thread.helpful",
    official: "eventHub.roles.official",
  },
  tagBuilding: {
    account: "tabs.profile",
    home: "building.section.title",
    tag: "building.title",
  },
  account: { account: "tabs.profile" },
};

/** Route of the featured 2017 event's hub, used for "See an example". */
export const USING_APP_EXAMPLE_HUB_ID = "us2000bmcg";

export const USING_APP_TITLE_KEY = "safety.usingApp.title";

export function usingAppGuideTitleKey(guide: UsingAppGuide): string {
  return guide.titleKey ?? `safety.usingApp.${guide.id}.title`;
}

export function usingAppStepKey(guideId: UsingAppGuideId, index: number): string {
  return `safety.usingApp.${guideId}.step${index}`;
}

export function usingAppStepKeys(guide: UsingAppGuide): string[] {
  return Array.from({ length: guide.stepCount }, (_, i) =>
    usingAppStepKey(guide.id, i + 1),
  );
}

/** `{ name: i18nKey }` for the labels a guide's steps interpolate. */
export function usingAppLabelParamKeys(
  guideId: UsingAppGuideId,
): Readonly<Record<string, string>> {
  return GUIDE_LABEL_PARAMS[guideId];
}

export const USING_APP_OPEN_ACCOUNT_KEY = "safety.usingApp.account.open";
export const USING_APP_EXAMPLE_KEY = "safety.usingApp.eventHub.example";

/** Every `safety.usingApp.*` key the section can render (for integrity tests). */
export function allUsingAppKeys(): string[] {
  const keys: string[] = [USING_APP_TITLE_KEY];
  for (const guide of USING_APP_GUIDES) {
    if (!guide.titleKey) {
      keys.push(usingAppGuideTitleKey(guide));
    }
    keys.push(...usingAppStepKeys(guide));
    if (guide.actions.includes("openAccount")) keys.push(USING_APP_OPEN_ACCOUNT_KEY);
    if (guide.actions.includes("seeExample")) keys.push(USING_APP_EXAMPLE_KEY);
  }
  return keys;
}
