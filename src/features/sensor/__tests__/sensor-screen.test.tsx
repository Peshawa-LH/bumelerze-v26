import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n, { isRTLLocale } from "@/i18n";

// Sensor screen only needs `useFocusEffect` from expo-router; this mock
// mirrors focus-on-mount / cleanup-on-unmount, which is enough to exercise
// the subscribe/unsubscribe lifecycle without a real navigator (same
// pattern as home-screen.test.tsx mocking just `useRouter`). `require`d
// lazily inside the factory — jest.mock() factories can't close over
// module-scope imports.
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
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
import SensorScreen from "../../../../app/(tabs)/(sensor)/sensor";

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function renderWithProviders(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

/** Lets any already-scheduled promise microtasks (our hook's async
 * availability/permission chain) settle before assertions. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Press inside one act scope, then let the resulting state settle — a bare
 * `fireEvent.press` followed by a second `act` overlaps React's act scopes. */
async function pressAndFlush(element: ReturnType<typeof screen.getByText>) {
  await act(async () => {
    fireEvent.press(element);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Sensor screen", () => {
  const originalLanguage = i18n.language;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAddListener.mockReturnValue({ remove: mockRemove });
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("shows the friendly unavailable state when the device has no accelerometer", async () => {
    mockIsAvailableAsync.mockResolvedValue(false);

    await renderWithProviders(<SensorScreen />);
    await flush();

    expect(screen.getByText(i18n.t("sensor.unavailable"))).toBeTruthy();
    expect(mockAddListener).not.toHaveBeenCalled();
  });

  it("shows the permission-denied state when the permission is refused and can't be re-asked", async () => {
    mockIsAvailableAsync.mockResolvedValue(true);
    mockGetPermissionsAsync.mockResolvedValue({
      status: "denied",
      granted: false,
      canAskAgain: false,
      expires: "never",
    });

    await renderWithProviders(<SensorScreen />);
    await flush();

    expect(screen.getByText(i18n.t("sensor.permissionDenied"))).toBeTruthy();
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockAddListener).not.toHaveBeenCalled();
  });

  it("requests permission when undetermined and can ask again, then streams once granted", async () => {
    mockIsAvailableAsync.mockResolvedValue(true);
    mockGetPermissionsAsync.mockResolvedValue({
      status: "undetermined",
      granted: false,
      canAskAgain: true,
      expires: "never",
    });
    mockRequestPermissionsAsync.mockResolvedValue({
      status: "granted",
      granted: true,
      canAskAgain: true,
      expires: "never",
    });

    await renderWithProviders(<SensorScreen />);
    await flush();

    expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockSetUpdateInterval).toHaveBeenCalledWith(20);
    expect(mockAddListener).toHaveBeenCalledTimes(1);
    expect(screen.getByText(i18n.t("sensor.axisX"))).toBeTruthy();
    expect(screen.getByText(i18n.t("sensor.axisY"))).toBeTruthy();
    expect(screen.getByText(i18n.t("sensor.axisZ"))).toBeTruthy();
  });

  it("switches from the trace stack to the 3D view and back", async () => {
    mockIsAvailableAsync.mockResolvedValue(true);
    mockGetPermissionsAsync.mockResolvedValue({
      status: "granted",
      granted: true,
      canAskAgain: true,
      expires: "never",
    });

    await renderWithProviders(<SensorScreen />);
    await flush();

    expect(screen.getByLabelText(i18n.t("sensor.chartA11yLabel"))).toBeTruthy();
    expect(screen.queryByLabelText(i18n.t("sensor.spaceA11yLabel"))).toBeNull();

    await pressAndFlush(screen.getByText(i18n.t("sensor.view.space")));
    expect(screen.getByLabelText(i18n.t("sensor.spaceA11yLabel"))).toBeTruthy();
    expect(screen.queryByLabelText(i18n.t("sensor.chartA11yLabel"))).toBeNull();

    await pressAndFlush(screen.getByText(i18n.t("sensor.view.traces")));
    expect(screen.getByLabelText(i18n.t("sensor.chartA11yLabel"))).toBeTruthy();
  });

  it("renders the explainer text and title in Sorani (RTL)", async () => {
    expect(isRTLLocale("ckb")).toBe(true);
    await i18n.changeLanguage("ckb");
    mockIsAvailableAsync.mockResolvedValue(false);

    await renderWithProviders(<SensorScreen />);
    await flush();

    expect(screen.getByText(i18n.t("sensor.title"))).toBeTruthy();
    expect(screen.getByText(i18n.t("sensor.phone.lead"))).toBeTruthy();
  });

  it("removes the accelerometer listener on unmount (battery discipline)", async () => {
    mockIsAvailableAsync.mockResolvedValue(true);
    mockGetPermissionsAsync.mockResolvedValue({
      status: "granted",
      granted: true,
      canAskAgain: true,
      expires: "never",
    });

    const utils = await renderWithProviders(<SensorScreen />);
    await flush();

    expect(mockAddListener).toHaveBeenCalledTimes(1);
    expect(mockRemove).not.toHaveBeenCalled();

    await act(async () => {
      utils.unmount();
    });
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});
