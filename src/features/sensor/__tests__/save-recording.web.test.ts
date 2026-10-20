/**
 * @jest-environment jsdom
 */
import { saveRecordingText } from "../save-recording.web";

describe("saveRecordingText in the browser", () => {
  it("downloads the text as a file under its name", async () => {
    jest.useFakeTimers();
    const createObjectURL = jest.fn((_blob: Blob) => "blob:rec");
    const revokeObjectURL = jest.fn();
    Object.defineProperty(globalThis, "URL", {
      value: { createObjectURL, revokeObjectURL },
      configurable: true,
      writable: true,
    });
    const clicks: { download: string; href: string }[] = [];
    jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push({ download: this.download, href: this.href });
      });

    await saveRecordingText("a\tb\n", "bumelerze-accel-20261021-001500Z.txt");

    expect(clicks).toEqual([{ download: "bumelerze-accel-20261021-001500Z.txt", href: "blob:rec" }]);
    const blob = createObjectURL.mock.calls[0]![0];
    expect(blob.type).toBe("text/plain;charset=utf-8");
    jest.advanceTimersByTime(10_000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:rec");
    jest.useRealTimers();
  });
});
