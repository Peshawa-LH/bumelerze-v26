import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require required inside a jest.mock factory
    const { useEffect } = require("react");
    useEffect(() => effect(), [effect]);
  },
}));

type Listener = (reading: { x: number; y: number; z: number }) => void;
let listener: Listener | null = null;

jest.mock("expo-sensors", () => ({
  Accelerometer: {
    isAvailableAsync: () => Promise.resolve(true),
    getPermissionsAsync: () =>
      Promise.resolve({
        status: "granted",
        granted: true,
        canAskAgain: true,
        expires: "never",
      }),
    requestPermissionsAsync: () =>
      Promise.resolve({
        status: "granted",
        granted: true,
        canAskAgain: true,
        expires: "never",
      }),
    setUpdateInterval: jest.fn(),
    addListener: (fn: Listener) => {
      listener = fn;
      return { remove: () => (listener = null) };
    },
  },
}));

const mockSave = jest.fn<Promise<void>, [string, string]>();
jest.mock("../save-recording", () => ({
  saveRecordingText: (text: string, name: string) => mockSave(text, name),
}));

// eslint-disable-next-line import/first -- after the mocks above
import SensorScreen from "../../../../app/(tabs)/sensor";

const metrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function renderScreen(ui: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function press(element: ReturnType<typeof screen.getByText>) {
  await act(async () => {
    fireEvent.press(element);
    await Promise.resolve();
  });
}

describe("Sensor recording panel", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(Date.parse("2026-09-27T20:15:03.000Z"));
    mockSave.mockReset();
    mockSave.mockResolvedValue(undefined);
    listener = null;
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it("records the requested window, summarises it and saves a named text file", async () => {
    await renderScreen(<SensorScreen />);
    await flush();
    expect(listener).not.toBeNull();

    await press(screen.getByText(i18n.t("sensor.recording.duration", { seconds: 10 })));
    await press(screen.getByRole("button", { name: i18n.t("sensor.recording.start") }));
    expect(
      screen.getByText(i18n.t("sensor.recording.countdown", { seconds: 10 })),
    ).toBeTruthy();

    // 50 Hz for 2 s, then stop early.
    await act(async () => {
      for (let i = 0; i < 100; i += 1) {
        jest.advanceTimersByTime(20);
        listener?.({ x: 0.02, y: 0, z: 1 });
      }
    });
    await press(screen.getByText(i18n.t("sensor.recording.stop")));

    const summary = screen.getByText(/100 samples/);
    expect(summary.props.children).toContain("50.0 Hz");

    await press(screen.getByText(i18n.t("sensor.recording.save")));
    await flush();

    expect(mockSave).toHaveBeenCalledTimes(1);
    const [text, name] = mockSave.mock.calls[0]!;
    expect(name).toBe("bumelerze-accel-20260927-201503Z.txt");
    expect(text).toContain("# Bumelerze — phone accelerometer recording");
    expect(text).toContain("# samples: 100");
    expect(
      text
        .trimEnd()
        .split("\n")
        .filter((l) => !l.startsWith("#")),
    ).toHaveLength(100);
    expect(screen.getByText(i18n.t("sensor.recording.saved"))).toBeTruthy();

    await press(screen.getByText(i18n.t("sensor.recording.discard")));
    expect(
      screen.getByRole("button", { name: i18n.t("sensor.recording.start") }),
    ).toBeTruthy();
  });

  it("stops by itself when the window elapses", async () => {
    await renderScreen(<SensorScreen />);
    await flush();

    await press(screen.getByText(i18n.t("sensor.recording.duration", { seconds: 10 })));
    await press(screen.getByRole("button", { name: i18n.t("sensor.recording.start") }));
    await act(async () => {
      for (let i = 0; i < 600; i += 1) {
        jest.advanceTimersByTime(20);
        listener?.({ x: 0, y: 0, z: 1 });
      }
    });

    expect(screen.queryByText(i18n.t("sensor.recording.stop"))).toBeNull();
    expect(screen.getByText(i18n.t("sensor.recording.save"))).toBeTruthy();
    // Only samples inside the 10 s window are kept (~500 at 50 Hz).
    expect(screen.getByText(/(499|50[01]) samples/)).toBeTruthy();
  });
});
