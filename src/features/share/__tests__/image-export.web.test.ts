/**
 * @jest-environment jsdom
 */
import { canShareImageFiles, deliverImage } from "../image-export.web";
import type { ShareImage } from "../types";

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock hoisting
const Clipboard = require("expo-clipboard") as { setStringAsync: jest.Mock };

const IMAGE: ShareImage = {
  size: "square",
  width: 1080,
  height: 1080,
  base64: "iVBORw==",
};
const REQUEST = {
  fileName: "bumelerze-bml1-square.png",
  caption: "My caption",
  title: "Share",
};

function setNavigator(value: unknown) {
  Object.defineProperty(window, "navigator", { value, configurable: true });
}

describe("deliverImage on the web", () => {
  const originalNavigator = window.navigator;
  const createObjectURL = jest.fn(() => "blob:x");
  beforeEach(() => {
    jest.useFakeTimers();
    Clipboard.setStringAsync.mockClear();
    // jest-expo's jsdom has no URL object URLs; stand in for the browser's.
    Object.defineProperty(globalThis, "URL", {
      value: { createObjectURL, revokeObjectURL: jest.fn() },
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    setNavigator(originalNavigator);
  });

  it("shares the file with the caption when the browser can share files", async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    const canShare = jest.fn().mockReturnValue(true);
    setNavigator({ share, canShare });
    expect(await deliverImage(IMAGE, REQUEST)).toBe("shared");
    const data = share.mock.calls[0]![0] as { files: File[]; text: string };
    expect(data.files[0]!.name).toBe("bumelerze-bml1-square.png");
    expect(data.files[0]!.type).toBe("image/png");
    expect(data.text).toBe("My caption");
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  });

  it("downloads the picture and copies the caption when canShare says no", async () => {
    const share = jest.fn();
    setNavigator({ share, canShare: jest.fn().mockReturnValue(false) });
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    expect(await deliverImage(IMAGE, REQUEST)).toBe("downloaded");
    expect(share).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("My caption");
    click.mockRestore();
  });

  it("downloads when the browser has no Web Share at all (desktop)", async () => {
    setNavigator({});
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    expect(await deliverImage(IMAGE, REQUEST)).toBe("downloaded");
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("My caption");
    click.mockRestore();
  });

  it("downloads when the share dialog fails for a real reason", async () => {
    setNavigator({
      share: jest.fn().mockRejectedValue(new Error("NotAllowedError")),
      canShare: jest.fn().mockReturnValue(true),
    });
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    expect(await deliverImage(IMAGE, REQUEST)).toBe("downloaded");
    click.mockRestore();
  });

  it("does nothing more when the user closes the share dialog", async () => {
    setNavigator({
      share: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error("x"), { name: "AbortError" })),
      canShare: jest.fn().mockReturnValue(true),
    });
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    expect(await deliverImage(IMAGE, REQUEST)).toBe("cancelled");
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it("calls navigator.share before awaiting anything (it needs the live tap)", () => {
    const share = jest.fn().mockResolvedValue(undefined);
    setNavigator({ share, canShare: jest.fn().mockReturnValue(true) });
    void deliverImage(IMAGE, REQUEST);
    expect(share).toHaveBeenCalledTimes(1);
  });
});

describe("canShareImageFiles", () => {
  const originalNavigator = window.navigator;
  afterEach(() => setNavigator(originalNavigator));

  it("is true only when the browser accepts a png file", () => {
    setNavigator({ share: jest.fn(), canShare: () => true });
    expect(canShareImageFiles()).toBe(true);
    setNavigator({ share: jest.fn(), canShare: () => false });
    expect(canShareImageFiles()).toBe(false);
    setNavigator({});
    expect(canShareImageFiles()).toBe(false);
  });
});
