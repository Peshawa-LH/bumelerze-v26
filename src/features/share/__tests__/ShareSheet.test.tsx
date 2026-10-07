import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { Platform } from "react-native";

import i18n from "@/i18n";

import { URMIA_EVENT } from "../__fixtures__/events";
import { ShareSheet } from "../ShareSheet";
import type { ShareImage } from "../types";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@/features/shakemap/live-queries", () => ({
  useResolvedShakeMap: () => ({
    status: "ready",
    product: { reviewStatus: "automatic" },
    contours: jest.requireActual("../__fixtures__/events").URMIA_CONTOURS,
    risk: null,
  }),
}));

jest.mock("@/features/events", () => ({
  ...jest.requireActual("@/features/events"),
  useEventSourceAgencies: () => new Map([["gfz2026tksc", { agencies: ["GFZ"] }]]),
}));

const mockShareText = jest.fn();
const mockCopyText = jest.fn();
jest.mock("../share-text", () => ({
  shareText: (...args: unknown[]) => mockShareText(...args),
  copyText: (...args: unknown[]) => mockCopyText(...args),
}));

const mockRasterize = jest.fn();
const mockDeliver = jest.fn();
jest.mock("../image-export", () => ({
  rasterizeCard: (...args: unknown[]) => mockRasterize(...args),
  deliverImage: (...args: unknown[]) => mockDeliver(...args),
  canShareImageFiles: () => true,
}));

const URL_ = "https://bumelerze.com/app/event/bml202602ia";

function image(size: "square" | "story"): ShareImage {
  return {
    size,
    width: 1080,
    height: size === "square" ? 1080 : 1920,
    base64: "iVBORw==",
  };
}

async function open() {
  await render(
    <ShareSheet event={URMIA_EVENT} shareId="bml202602ia" onClose={jest.fn()} />,
  );
}

describe("ShareSheet on the phone", () => {
  beforeEach(async () => {
    mockShareText.mockReset().mockResolvedValue("shared");
    mockCopyText.mockReset().mockResolvedValue(true);
    mockDeliver.mockReset().mockResolvedValue("shared");
    mockRasterize
      .mockReset()
      .mockImplementation(async (_card: unknown, size: "square" | "story") =>
        image(size),
      );
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("starts with the automatic caption, editable, and makes no image yet", async () => {
    await open();
    const input = screen.getByTestId("share-caption-input");
    expect(input.props.value).toContain("M3.2 earthquake");
    expect(input.props.value).toContain(URL_);
    // Generate on demand only: nothing is rendered until a tap.
    expect(mockRasterize).not.toHaveBeenCalled();
    expect(screen.queryByTestId("share-card-host")).toBeNull();
  });

  it("shares the link with the (edited) caption", async () => {
    await open();
    await fireEvent.changeText(
      screen.getByTestId("share-caption-input"),
      `Felt this! ${URL_}`,
    );
    await fireEvent.press(screen.getByTestId("share-link"));
    expect(mockShareText).toHaveBeenCalledWith(
      `Felt this! ${URL_}`,
      "Share this earthquake",
    );
  });

  it("puts the link back if the user deleted it from the caption", async () => {
    await open();
    await fireEvent.changeText(screen.getByTestId("share-caption-input"), "Felt this!");
    await fireEvent.press(screen.getByTestId("share-link"));
    expect(mockShareText.mock.calls[0]![0]).toBe(`Felt this!\n${URL_}`);
  });

  it("says so when the link could only be copied", async () => {
    mockShareText.mockResolvedValue("copied");
    await open();
    await fireEvent.press(screen.getByTestId("share-link"));
    expect(await screen.findByText("Link copied")).toBeTruthy();
  });

  it("copies the caption", async () => {
    await open();
    await fireEvent.press(screen.getByTestId("share-copy-caption"));
    expect(mockCopyText).toHaveBeenCalledWith(expect.stringContaining(URL_));
    expect(await screen.findByText("Caption copied")).toBeTruthy();
  });

  it("makes the square image at the tap, then hands it to the system with the caption", async () => {
    await open();
    await fireEvent.press(screen.getByTestId("share-image-square"));
    await waitFor(() => expect(mockDeliver).toHaveBeenCalledTimes(1));
    expect(mockRasterize.mock.calls[0]![1]).toBe("square");
    const [delivered, request] = mockDeliver.mock.calls[0]!;
    expect(delivered.size).toBe("square");
    expect(request.fileName).toBe("bumelerze-bml202602ia-square.png");
    expect(request.caption).toContain("M3.2 earthquake");
    // The hidden card is gone again afterwards.
    await waitFor(() => expect(screen.queryByTestId("share-card-host")).toBeNull());
  });

  it("makes the story image for the story button", async () => {
    await open();
    await fireEvent.press(screen.getByTestId("share-image-story"));
    await waitFor(() => expect(mockDeliver).toHaveBeenCalled());
    expect(mockRasterize.mock.calls[0]![1]).toBe("story");
    expect(mockDeliver.mock.calls[0]![0].height).toBe(1920);
  });

  it("shows progress while the image is being made", async () => {
    let finish: (value: ShareImage) => void = () => undefined;
    mockRasterize.mockImplementation(
      () => new Promise<ShareImage>((resolve) => (finish = resolve)),
    );
    await open();
    // Not awaited: the handler stays pending until the image is made.
    void fireEvent.press(screen.getByTestId("share-image-square"));
    expect(await screen.findByTestId("share-preparing")).toBeTruthy();
    expect(screen.getByText("Preparing image…")).toBeTruthy();
    await act(async () => finish(image("square")));
    await waitFor(() => expect(screen.queryByTestId("share-preparing")).toBeNull());
  });

  it("reuses an image it already made for the same card", async () => {
    await open();
    await fireEvent.press(screen.getByTestId("share-image-square"));
    await waitFor(() => expect(mockDeliver).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByTestId("share-image-square"));
    await waitFor(() => expect(mockDeliver).toHaveBeenCalledTimes(2));
    expect(mockRasterize).toHaveBeenCalledTimes(1);
  });

  it("says so when the image could not be made", async () => {
    mockRasterize.mockRejectedValue(new Error("no native module"));
    await open();
    await fireEvent.press(screen.getByTestId("share-image-square"));
    expect(
      await screen.findByText("Could not make the image. Please try again."),
    ).toBeTruthy();
    expect(mockDeliver).not.toHaveBeenCalled();
  });

  it("labels its controls in Sorani", async () => {
    await i18n.changeLanguage("ckb");
    await open();
    expect(screen.getByText("هاوبەشکردنی لینک")).toBeTruthy();
    expect(screen.getByText("هاوبەشکردنی وێنە (چوارگۆشە)")).toBeTruthy();
    expect(screen.getByTestId("share-caption-input").props.value).toContain(
      "بوومەلەرزەیەکی ٣.٢ پلە",
    );
  });

  it("has an accessible name on every button", async () => {
    await open();
    for (const id of [
      "share-link",
      "share-image-square",
      "share-image-story",
      "share-copy-caption",
      "share-sheet-close",
    ]) {
      expect(screen.getByTestId(id).props.accessibilityLabel).toBeTruthy();
      expect(screen.getByTestId(id).props.accessibilityRole).toBe("button");
    }
  });
});

/** Lets the sheet's timers, frames and render queue run to the end. */
async function settle() {
  for (let round = 0; round < 12; round += 1) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
  }
}

describe("ShareSheet on the web", () => {
  const original = Platform.OS;
  beforeEach(async () => {
    Platform.OS = "web";
    jest.useFakeTimers();
    mockDeliver.mockReset();
    mockCopyText.mockReset().mockResolvedValue(true);
    mockRasterize
      .mockReset()
      .mockImplementation(async (_card: unknown, size: "square" | "story") =>
        image(size),
      );
    await i18n.changeLanguage("en");
  });
  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    Platform.OS = original;
  });

  it("prepares both images as soon as the sheet has opened, so a tap can share at once", async () => {
    await open();
    expect(
      screen.getByTestId("share-image-square").props.accessibilityState.disabled,
    ).toBe(true);
    await settle();
    expect(mockRasterize.mock.calls.map((call) => call[1])).toEqual(["square", "story"]);
    expect(
      screen.getByTestId("share-image-square").props.accessibilityState.disabled,
    ).toBe(false);
    expect(
      screen.getByTestId("share-image-story").props.accessibilityState.disabled,
    ).toBe(false);
  });

  it("delivers the ready image without rendering again, and reports the download fallback", async () => {
    mockDeliver.mockResolvedValue("downloaded");
    await open();
    await settle();
    mockRasterize.mockClear();
    await fireEvent.press(screen.getByTestId("share-image-story"));
    expect(mockRasterize).not.toHaveBeenCalled();
    expect(mockDeliver).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Image saved. Caption copied.")).toBeTruthy();
  });
});
