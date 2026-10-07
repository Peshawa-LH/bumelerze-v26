import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { QrScanner, canScanQr } from "../components/QrScanner";

let mockPermission: { granted: boolean } | null = { granted: true };
const mockRequestPermission = jest.fn();
let mockCameraProps: Record<string, unknown> = {};
jest.mock("expo-camera", () => ({
  useCameraPermissions: () => [mockPermission, mockRequestPermission],
  CameraView: (props: Record<string, unknown>) => {
    mockCameraProps = props;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
    const { View } = require("react-native");
    return <View testID="camera" />;
  },
}));

describe("QrScanner (native)", () => {
  beforeEach(async () => {
    mockPermission = { granted: true };
    mockRequestPermission.mockReset();
    mockCameraProps = {};
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(() => cleanup());

  it("is always available on a phone", () => {
    expect(canScanQr()).toBe(true);
  });

  it("reads QR codes only", async () => {
    await render(<QrScanner onScan={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByTestId("camera")).toBeTruthy();
    expect(mockCameraProps.barcodeScannerSettings).toEqual({ barcodeTypes: ["qr"] });
    expect(screen.getByText("Point the camera at the QR code.")).toBeTruthy();
  });

  it("hands over the first code once, however often the camera repeats it", async () => {
    const onScan = jest.fn();
    await render(<QrScanner onScan={onScan} onCancel={jest.fn()} />);
    const scanned = mockCameraProps.onBarcodeScanned as (event: { data: string }) => void;
    await act(async () => {
      scanned({ data: "first" });
      scanned({ data: "second" });
    });
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith("first");
  });

  it("asks for the camera first, with a cancel", async () => {
    mockPermission = { granted: false };
    const onCancel = jest.fn();
    await render(<QrScanner onScan={jest.fn()} onCancel={onCancel} />);
    expect(screen.queryByTestId("camera")).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId("scan-allow"));
    });
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.press(screen.getByTestId("scan-cancel"));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows nothing but a note while the permission is still loading", async () => {
    mockPermission = null;
    await render(<QrScanner onScan={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.queryByTestId("camera")).toBeNull();
    expect(screen.queryByTestId("scan-allow")).toBeNull();
  });

  it("cancel closes the camera", async () => {
    const onCancel = jest.fn();
    await render(<QrScanner onScan={jest.fn()} onCancel={onCancel} />);
    await act(async () => {
      fireEvent.press(screen.getByTestId("scan-cancel"));
    });
    expect(onCancel).toHaveBeenCalled();
  });
});
