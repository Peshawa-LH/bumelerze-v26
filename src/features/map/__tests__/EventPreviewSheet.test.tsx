/**
 * @jest-environment jsdom
 *
 * The event-preview sheet, mounted DIRECTLY with controlled props — no
 * MapLibre, no map-creation async settle. This is the deliberate
 * counterpart to `app/__tests__/map-web-interaction.test.tsx`'s own doc
 * comment: THAT file only proves the map screen wires marker taps and the
 * background click into this component's controller; every behavior of the
 * sheet ITSELF (content, detents, buttons, keyboard/focus/reduced-motion)
 * belongs here, where a single render settles once and stays settled.
 * `jsdom` (not this project's usual default) is needed for the same reason
 * `map-web-*.test.tsx` needs it: real `window`/`document` for the
 * Escape-key and focus-management behavior this file exercises.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import { createRef, type ReactElement } from "react";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import type { Event } from "@/features/events";

// `EventPreviewSheet` now calls the real `useEventSourceAgencies`
// (`@/features/events/source-corroboration`) for its tag row — disabled
// here since no Supabase env vars are set (`isSupabaseConfigured()` stays
// false), but `useQuery` itself still needs a `QueryClientProvider` in the
// tree regardless of `enabled`, same requirement as every other
// react-query-backed hook this file's harness already wraps for.
const testQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 } },
});

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockUseReducedMotionPreference = jest.fn();
jest.mock("../reduced-motion", () => ({
  useReducedMotionPreference: () => mockUseReducedMotionPreference(),
}));

const mockUseUserDistanceAnchor = jest.fn();
jest.mock("@/features/location", () => ({
  useUserDistanceAnchor: () => mockUseUserDistanceAnchor(),
}));

// Spy-wrapped reanimated mock (overrides jest.setup.js's own
// `react-native-reanimated/mock` registration for THIS file only — Jest
// applies a test file's own `jest.mock` over the global `setupFiles` one)
// so tests can assert WHICH animation primitive `EventPreviewSheet` reached
// for (`withSpring` for detent changes, `withTiming` for close) versus
// skipped entirely under reduced motion, while keeping every other mocked
// behavior (synchronous `callback(true)` invocation, `runOnJS` as identity)
// exactly as the shared mock already provides.
jest.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require required inside a jest.mock factory
  const actualMock = require("react-native-reanimated/mock");
  return {
    ...actualMock,
    withSpring: jest.fn(actualMock.withSpring),
    withTiming: jest.fn(actualMock.withTiming),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports -- see comment above; must match the mocked module instance
const { withSpring: mockWithSpring, withTiming: mockWithTiming } = require("react-native-reanimated");

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import {
  EventPreviewSheet,
  type EventPreviewSheetHandle,
} from "../components/EventPreviewSheet";

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 800 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "us7000abcd",
    originTime: Date.now() - 5 * 60_000,
    lat: 35.56,
    lon: 45.43,
    depthKm: 10,
    magnitude: { value: 4.5, type: "mb" },
    placeName: "32 km SE of Halabja, Iraq",
    provenance: {
      provider: "usgs",
      providerId: "us7000abcd",
      fetchedAt: Date.now(),
      providerUpdatedAt: Date.now(),
    },
    sig: 300,
    isRegional: true,
    url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd",
    ...overrides,
  };
}

/**
 * Renders the sheet AND fires the `onLayout` `react-test-renderer` never
 * triggers on its own (there is no real layout engine under Jest) — every
 * height-dependent code path (`animateToDetent`'s `containerHeightPx <= 0`
 * guard in particular) needs this to behave as it would once genuinely
 * mounted over a real map area, matching how the component measures itself
 * in production via the overlay `View`'s own `onLayout`.
 */
async function renderSheet(ui: ReactElement) {
  const result = await render(
    <QueryClientProvider client={testQueryClient}>
      <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>
    </QueryClientProvider>,
  );
  await act(async () => {
    fireEvent(screen.getByTestId("event-preview-sheet-overlay"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 800 } },
    });
  });
  return result;
}

beforeEach(() => {
  mockPush.mockClear();
  mockUseReducedMotionPreference.mockReset().mockReturnValue(false);
  mockUseUserDistanceAnchor
    .mockReset()
    .mockReturnValue({ hasFix: false, lat: null, lon: null });
  mockWithSpring.mockClear();
  mockWithTiming.mockClear();
});

afterEach(async () => {
  // `cleanup()` is async in this installed `@testing-library/react-native`
  // version (14.x) — must be awaited, same as `render`/`renderHook`
  // elsewhere in this codebase, or the next test's `render()` can start
  // before this one's tree has actually unmounted.
  await cleanup();
});

describe("EventPreviewSheet: preview content", () => {
  it("shows magnitude, place, provenance and relative time at the peek detent, with no distance line when there's no location fix", async () => {
    const event = makeEvent();
    await renderSheet(
      <EventPreviewSheet
        content={event}
        detent="peek"
        onDetentChange={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );

    expect(
      screen.getByText(i18n.t("events.magnitudeDisplay", { value: "4.5" })),
    ).toBeTruthy();
    // `placeLine` computes the place text from the event's coordinates via
    // the gazetteer's nearest-city lookup, NOT the raw `placeName` field
    // (same as `EventCard`) — this default event's lat/lon resolve near
    // Slemani.
    expect(screen.getByText(/Slemani/)).toBeTruthy();
    // TagRow's individual pills are hidden from the a11y tree (the row's
    // own combined `accessibilityLabel` is what a screen reader hears) —
    // same `includeHiddenElements` convention as
    // `ShakeMapView.test.tsx`/`FeltMapView.test.tsx`.
    expect(
      screen.getByText(i18n.t("events.provenance.usgs"), {
        includeHiddenElements: true,
      }),
    ).toBeTruthy();
    expect(screen.queryByText(/from you/)).toBeNull();

    // Expanded-only content (local time, depth) is absent at peek.
    expect(
      screen.queryByText(new RegExp(i18n.t("eventDetail.depthSectionTitle"))),
    ).toBeNull();
  });

  it("shows a distance-from-you line once a location fix is available", async () => {
    mockUseUserDistanceAnchor.mockReturnValue({ hasFix: true, lat: 35.56, lon: 45.6 });
    await renderSheet(
      <EventPreviewSheet
        content={makeEvent()}
        detent="peek"
        onDetentChange={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );

    expect(screen.getByText(/from you/)).toBeTruthy();
  });

  it("shows local time and depth ADDITIONALLY once expanded", async () => {
    await renderSheet(
      <EventPreviewSheet
        content={makeEvent()}
        detent="expanded"
        onDetentChange={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );

    expect(
      screen.getByText(new RegExp(i18n.t("eventDetail.depthSectionTitle"))),
    ).toBeTruthy();
    expect(
      screen.getByText(new RegExp(i18n.t("eventDetail.localTimeLabel"))),
    ).toBeTruthy();
  });
});

describe("EventPreviewSheet: expand/collapse control", () => {
  it("the expand button requests the 'expanded' detent and animates via a spring; its own label flips once expanded", async () => {
    const onDetentChange = jest.fn();
    const { rerender } = await renderSheet(
      <EventPreviewSheet
        content={makeEvent()}
        detent="peek"
        onDetentChange={onDetentChange}
        onDismiss={jest.fn()}
      />,
    );

    const expandButton = screen.getByRole("button", {
      name: i18n.t("map.eventSheet.expandButtonLabel"),
    });
    await act(async () => {
      fireEvent.press(expandButton);
    });
    expect(onDetentChange).toHaveBeenCalledWith("expanded");
    expect(mockWithSpring).toHaveBeenCalled();

    await rerender(
      <QueryClientProvider client={testQueryClient}>
        <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>
          <EventPreviewSheet
            content={makeEvent()}
            detent="expanded"
            onDetentChange={onDetentChange}
            onDismiss={jest.fn()}
          />
        </SafeAreaProvider>
      </QueryClientProvider>,
    );
    expect(
      screen.getByRole("button", { name: i18n.t("map.eventSheet.collapseButtonLabel") }),
    ).toBeTruthy();
  });
});

describe("EventPreviewSheet: close", () => {
  it("the close button animates the sheet away (withTiming) and calls onDismiss once it 'finishes'", async () => {
    const onDismiss = jest.fn();
    await renderSheet(
      <EventPreviewSheet
        content={makeEvent()}
        detent="peek"
        onDetentChange={jest.fn()}
        onDismiss={onDismiss}
      />,
    );

    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: i18n.t("map.eventSheet.closeButtonLabel") }),
      );
    });

    expect(mockWithTiming).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("EventPreviewSheetHandle.requestClose() (the map background-click path) triggers the SAME close animation", async () => {
    const onDismiss = jest.fn();
    const ref = createRef<EventPreviewSheetHandle>();
    await renderSheet(
      <EventPreviewSheet
        ref={ref}
        content={makeEvent()}
        detent="peek"
        onDetentChange={jest.fn()}
        onDismiss={onDismiss}
      />,
    );

    await act(async () => {
      ref.current?.requestClose();
    });

    expect(mockWithTiming).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("EventPreviewSheet: reduced motion", () => {
  it("skips withTiming/withSpring entirely and closes/detents immediately when the user prefers reduced motion", async () => {
    mockUseReducedMotionPreference.mockReturnValue(true);
    const onDismiss = jest.fn();
    const onDetentChange = jest.fn();
    await renderSheet(
      <EventPreviewSheet
        content={makeEvent()}
        detent="peek"
        onDetentChange={onDetentChange}
        onDismiss={onDismiss}
      />,
    );

    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: i18n.t("map.eventSheet.expandButtonLabel") }),
      );
    });
    expect(mockWithSpring).not.toHaveBeenCalled();
    expect(onDetentChange).toHaveBeenCalledWith("expanded");

    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: i18n.t("map.eventSheet.closeButtonLabel") }),
      );
    });
    expect(mockWithTiming).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("EventPreviewSheet: navigation", () => {
  it("the felt-report action navigates to /felt-report with the event id and an encoded registration snapshot", async () => {
    const event = makeEvent();
    await renderSheet(
      <EventPreviewSheet
        content={event}
        detent="peek"
        onDetentChange={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: i18n.t("felt.pill.label") }));
    });

    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/felt-report",
        params: expect.objectContaining({ eventId: event.id }),
      }),
    );
  });

  it("the 'open full event' action navigates to /event/[id] with origin=map and resets the detent back to peek", async () => {
    const onDetentChange = jest.fn();
    const event = makeEvent();
    await renderSheet(
      <EventPreviewSheet
        content={event}
        detent="expanded"
        onDetentChange={onDetentChange}
        onDismiss={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", {
          name: i18n.t("map.eventSheet.openFullButtonLabel"),
        }),
      );
    });

    expect(onDetentChange).toHaveBeenCalledWith("peek");
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/event/[id]",
      params: { id: event.id, origin: "map" },
    });
  });
});

describe("EventPreviewSheet: keyboard and focus (web)", () => {
  const originalPlatformOS = Platform.OS;

  beforeEach(() => {
    Platform.OS = "web";
  });

  afterEach(() => {
    Platform.OS = originalPlatformOS;
  });

  it("Escape dismisses the sheet", async () => {
    const onDismiss = jest.fn();
    await renderSheet(
      <EventPreviewSheet
        content={makeEvent()}
        detent="peek"
        onDetentChange={jest.fn()}
        onDismiss={onDismiss}
      />,
    );

    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("a key other than Escape does nothing", async () => {
    const onDismiss = jest.fn();
    await renderSheet(
      <EventPreviewSheet
        content={makeEvent()}
        detent="peek"
        onDetentChange={jest.fn()}
        onDismiss={onDismiss}
      />,
    );

    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab" }));
    });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('marks the dialog with role="dialog" and a non-empty accessible label describing the event, so it announces itself to screen readers the moment focus lands on it', async () => {
    await renderSheet(
      <EventPreviewSheet
        content={makeEvent()}
        detent="peek"
        onDetentChange={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );

    const dialog = screen.getByTestId("event-preview-sheet");
    expect(dialog.props.role).toBe("dialog");
    expect(dialog.props["aria-modal"]).toBe(false);
    expect(dialog.props["aria-label"]).toBeTruthy();
    expect(dialog.props.tabIndex).toBe(-1);
  });

  // The focus-move-in/focus-restore-on-unmount MECHANICS themselves
  // (`document.activeElement`, calling `.focus()` on the underlying node)
  // need a real DOM element behind the ref to observe — `render()` here
  // uses React Native's own test renderer (confirmed: a plain `View`'s ref
  // is a fake test-renderer instance, not an `HTMLElement`, in this exact
  // harness), the same reason `app/__tests__/map-web-interaction.test.tsx`
  // only ever manipulates DOM nodes it created itself via
  // `document.createElement`, not React Native component refs. The dialog
  // role/label assertion above and the mount/unmount-without-throwing check
  // below are what this harness CAN verify; the actual focus transfer was
  // additionally checked by hand against the real web build.
  it("mounting and unmounting on web never throws (the focus-management effect's cleanup runs cleanly)", async () => {
    const { unmount } = await renderSheet(
      <EventPreviewSheet
        content={makeEvent()}
        detent="peek"
        onDetentChange={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );

    await expect(unmount()).resolves.not.toThrow();
  });
});

describe("EventPreviewSheet: accessibility", () => {
  it("expand, close, felt-report and open-full-event controls are all real buttons with non-empty accessible names", async () => {
    await renderSheet(
      <EventPreviewSheet
        content={makeEvent()}
        detent="peek"
        onDetentChange={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );

    for (const name of [
      i18n.t("map.eventSheet.expandButtonLabel"),
      i18n.t("map.eventSheet.closeButtonLabel"),
      i18n.t("felt.pill.label"),
      i18n.t("map.eventSheet.openFullButtonLabel"),
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  // Repo-wide font-scaling (design-language.md §8: 200% Dynamic Type is a
  // hard requirement) is already enforced statically, for every source
  // file including this one, by `src/__tests__/a11y-invariants.test.ts`'s
  // "never disables font scaling" scan — no need to duplicate it here.
});
