import { saveRecordingText } from "../save-recording";

const mockWrite = jest.fn();
const mockCreate = jest.fn();
jest.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache" },
  File: jest.fn().mockImplementation((dir: string, name: string) => ({
    uri: `${dir}/${name}`,
    create: (...args: unknown[]) => mockCreate(...args),
    write: (...args: unknown[]) => mockWrite(...args),
  })),
}));
const mockShare = jest.fn(async () => undefined);
let mockAvailable = true;
jest.mock("expo-sharing", () => ({
  isAvailableAsync: async () => mockAvailable,
  shareAsync: (...args: unknown[]) => mockShare(...(args as [])),
}));

const NAME = "bumelerze-accel-20261021-001500Z.txt";

/** iOS parity item 30: the phone wrote the text without creating the file
 * and handed it to React Native's share sheet (which drops files on
 * Android); never run on a device. */
describe("saveRecordingText on the phone", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAvailable = true;
  });

  it("creates the text file in the cache and opens the share sheet with it", async () => {
    await saveRecordingText("# Bumelerze\n0.00\t0.01\n", NAME);
    expect(mockCreate).toHaveBeenCalledWith({ overwrite: true });
    expect(mockWrite).toHaveBeenCalledWith("# Bumelerze\n0.00\t0.01\n");
    expect(mockShare).toHaveBeenCalledWith(`file:///cache/${NAME}`, {
      mimeType: "text/plain",
      UTI: "public.plain-text",
      dialogTitle: NAME,
    });
  });

  it("fails without a share sheet, so the panel says saving failed", async () => {
    mockAvailable = false;
    await expect(saveRecordingText("x", NAME)).rejects.toThrow("no share sheet");
    expect(mockShare).not.toHaveBeenCalled();
  });
});
