import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";

import { RecordingPanel } from "../components/RecordingPanel";
import type { SensorRecording } from "../recording";

/**
 * The exported recording names the app version and, on a hosted web build,
 * the short build id (D90), so a file can be traced to the exact build that
 * recorded it.
 */

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "26.3.0" } },
}));

const mockSave = jest.fn<Promise<void>, [string, string]>();
jest.mock("../save-recording", () => ({
  saveRecordingText: (text: string, fileName: string) => mockSave(text, fileName),
}));

const T0 = Date.parse("2026-10-19T10:00:00.000Z");
const recording: SensorRecording = {
  startedAt: T0,
  endedAt: T0 + 1000,
  requestedMs: 1000,
  samples: [0, 20, 40].map((ms) => ({
    t: T0 + ms,
    rawX: 0,
    rawY: 0,
    rawZ: 1,
    linX: 0,
    linY: 0,
    linZ: 0,
  })),
};

async function savedHeader(): Promise<string[]> {
  await render(
    <RecordingPanel
      recording={null}
      lastRecording={recording}
      onStart={jest.fn()}
      onStop={jest.fn()}
      onDiscard={jest.fn()}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Save .txt" }));
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  const [text] = mockSave.mock.calls[0] as [string, string];
  return text.split("\n").filter((line) => line.startsWith("#"));
}

describe("RecordingPanel export header", () => {
  const originalBuildId = process.env.EXPO_PUBLIC_BUILD_ID;

  beforeEach(() => {
    mockSave.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cleanup();
    if (originalBuildId === undefined) delete process.env.EXPO_PUBLIC_BUILD_ID;
    else process.env.EXPO_PUBLIC_BUILD_ID = originalBuildId;
  });

  it("stamps version+build on a hosted web build", async () => {
    process.env.EXPO_PUBLIC_BUILD_ID = "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432";
    expect(await savedHeader()).toContain("# app_version: 26.3.0+9f8e7d6");
  });

  it("stamps the bare version without a build id", async () => {
    delete process.env.EXPO_PUBLIC_BUILD_ID;
    expect(await savedHeader()).toContain("# app_version: 26.3.0");
  });
});
