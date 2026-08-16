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
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
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
    expect(mockAddListener).toHaveBeenCalledTimes(1);
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

  it("shows the web explanation when permission is already granted but the device reports no sensor (isAvailableAsync)", async () => {
    mockGetPermissionsAsync.mockResolvedValue(grantedResponse());
    mockIsAvailableAsync.mockResolvedValue(false);

    await renderWithProviders(<SensorScreen />);
    await flush();

    expect(screen.getByText(i18n.t("sensor.web.explanation"))).toBeTruthy();
    expect(mockAddListener).not.toHaveBeenCalled();
  });

  it("falls back to the web explanation when a subscription is granted but never actually delivers a sample (silent listening timeout)", async () => {
    mockGetPermissionsAsync.mockResolvedValue(grantedResponse());
    mockIsAvailableAsync.mockResolvedValue(true);

    await renderWithProviders(<SensorScreen />);
    await flush();

    // Optimistically streaming immediately after subscribing...
    expect(mockAddListener).toHaveBeenCalledTimes(1);
    expect(screen.getByText(i18n.t("sensor.axisX"))).toBeTruthy();

    // ...but no sample ever arrives, so the watchdog demotes it back down.
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.getByText(i18n.t("sensor.web.explanation"))).toBeTruthy();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});
