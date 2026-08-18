import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { useFeedbackQueueStore } from "@/features/feedback";

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

async function addScreenshot() {
  await pressAndFlush(
    screen.getByRole("button", { name: i18n.t("feedback.photo.addLabel") }),
  );
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

  it("adding a screenshot shows a preview and a remove option; removing clears it", async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///tmp/screenshot.jpg" }],
    });

    await renderWithProviders(<FeedbackScreen />);
    await addScreenshot();

    expect(
      screen.getByRole("button", { name: i18n.t("feedback.photo.removeLabel") }),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: i18n.t("feedback.photo.removeLabel") }),
      );
    });

    expect(
      screen.queryByRole("button", { name: i18n.t("feedback.photo.removeLabel") }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: i18n.t("feedback.photo.addLabel") })).toBeTruthy();
  });

  it("a canceled picker leaves the screenshot untouched", async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });

    await renderWithProviders(<FeedbackScreen />);
    await addScreenshot();

    expect(mockLaunchImageLibraryAsync).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: i18n.t("feedback.photo.addLabel") })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: i18n.t("feedback.photo.removeLabel") }),
    ).toBeNull();
  });

  it("submitting durably queues the message with the trimmed contact, the screen it came from, and any photo", async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///tmp/screenshot.jpg" }],
    });

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
    await addScreenshot();
    await submit();

    const items = useFeedbackQueueStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.submission.message).toBe("The map crashed.");
    expect(items[0]?.submission.contact).toBe("tester@example.com");
    expect(items[0]?.submission.context.screen).toBe("settings");
    expect(items[0]?.submission.photoUri).toBe("file:///tmp/screenshot.jpg");
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
