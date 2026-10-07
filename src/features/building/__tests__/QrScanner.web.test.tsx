/**
 * @jest-environment jsdom
 *
 * `QrScanner.web.tsx`: the browser's BarcodeDetector plus getUserMedia, both
 * faked at the browser boundary. The scanning loop itself is in
 * `qr-detect.test.ts`.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";

import "@/i18n";
import { QrScanner, canScanQr } from "../components/QrScanner.web";

jest.mock("expo-router", () => ({
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

const getUserMedia = jest.fn();

function installBrowser({ detector = true, camera = true } = {}) {
  const w = window as unknown as Record<string, unknown>;
  if (detector) {
    w.BarcodeDetector = class {
      detect = async () => [];
    };
  } else {
    delete w.BarcodeDetector;
  }
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: camera ? { getUserMedia } : undefined,
  });
}

beforeEach(() => {
  getUserMedia.mockReset();
  installBrowser();
});
afterEach(() => cleanup());

describe("canScanQr (web)", () => {
  it("needs BarcodeDetector and a camera API; otherwise the scan button is hidden", () => {
    expect(canScanQr()).toBe(true);
    installBrowser({ detector: false });
    expect(canScanQr()).toBe(false);
    installBrowser({ camera: false });
    expect(canScanQr()).toBe(false);
  });
});

describe("QrScanner (web)", () => {
  // The camera preview and the detection loop need a real <video> element,
  // which the native test renderer cannot give; the loop itself is covered in
  // qr-detect.test.ts. Live scanning needs a real browser with a camera.
  it("asks the browser for the back camera", async () => {
    getUserMedia.mockResolvedValue({ getTracks: () => [] });
    await render(<QrScanner onScan={jest.fn()} onCancel={jest.fn()} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: "environment" } });
  });

  it("stops the camera when it is closed", async () => {
    const stop = jest.fn();
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] });
    const view = await render(<QrScanner onScan={jest.fn()} onCancel={jest.fn()} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(stop).not.toHaveBeenCalled();
    await view.unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("stops a camera that opens after the scanner was closed", async () => {
    const stop = jest.fn();
    let open: (stream: unknown) => void = () => undefined;
    getUserMedia.mockReturnValue(new Promise((resolve) => (open = resolve)));
    const view = await render(<QrScanner onScan={jest.fn()} onCancel={jest.fn()} />);
    await view.unmount();
    await act(async () => {
      open({ getTracks: () => [{ stop }] });
      await Promise.resolve();
    });
    expect(stop).toHaveBeenCalled();
  });

  it("says so when the camera is refused, and Cancel still works", async () => {
    getUserMedia.mockRejectedValue(new Error("NotAllowedError"));
    const onCancel = jest.fn();
    await render(<QrScanner onScan={jest.fn()} onCancel={onCancel} />);
    expect(
      await screen.findByText("The camera could not be opened. Type the code instead."),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("scan-cancel"));
    });
    expect(onCancel).toHaveBeenCalled();
  });
});
