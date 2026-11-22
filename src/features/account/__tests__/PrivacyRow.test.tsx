/**
 * Privacy & data shows (and copies) the device FINGERPRINT as the
 * contributor ID, never the device id or a piece of it (security audit
 * DB-03), and follows the new id after a sign-out.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";

import { __resetDeviceIdCacheForTests, resetDeviceId } from "@/features/felt/device-id";
import i18n from "@/i18n";
import { PrivacyRow } from "../components/PrivacyRow";

jest.mock("expo-crypto", () => ({
  randomUUID: () => "a1b2c3d4-0000-4000-8000-000000000000",
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  CryptoEncoding: { HEX: "hex" },
  digestStringAsync: async (_algorithm: string, data: string) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- inside a jest.mock factory
    (require("node:crypto") as typeof import("node:crypto"))
      .createHash("sha256")
      .update(data, "utf8")
      .digest("hex"),
}));

const mockCopy = jest.fn();
jest.mock("expo-clipboard", () => ({
  setStringAsync: (text: string) => mockCopy(text),
}));

const DEVICE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
/** SHA-256 of DEVICE_ID, first 8 hex (computed outside the app). */
const SHOWN = "16362F56";

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve();
    }
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockCopy.mockResolvedValue(true);
  await AsyncStorage.clear();
  await AsyncStorage.setItem("bumelerze.device-id", DEVICE_ID);
  __resetDeviceIdCacheForTests();
  if (i18n.language !== "en") {
    await i18n.changeLanguage("en");
  }
});
afterEach(cleanup);

it("[DB-03] shows the fingerprint, not the device id, and copies that", async () => {
  await render(<PrivacyRow email={null} />);
  await act(async () => {
    fireEvent.press(screen.getByTestId("account-privacy-row"));
  });
  await flush();

  expect(screen.getByText(`⁦${SHOWN}⁩`)).toBeTruthy();
  // Before the audit the ID was the id's first 8 characters.
  expect(screen.queryByText(/3F2504E0/i)).toBeNull();

  await act(async () => {
    fireEvent.press(screen.getByTestId("contributor-id-copy"));
  });
  expect(mockCopy).toHaveBeenCalledWith(SHOWN);
});

it("shows the new ID after a sign-out gives the device a new id", async () => {
  await render(<PrivacyRow email={null} />);
  await act(async () => {
    fireEvent.press(screen.getByTestId("account-privacy-row"));
  });
  await flush();
  expect(screen.getByText(`⁦${SHOWN}⁩`)).toBeTruthy();

  await act(async () => {
    await resetDeviceId();
  });
  await flush();
  expect(screen.queryByText(`⁦${SHOWN}⁩`)).toBeNull();
  expect(screen.getByTestId("contributor-id").props.children).toMatch(/^⁦[0-9A-F]{8}⁩$/);
});
