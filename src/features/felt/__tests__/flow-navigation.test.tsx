/**
 * The felt-report flow inside a REAL router (expo-router's renderRouter):
 * the real flow layout and screens, opened as a modal over a stub Home and a
 * stub event page.
 *
 * Review notes 3.2 and 3.1 (owner test, 2026-10-13): "Close" on the
 * thank-you screen only popped one screen of the flow, so the owner landed
 * back inside the flow (and on its first screen after one more Close) and
 * sent new reports from there; three of them arrived with event_id null.
 * These tests pin both halves of the fix: every Close leaves the WHOLE flow
 * and lands where it was opened, and a report started from an event page
 * keeps that event through every step, through "add more detail" and
 * through a second report.
 */
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { router, Stack } from "expo-router";
import { Text } from "react-native";

import i18n from "@/i18n";

import {
  encodeEventRegistrationParam,
  enqueueTier1Report,
  TIER2_QUESTIONS,
  useFeltQueueStore,
  useTier2DraftStore,
  type EventRegistration,
} from "../";

/** The route indices the questionnaire actually shows after window 1: the
 * science-pack order minus the "felt" question, which the window-1 level
 * answers (A-13) — nine screens at indices 0 and 2-9. */
const ASKED_STEPS = TIER2_QUESTIONS.map((question, index) => (question.field === "felt" ? null : index)).filter(
  (index): index is number => index !== null,
);

jest.mock("expo-location", () => ({
  PermissionStatus: { GRANTED: "granted", DENIED: "denied", UNDETERMINED: "undetermined" },
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: () => Promise.resolve({ status: "denied" }),
  getLastKnownPositionAsync: () => Promise.resolve(null),
  getCurrentPositionAsync: () => Promise.resolve(null),
}));
jest.mock("expo-crypto", () => ({
  randomUUID: () => {
    const g = globalThis as { __flowNavUuid?: number };
    g.__flowNavUuid = (g.__flowNavUuid ?? 0) + 1;
    return `flow-nav-uuid-${g.__flowNavUuid}`;
  },
}));
jest.mock("expo-image-picker", () => ({
  MediaTypeOptions: { Images: "Images" },
  launchImageLibraryAsync: jest.fn(),
}));
// The "Are you safe?" card under "Thank you" has its own tests; it needs a
// query client this harness does not provide.
jest.mock("@/features/safe/components/FeltSafeCard", () => ({ FeltSafeCard: () => null }));

/* eslint-disable import/first -- after the mocks above */
import FeltReportLayout from "../../../../app/felt-report/_layout";
import Tier1Screen from "../../../../app/felt-report/index";
import DamageScreen from "../../../../app/felt-report/damage";
import DetailsScreen from "../../../../app/felt-report/details";
import StepScreen from "../../../../app/felt-report/step/[step]";
import DoneScreen from "../../../../app/felt-report/done";
/* eslint-enable import/first */

const EVENT_ID = "us7000urmia";
const REGISTRATION: EventRegistration = {
  provider: "usgs",
  providerId: "us7000urmia",
  originTime: Date.UTC(2026, 9, 13, 13, 50),
  lat: 37.5,
  lon: 45.1,
  depthKm: 10,
  magnitude: 4.6,
  magType: "mb",
  placeName: "Urmia",
};

function appContext() {
  return {
    _layout: () => (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="felt-report" options={{ presentation: "modal" }} />
      </Stack>
    ),
    index: () => <Text testID="origin">home</Text>,
    "event/[id]": () => <Text testID="origin">event page</Text>,
    "felt-report/_layout": FeltReportLayout,
    "felt-report/index": Tier1Screen,
    "felt-report/damage": DamageScreen,
    "felt-report/details": DetailsScreen,
    "felt-report/step/[step]": StepScreen,
    "felt-report/done": DoneScreen,
  };
}

/** Wrapped in an object: the render result is itself a thenable, and
 * returning it bare from an async function would unwrap it and drop
 * `getPathname` and friends. */
async function openApp(initialUrl: string) {
  const app = renderRouter(appContext() as never, { initialUrl });
  await app;
  return { app };
}

/** What the event page's "I felt it" pill pushes. */
async function openFromEventPage() {
  await act(async () =>
    router.push({
      pathname: "/felt-report",
      params: { eventId: EVENT_ID, eventReg: encodeEventRegistrationParam(REGISTRATION) },
    }),
  );
}

async function tapLevel(level: number) {
  await fireEvent.press(
    await screen.findByLabelText(`${level}. ${i18n.t(`felt.tier1.levels.${level}.label`)}`),
  );
}

async function pressButton(name: string) {
  await fireEvent.press(await screen.findByRole("button", { name }));
}

async function skipAllQuestions() {
  for (let shown = 0; shown < ASKED_STEPS.length; shown++) {
    await fireEvent.press(await screen.findByText(i18n.t("felt.tier2.skip")));
  }
}

function items() {
  return useFeltQueueStore.getState().items;
}

describe("felt-report flow in a real router", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  beforeEach(() => {
    useFeltQueueStore.setState({ items: [] });
    useTier2DraftStore.getState().reset();
  });

  it("baseline report from an event page: Close on Thank you returns to the event page", async () => {
    const { app } = await openApp(`/event/${EVENT_ID}`);
    await openFromEventPage();
    await tapLevel(5);
    await pressButton(i18n.t("felt.damage.noDamage.label"));
    expect(app.getSearchParams().eventId).toBe(EVENT_ID);
    await pressButton(i18n.t("felt.tier2.submit"));
    expect(app.getPathname()).toBe("/felt-report/done");

    await pressButton(i18n.t("felt.done.close"));
    expect(app.getPathname()).toBe(`/event/${EVENT_ID}`);
    expect(await screen.findByText("event page")).toBeTruthy();

    expect(items()).toHaveLength(1);
    expect(items()[0]?.tier1.eventId).toBe(EVENT_ID);
    expect(items()[0]?.tier1.eventRegistration).toEqual(REGISTRATION);
    expect(items()[0]?.tier2?.answers.buildingDamageLevel).toBe(1);
  });

  it("full questionnaire from an event page keeps the event on every step and closes to the event page", async () => {
    const { app } = await openApp(`/event/${EVENT_ID}`);
    await openFromEventPage();
    await tapLevel(4);
    await pressButton(i18n.t("felt.damage.noDamage.label"));
    await pressButton(i18n.t("felt.details.addMoreDetail"));

    // Nine screens: the "felt" question (index 1) is answered by the level
    // tapped in window 1 and stepped over (A-13).
    for (const step of ASKED_STEPS) {
      expect(app.getPathname()).toBe(`/felt-report/step/${step}`);
      expect(app.getSearchParams().eventId).toBe(EVENT_ID);
      expect(useTier2DraftStore.getState().eventId).toBe(EVENT_ID);
      await fireEvent.press(await screen.findByText(i18n.t("felt.tier2.skip")));
    }
    expect(app.getPathname()).toBe("/felt-report/done");
    // Level 4 ("Felt by many") was written into the draft as "yes" on the way.
    expect(items()[0]?.tier2?.answers.felt).toBe("yes");

    await pressButton(i18n.t("felt.done.close"));
    expect(app.getPathname()).toBe(`/event/${EVENT_ID}`);
    expect(items()).toHaveLength(1);
    expect(items()[0]?.tier1.eventId).toBe(EVENT_ID);
    expect(items()[0]?.tier1.eventRegistration).toEqual(REGISTRATION);
    expect(items()[0]?.tier2).not.toBeNull();
  });

  it("adding more detail to a finished report (event page row) attaches to the same report and closes to the event page", async () => {
    const first = await enqueueTier1Report({
      cartoonLevel: 3,
      location: { lat: 37.5, lon: 45.1, quality: "manual" },
      eventId: EVENT_ID,
      eventRegistration: REGISTRATION,
    });
    const { app } = await openApp(`/event/${EVENT_ID}`);
    // What the event page's "My report" row pushes.
    await act(async () =>
      router.push({
        pathname: "/felt-report/damage",
        params: { feltReportId: first.reportId, eventId: EVENT_ID },
      }),
    );
    await pressButton(i18n.t("felt.damage.noDamage.label"));
    await pressButton(i18n.t("felt.details.addMoreDetail"));
    await skipAllQuestions();
    await pressButton(i18n.t("felt.done.close"));

    expect(app.getPathname()).toBe(`/event/${EVENT_ID}`);
    expect(items()).toHaveLength(1);
    expect(items()[0]?.tier1.reportId).toBe(first.reportId);
    expect(items()[0]?.tier1.eventId).toBe(EVENT_ID);
    expect(items()[0]?.tier1.eventRegistration).toEqual(REGISTRATION);
    expect(items()[0]?.tier2?.feltReportId).toBe(first.reportId);
  });

  it("a second report from the same event page is linked to the event too", async () => {
    const { app } = await openApp(`/event/${EVENT_ID}`);
    for (const level of [7, 3]) {
      await openFromEventPage();
      await tapLevel(level);
      await pressButton(i18n.t("felt.damage.noDamage.label"));
      await pressButton(i18n.t("felt.tier2.submit"));
      await pressButton(i18n.t("felt.done.close"));
      expect(app.getPathname()).toBe(`/event/${EVENT_ID}`);
    }
    expect(items()).toHaveLength(2);
    expect(items()[0]?.tier1.reportId).not.toBe(items()[1]?.tier1.reportId);
    for (const item of items()) {
      expect(item.tier1.eventId).toBe(EVENT_ID);
      expect(item.tier1.eventRegistration).toEqual(REGISTRATION);
    }
  });

  it("a report from Home closes back to Home and stays unlinked", async () => {
    const { app } = await openApp("/");
    await act(async () => router.push("/felt-report"));
    await tapLevel(2);
    await pressButton(i18n.t("felt.damage.noDamage.label"));
    await pressButton(i18n.t("felt.tier2.submit"));
    await pressButton(i18n.t("felt.done.close"));

    expect(app.getPathname()).toBe("/");
    expect(await screen.findByText("home")).toBeTruthy();
    expect(items()).toHaveLength(1);
    expect(items()[0]?.tier1.eventId).toBeNull();
    expect(items()[0]?.tier1.eventRegistration).toBeNull();
  });

  it.each([
    ["the level screen", 0],
    ["the damage screen", 1],
    ["the details screen", 2],
  ])("Close on %s leaves the whole flow", async (_label, depth) => {
    const { app } = await openApp(`/event/${EVENT_ID}`);
    await openFromEventPage();
    if (depth >= 1) await tapLevel(5);
    if (depth >= 2) await pressButton(i18n.t("felt.damage.noDamage.label"));
    await pressButton(i18n.t("felt.tier1.close"));
    expect(app.getPathname()).toBe(`/event/${EVENT_ID}`);
  });

  it("opened cold from a link, Close lands on Home", async () => {
    const { app } = await openApp("/felt-report");
    await pressButton(i18n.t("felt.tier1.close"));
    expect(app.getPathname()).toBe("/");
  });
});
