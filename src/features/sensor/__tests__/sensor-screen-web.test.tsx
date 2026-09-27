import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";

// Same focus-effect shim as sensor-screen.test.tsx.
jest.mock("expo-router", () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require required inside a jest.mock factory
    const { useEffect } = require("react");
    useEffect(() => effect(), [effect]);
  },
}));

const mockIsAvailableAsync = jest.fn<Promise<boolean>, unknown[]>();
const mockGetPermissionsAsync = jest.fn<Promise<unknown>, unknown[]>();
const mockRequestPermissionsAsync = jest.fn<Promise<unknown>, unknown[]>();
const mockSetUpdateInterval = jest.fn();
const mockRemove = jest.fn();
const mockAddListener = jest.fn<{ remove: () => void }, unknown[]>();

/**
 * Since 2026-09-27 the web hook streams from the browser's own
 * `devicemotion` event, not `expo-sensors`' web shim (which reads
 * `deviceorientation` — tilt, not acceleration). `mockAddListener` above
 * therefore stays uncalled on web; these capture the real listener.
 */
const motionListeners: ((e: unknown) => void)[] = [];
const realAddEventListener = globalThis.addEventListener;
const realRemoveEventListener = globalThis.removeEventListener;
function installMotionListenerSpies() {
  motionListeners.length = 0;
  globalThis.addEventListener = ((type: string, cb: (e: unknown) => void) => {
    if (type === "devicemotion") motionListeners.push(cb);
    else realAddEventListener?.call(globalThis, type, cb as EventListener);
  }) as typeof globalThis.addEventListener;
  globalThis.removeEventListener = ((type: string, cb: (e: unknown) => void) => {
    if (type === "devicemotion") {
      const i = motionListeners.indexOf(cb);
      if (i >= 0) motionListeners.splice(i, 1);
    } else realRemoveEventListener?.call(globalThis, type, cb as EventListener);
  }) as typeof globalThis.removeEventListener;
}
function restoreMotionListenerSpies() {
  globalThis.addEventListener = realAddEventListener;
  globalThis.removeEventListener = realRemoveEventListener;
}
/** One `devicemotion` sample, m/s² — 1 g straight down on z. */
function deliverMotionSample() {
  for (const cb of [...motionListeners]) {
    cb({ accelerationIncludingGravity: { x: 0, y: 0, z: 9.80665 } });
  }
}

jest.mock("expo-sensors", () => ({
  Accelerometer: {
    isAvailableAsync: () => mockIsAvailableAsync(),
    getPermissionsAsync: () => mockGetPermissionsAsync(),
    requestPermissionsAsync: () => mockRequestPermissionsAsync(),
    setUpdateInterval: (interval: number) => mockSetUpdateInterval(interval),
    addListener: (listener: unknown) => mockAddListener(listener),
  },
}));

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import SensorScreen from "../../../../app/(tabs)/sensor";

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function renderWithProviders(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

/** Lets any already-scheduled promise microtasks settle before assertions. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Presses a button and flushes the microtasks its `onPress` kicks off, in
 * one `act()` scope. Firing `fireEvent.press` on its own (a synchronous
 * act()) and then separately `await`ing `flush()` (an async act()) triggers
 * React's "overlapping act() calls" warning here — `requestWebPermission`'s
 * promise chain resolves *across* that boundary and its effects land
 * outside any act() control, which can desync effect cleanup for the rest
 * of the file. Combining both inside a single async act() avoids it.
 */
async function pressAndFlush(element: ReturnType<typeof screen.getByText>) {
  await act(async () => {
    fireEvent.press(element);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function grantedResponse() {
  return { status: "granted", granted: true, canAskAgain: true, expires: "never" };
}

function undeterminedResponse() {
  return { status: "undetermined", granted: false, canAskAgain: true, expires: "never" };
}

function deniedResponse() {
  return { status: "denied", granted: false, canAskAgain: false, expires: "never" };
}

describe("Sensor screen on web", () => {
  const originalPlatformOS = Platform.OS;

  beforeAll(() => {
    Platform.OS = "web";
  });

  afterAll(() => {
    Platform.OS = originalPlatformOS;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Fake timers throughout: `beginStreamingWeb` arms a real
    // `WEB_SILENT_TIMEOUT_MS` watchdog and `beginStreaming` a real ~30 fps
    // render interval — without faking the clock, any test that reaches
    // "streaming" leaves a live macrotask running past its own `cleanup()`
    // that can fire mid-way through a *later* test and corrupt it.
    jest.useFakeTimers();
    mockAddListener.mockReturnValue({ remove: mockRemove });
    // Default shape: iOS Safari 13+, where `DeviceMotionEvent.requestPermission`
    // genuinely exists — the hook's own feature-detection (independent of
    // the `getPermissionsAsync` mock above) must see this for the
    // `permission-required` button to ever show. Tests simulating a browser
    // with no permission-request API at all (the Android-Chrome shape, or
    // pre-13 iOS Safari) delete this global themselves.
    (globalThis as { DeviceMotionEvent?: { requestPermission?: unknown } }).DeviceMotionEvent = {
      requestPermission: jest.fn(),
    };
    installMotionListenerSpies();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    restoreMotionListenerSpies();
    delete (globalThis as { DeviceMotionEvent?: unknown }).DeviceMotionEvent;
    delete (globalThis.navigator as { maxTouchPoints?: number }).maxTouchPoints;
  });

  it("shows the enable-sensor button while permission is undetermined (iOS Safari, pre-ask)", async () => {
    mockGetPermissionsAsync.mockResolvedValue(undeterminedResponse());

    await renderWithProviders(<SensorScreen />);
    await flush();

    expect(screen.getByText(i18n.t("sensor.web.enableButton"))).toBeTruthy();
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockAddListener).not.toHaveBeenCalled();
  });

  it("requests permission from the button tap (user gesture) and starts streaming once granted", async () => {
    mockGetPermissionsAsync.mockResolvedValue(undeterminedResponse());
    mockRequestPermissionsAsync.mockResolvedValue(grantedResponse());

    await renderWithProviders(<SensorScreen />);
    await flush();

    await pressAndFlush(screen.getByText(i18n.t("sensor.web.enableButton")));

    expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1);
    // A real `devicemotion` listener, never the shim's `addListener`.
    expect(motionListeners).toHaveLength(1);
    expect(mockAddListener).not.toHaveBeenCalled();
    expect(screen.getByText(i18n.t("sensor.axisX"))).toBeTruthy();
  });

  it("shows the web explanation (no button) when permission is already denied and can't be re-asked", async () => {
    mockGetPermissionsAsync.mockResolvedValue(deniedResponse());

    await renderWithProviders(<SensorScreen />);
    await flush();

    expect(screen.getByText(i18n.t("sensor.web.explanation"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("sensor.web.enableButton"))).toBeNull();
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockAddListener).not.toHaveBeenCalled();
  });

  it("shows the web explanation when the button tap resolves to a decline", async () => {
    mockGetPermissionsAsync.mockResolvedValue(undeterminedResponse());
    mockRequestPermissionsAsync.mockResolvedValue(deniedResponse());

    await renderWithProviders(<SensorScreen />);
    await flush();

    await pressAndFlush(screen.getByText(i18n.t("sensor.web.enableButton")));

    expect(screen.getByText(i18n.t("sensor.web.explanation"))).toBeTruthy();
    expect(mockAddListener).not.toHaveBeenCalled();
  });

  it("keeps streaming once a devicemotion sample arrives (the watchdog stands down)", async () => {
    // The shim's `isAvailableAsync` probe is gone: whether a sensor exists
    // is decided by whether `devicemotion` ever delivers, and nothing else.
    mockGetPermissionsAsync.mockResolvedValue(grantedResponse());

    await renderWithProviders(<SensorScreen />);
    await flush();
    expect(motionListeners).toHaveLength(1);

    await act(async () => {
      deliverMotionSample();
      jest.advanceTimersByTime(2000);
    });

    expect(screen.getByText(i18n.t("sensor.axisX"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("sensor.web.explanation"))).toBeNull();
    expect(mockIsAvailableAsync).not.toHaveBeenCalled();
  });

  it("tells a desktop browser to open the app on a phone instead of offering a button", async () => {
    // Safari on a Mac still exposes `DeviceMotionEvent.requestPermission`,
    // so without this the screen invited a tap that could never succeed.
    (globalThis.navigator as { maxTouchPoints?: number }).maxTouchPoints = 0;
    mockGetPermissionsAsync.mockResolvedValue(undeterminedResponse());

    await renderWithProviders(<SensorScreen />);
    await flush();

    expect(screen.getByText(i18n.t("sensor.web.desktop"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("sensor.web.enableButton"))).toBeNull();
    expect(motionListeners).toHaveLength(0);
  });

  it("falls back to the web explanation when a subscription is granted but never actually delivers a sample (silent listening timeout)", async () => {
    mockGetPermissionsAsync.mockResolvedValue(grantedResponse());

    await renderWithProviders(<SensorScreen />);
    await flush();

    // Optimistically streaming immediately after subscribing...
    expect(motionListeners).toHaveLength(1);
    expect(screen.getByText(i18n.t("sensor.axisX"))).toBeTruthy();

    // ...but no sample ever arrives, so the watchdog demotes it back down
    // and the listener is torn down.
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.getByText(i18n.t("sensor.web.explanation"))).toBeTruthy();
    expect(motionListeners).toHaveLength(0);
  });

  describe("browsers with no permission-request API at all", () => {
    beforeEach(() => {
      // Simulates both the Android-Chrome shape (no permission concept,
      // sensor just works) and pre-13 iOS Safari (no in-app re-ask
      // possible) — the hook must never reach `permission-required` (and
      // so never show the button) here, regardless of what the mocked
      // `getPermissionsAsync` says.
      delete (globalThis as { DeviceMotionEvent?: unknown }).DeviceMotionEvent;
    });

    it("streams directly, skipping the permission dance entirely (Android Chrome shape)", async () => {
      mockIsAvailableAsync.mockResolvedValue(true);

      await renderWithProviders(<SensorScreen />);
      await flush();

      expect(screen.getByText(i18n.t("sensor.axisX"))).toBeTruthy();
      expect(mockGetPermissionsAsync).not.toHaveBeenCalled();
      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
      expect(screen.queryByText(i18n.t("sensor.web.enableButton"))).toBeNull();
    });

    it("shows the web explanation, without crashing, when no devicemotion sample ever arrives", async () => {
      await renderWithProviders(<SensorScreen />);
      await flush();
      // Subscribed straight away — no permission concept here — and the
      // silent watchdog is the availability probe.
      expect(motionListeners).toHaveLength(1);

      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      expect(screen.getByText(i18n.t("sensor.web.explanation"))).toBeTruthy();
      expect(mockAddListener).not.toHaveBeenCalled();
      expect(screen.queryByText(i18n.t("sensor.web.enableButton"))).toBeNull();
    });
  });

  describe("a broken requestPermissionsAsync (the owner's older-iOS-Safari case)", () => {
    it("shows the web explanation instead of crashing when the call throws synchronously", async () => {
      mockGetPermissionsAsync.mockResolvedValue(undeterminedResponse());
      mockRequestPermissionsAsync.mockImplementation(() => {
        throw new Error("requestPermission is not a function");
      });

      await renderWithProviders(<SensorScreen />);
      await flush();

      const button = screen.getByText(i18n.t("sensor.web.enableButton"));
      await pressAndFlush(button);

      expect(screen.getByText(i18n.t("sensor.web.explanation"))).toBeTruthy();
      expect(mockAddListener).not.toHaveBeenCalled();
    });

    it("shows the web explanation instead of crashing when the call rejects asynchronously", async () => {
      mockGetPermissionsAsync.mockResolvedValue(undeterminedResponse());
      mockRequestPermissionsAsync.mockRejectedValue(new Error("NotAllowedError"));

      await renderWithProviders(<SensorScreen />);
      await flush();

      const button = screen.getByText(i18n.t("sensor.web.enableButton"));
      await pressAndFlush(button);

      expect(screen.getByText(i18n.t("sensor.web.explanation"))).toBeTruthy();
      expect(mockAddListener).not.toHaveBeenCalled();
    });
  });

  it("shows the web explanation instead of crashing when the mount-time getPermissionsAsync call itself rejects", async () => {
    mockGetPermissionsAsync.mockRejectedValue(new Error("boom"));

    await renderWithProviders(<SensorScreen />);
    await flush();

    expect(screen.getByText(i18n.t("sensor.web.explanation"))).toBeTruthy();
    expect(mockAddListener).not.toHaveBeenCalled();
  });
});
