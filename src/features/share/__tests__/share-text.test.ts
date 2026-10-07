import * as Clipboard from "expo-clipboard";
import { Platform, Share } from "react-native";

import { copyText, isShareAbort, shareText } from "../share-text";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));

const setString = Clipboard.setStringAsync as jest.Mock;

describe("shareText on the phone", () => {
  afterEach(() => jest.restoreAllMocks());

  it("opens the system share sheet with the text", async () => {
    const share = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: Share.sharedAction });
    expect(await shareText("hello", "Title")).toBe("shared");
    expect(share).toHaveBeenCalledWith({ message: "hello", title: "Title" });
  });

  it("reports a dismissed sheet as cancelled", async () => {
    jest.spyOn(Share, "share").mockResolvedValue({ action: Share.dismissedAction });
    expect(await shareText("hello", "Title")).toBe("cancelled");
  });

  it("reports a failure instead of throwing", async () => {
    jest.spyOn(Share, "share").mockRejectedValue(new Error("boom"));
    expect(await shareText("hello", "Title")).toBe("failed");
  });
});

describe("shareText on the web", () => {
  const original = Platform.OS;
  beforeEach(() => {
    Platform.OS = "web";
    setString.mockReset().mockResolvedValue(true);
  });
  afterEach(() => {
    Platform.OS = original;
    delete (globalThis as { navigator?: unknown }).navigator;
  });

  it("uses navigator.share when the browser has it", async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    (globalThis as { navigator?: unknown }).navigator = { share };
    expect(await shareText("hello", "Title")).toBe("shared");
    expect(share).toHaveBeenCalledWith({ text: "hello", title: "Title" });
    expect(setString).not.toHaveBeenCalled();
  });

  it("treats closing the browser dialog as cancelled, not as an error", async () => {
    (globalThis as { navigator?: unknown }).navigator = {
      share: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error("x"), { name: "AbortError" })),
    };
    expect(await shareText("hello", "Title")).toBe("cancelled");
    expect(setString).not.toHaveBeenCalled();
  });

  it("copies the text where the browser has no share dialog", async () => {
    (globalThis as { navigator?: unknown }).navigator = {};
    expect(await shareText("hello", "Title")).toBe("copied");
    expect(setString).toHaveBeenCalledWith("hello");
  });

  it("copies the text when the share dialog fails for another reason", async () => {
    (globalThis as { navigator?: unknown }).navigator = {
      share: jest.fn().mockRejectedValue(new Error("NotAllowedError")),
    };
    expect(await shareText("hello", "Title")).toBe("copied");
  });
});

describe("helpers", () => {
  it("copyText says false when the clipboard refuses", async () => {
    setString.mockRejectedValue(new Error("denied"));
    expect(await copyText("x")).toBe(false);
  });
  it("isShareAbort recognises only AbortError", () => {
    expect(isShareAbort({ name: "AbortError" })).toBe(true);
    expect(isShareAbort(new Error("x"))).toBe(false);
    expect(isShareAbort(null)).toBe(false);
  });
});
