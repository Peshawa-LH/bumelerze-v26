import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { FEEDBACK_PHOTO_MAX_COUNT, useFeedbackQueueStore } from "@/features/feedback";

/**
 * Feedback screen (owner directive, see `src/features/feedback/queue.ts`'s
 * own header for the full quote). Mirrors
 * `src/features/felt/__tests__/details-screen.test.tsx`'s photo-picker mock
 * shape and `act(async () => { fireEvent.press(...); await Promise.resolve();
 * ... })` convention for any press that triggers an async handler (the
 * picker's own resolved promise, `enqueueFeedback`'s AsyncStorage-backed
 * `getDeviceId()`/queue write) — a bare synchronous `fireEvent.press`
 * followed by a fixed number of ticks outside `act()` left a state update
 * landing outside any act-tracked scope here, corrupting the shared
 * react-test-renderer root for whichever test ran next. Also mirrors
 * `app/__tests__/my-data-screen.test.tsx`'s `expo-router` mock shape
 * (`Stack.Screen` + `useRouter`) — this screen uses both.
 *
 * No Supabase env vars are set in this test environment
 * (`isSupabaseConfigured()` is false), so `enqueueFeedback` resolves through
 * `PendingFeedbackTransport` — the queue item settles into
 * "awaiting-backend", never "submitted". This is exactly the env-gating
 * case the wave brief calls out: the confirmation screen must never claim
 * the feedback was sent under that condition.
 *
 * Multi-photo (migration 0021 wave): the picker mock now returns however
 * many `assets` a test configures — `launchImageLibraryAsync` is a single
 * call whether the user picked one screenshot or several, mirroring how
 * `expo-image-picker`'s own `allowsMultipleSelection` API works.
 */

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockCanDismiss = jest.fn(() => false);
const mockDismiss = jest.fn();
const routeParams: { screen?: string } = { screen: "settings" };

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => routeParams,
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    canDismiss: mockCanDismiss,
    dismiss: mockDismiss,
  }),
  Stack: Object.assign(() => null, {
    Screen: () => null,
  }),
}));

const mockLaunchImageLibraryAsync = jest.fn();
jest.mock("expo-image-picker", () => ({
  MediaTypeOptions: { Images: "Images" },
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: () => {
    const g = globalThis as { __feedbackScreenTestUuidCounter?: number };
    g.__feedbackScreenTestUuidCounter = (g.__feedbackScreenTestUuidCounter ?? 0) + 1;
    return `test-feedback-screen-uuid-${g.__feedbackScreenTestUuidCounter}`;
  },
}));

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import FeedbackScreen from "../feedback";

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderWithProviders(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

/** Flushes a handful of microtask AND macrotask turns from inside an active
 * `act()` scope — covers both plain `Promise.resolve()` chains (the picker
 * mock) and `setTimeout`-based ones (AsyncStorage's mock), matching
 * `app/__tests__/settings-permissions.test.tsx`'s own `flush()` helper. */
async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Presses a button and flushes whatever async handler it triggers, all
 * inside ONE `act()` scope — see this file's header comment for why a bare
 * `fireEvent.press` isn't enough for the two async presses this screen has
 * (add screenshot, submit). */
async function pressAndFlush(button: ReturnType<typeof screen.getByRole>) {
  await act(async () => {
    fireEvent.press(button);
    await flush();
  });
}

function mockPickerAssets(uris: string[]) {
  mockLaunchImageLibraryAsync.mockResolvedValueOnce({
    canceled: false,
    assets: uris.map((uri) => ({ uri })),
  });
}

/** Presses whichever of the two photo-picker triggers is currently shown —
 * "Add screenshots" (no photos yet) or "Add more" (at least one already
 * attached) — the cap-reached state hides both, so callers should not use
 * this once at the limit. */
async function addScreenshots() {
  const button = screen.queryByRole("button", { name: i18n.t("feedback.photo.addLabel") })
    ?? screen.getByRole("button", { name: i18n.t("feedback.photo.addMoreLabel") });
  await pressAndFlush(button);
}

function removeThumbnailButton(index: number) {
  return screen.getByRole("button", {
    name: i18n.t("feedback.photo.removeThumbnailLabel", { index }),
  });
}

async function submit() {
  await pressAndFlush(screen.getByRole("button", { name: i18n.t("feedback.submit") }));
}

describe("Feedback screen", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    mockPush.mockClear();
    mockBack.mockClear();
    mockDismiss.mockClear();
    mockCanDismiss.mockReset().mockReturnValue(false);
    mockLaunchImageLibraryAsync.mockReset();
    useFeedbackQueueStore.setState({ items: [] });
    routeParams.screen = "settings";
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  afterEach(async () => {
    // Awaited (unlike most of this repo's other screen tests' plain
    // `cleanup()`): `cleanup()` is itself async (it awaits each queued
    // `unmount()`, its own `act()` call) — leaving it un-awaited let the
    // unmount race the next test's own render() call.
    await cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("disables Submit until a message is entered", async () => {
    await renderWithProviders(<FeedbackScreen />);

    expect(
      screen.getByRole("button", { name: i18n.t("feedback.submit") }).props.accessibilityState
        ?.disabled,
    ).toBe(true);

    await act(async () => {
      fireEvent.changeText(
        screen.getByLabelText(i18n.t("feedback.messageLabel")),
        "Something is broken.",
      );
    });

    expect(
      screen.getByRole("button", { name: i18n.t("feedback.submit") }).props.accessibilityState
        ?.disabled,
    ).toBe(false);
  });

  it("adding one screenshot shows a thumbnail with a remove control; removing it clears the set", async () => {
    mockPickerAssets(["file:///tmp/screenshot.jpg"]);

    await renderWithProviders(<FeedbackScreen />);
    await addScreenshots();

    expect(removeThumbnailButton(1)).toBeTruthy();

    await act(async () => {
      fireEvent.press(removeThumbnailButton(1));
    });

    expect(screen.queryByRole("button", { name: i18n.t("feedback.photo.removeThumbnailLabel", { index: 1 }) })).toBeNull();
    // Back to "Add screenshots" (not "Add more") once the set is empty again.
    expect(screen.getByRole("button", { name: i18n.t("feedback.photo.addLabel") })).toBeTruthy();
  });

  it("multi-select: picking several screenshots at once gives each one its own thumbnail and remove control", async () => {
    mockPickerAssets(["file:///tmp/one.jpg", "file:///tmp/two.jpg", "file:///tmp/three.jpg"]);

    await renderWithProviders(<FeedbackScreen />);
    await addScreenshots();

    expect(mockLaunchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ allowsMultipleSelection: true, selectionLimit: FEEDBACK_PHOTO_MAX_COUNT }),
    );
    expect(removeThumbnailButton(1)).toBeTruthy();
    expect(removeThumbnailButton(2)).toBeTruthy();
    expect(removeThumbnailButton(3)).toBeTruthy();
    // The trigger switches to "Add more" once at least one photo is attached.
    expect(screen.getByRole("button", { name: i18n.t("feedback.photo.addMoreLabel") })).toBeTruthy();
    expect(screen.queryByRole("button", { name: i18n.t("feedback.photo.addLabel") })).toBeNull();
  });

  it("adding more in a second pass appends to (never replaces) the existing set", async () => {
    mockPickerAssets(["file:///tmp/one.jpg"]);
    await renderWithProviders(<FeedbackScreen />);
    await addScreenshots();

    mockPickerAssets(["file:///tmp/two.jpg", "file:///tmp/three.jpg"]);
    await addScreenshots();

    expect(removeThumbnailButton(1)).toBeTruthy();
    expect(removeThumbnailButton(2)).toBeTruthy();
    expect(removeThumbnailButton(3)).toBeTruthy();
    // The second pass only ever needs to fill the REMAINING slots.
    expect(mockLaunchImageLibraryAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectionLimit: FEEDBACK_PHOTO_MAX_COUNT - 1 }),
    );
  });

  it("removing one thumbnail before sending removes only that photo, not its siblings", async () => {
    mockPickerAssets(["file:///tmp/one.jpg", "file:///tmp/two.jpg"]);
    await renderWithProviders(<FeedbackScreen />);
    await addScreenshots();

    await act(async () => {
      fireEvent.press(removeThumbnailButton(1));
    });

    // Exactly one remove control survives — the (renumbered) survivor.
    expect(removeThumbnailButton(1)).toBeTruthy();
    expect(screen.queryByRole("button", { name: i18n.t("feedback.photo.removeThumbnailLabel", { index: 2 }) })).toBeNull();
  });

  it("a canceled picker leaves the existing set untouched", async () => {
    mockPickerAssets(["file:///tmp/one.jpg"]);
    await renderWithProviders(<FeedbackScreen />);
    await addScreenshots();

    mockLaunchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: null });
    await addScreenshots();

    expect(removeThumbnailButton(1)).toBeTruthy();
    expect(screen.queryByRole("button", { name: i18n.t("feedback.photo.removeThumbnailLabel", { index: 2 }) })).toBeNull();
  });

  it("enforces the photo cap: hides the add trigger and shows a calm limit message once reached", async () => {
    mockPickerAssets(
      Array.from({ length: FEEDBACK_PHOTO_MAX_COUNT }, (_, i) => `file:///tmp/${i}.jpg`),
    );
    await renderWithProviders(<FeedbackScreen />);
    await addScreenshots();

    expect(screen.queryByRole("button", { name: i18n.t("feedback.photo.addMoreLabel") })).toBeNull();
    expect(screen.queryByRole("button", { name: i18n.t("feedback.photo.addLabel") })).toBeNull();
    expect(
      screen.getByText(i18n.t("feedback.photo.limitReached", { count: FEEDBACK_PHOTO_MAX_COUNT })),
    ).toBeTruthy();
  });

  it("truncates to the remaining slots even if the platform picker ignores selectionLimit and returns more", async () => {
    mockPickerAssets(Array.from({ length: FEEDBACK_PHOTO_MAX_COUNT + 2 }, (_, i) => `file:///tmp/${i}.jpg`));
    await renderWithProviders(<FeedbackScreen />);
    await addScreenshots();

    expect(removeThumbnailButton(FEEDBACK_PHOTO_MAX_COUNT)).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: i18n.t("feedback.photo.removeThumbnailLabel", { index: FEEDBACK_PHOTO_MAX_COUNT + 1 }),
      }),
    ).toBeNull();
  });

  it("submitting durably queues the message with the trimmed contact, the screen it came from, and every attached photo", async () => {
    mockPickerAssets(["file:///tmp/one.jpg", "file:///tmp/two.jpg"]);

    await renderWithProviders(<FeedbackScreen />);

    await act(async () => {
      fireEvent.changeText(
        screen.getByLabelText(i18n.t("feedback.messageLabel")),
        "  The map crashed.  ",
      );
      fireEvent.changeText(
        screen.getByLabelText(i18n.t("feedback.contactLabel")),
        "  tester@example.com  ",
      );
    });
    await addScreenshots();
    await submit();

    const items = useFeedbackQueueStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.submission.message).toBe("The map crashed.");
    expect(items[0]?.submission.contact).toBe("tester@example.com");
    expect(items[0]?.submission.context.screen).toBe("settings");
    expect(items[0]?.submission.photos.map((photo) => photo.uri)).toEqual([
      "file:///tmp/one.jpg",
      "file:///tmp/two.jpg",
    ]);
    // Each photo gets its own distinct client-generated id.
    const photoIds = items[0]?.submission.photos.map((photo) => photo.photoId) ?? [];
    expect(new Set(photoIds).size).toBe(2);
  });

  it("submitting with no photos stores an empty photo list, not an error", async () => {
    await renderWithProviders(<FeedbackScreen />);

    await act(async () => {
      fireEvent.changeText(
        screen.getByLabelText(i18n.t("feedback.messageLabel")),
        "No photo this time.",
      );
    });
    await submit();

    const items = useFeedbackQueueStore.getState().items;
    expect(items[0]?.submission.photos).toEqual([]);
  });

  it("submitting with no contact stores contact as null, not an empty string", async () => {
    await renderWithProviders(<FeedbackScreen />);

    await act(async () => {
      fireEvent.changeText(
        screen.getByLabelText(i18n.t("feedback.messageLabel")),
        "No contact provided.",
      );
    });
    await submit();

    const items = useFeedbackQueueStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.submission.contact).toBeNull();
  });

  it("shows the 'saved on this device' confirmation, never 'sent', when Supabase isn't configured", async () => {
    await renderWithProviders(<FeedbackScreen />);

    await act(async () => {
      fireEvent.changeText(
        screen.getByLabelText(i18n.t("feedback.messageLabel")),
        "Test without a backend.",
      );
    });
    await submit();

    await waitFor(() =>
      expect(screen.getByText(i18n.t("feedback.confirmation.queuedMessage"))).toBeTruthy(),
    );
    expect(screen.queryByText(i18n.t("feedback.confirmation.sentMessage"))).toBeNull();
  });

  it("Close on the confirmation screen dismisses (or goes back)", async () => {
    mockCanDismiss.mockReturnValue(true);
    await renderWithProviders(<FeedbackScreen />);

    await act(async () => {
      fireEvent.changeText(
        screen.getByLabelText(i18n.t("feedback.messageLabel")),
        "Closing after submit.",
      );
    });
    await submit();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: i18n.t("feedback.confirmation.close") }),
      ).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: i18n.t("feedback.confirmation.close") }),
      );
    });

    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });
});
